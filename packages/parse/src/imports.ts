import { posix } from 'node:path';
import { familyOf, type LanguageId } from './languages.js';

/*
 * Resolves import specifiers to repository files. Everything is computed from the file list plus a
 * handful of config files (tsconfig.json, package.json, go.mod, CMakeLists.txt, compile_commands.json),
 * so resolution is deterministic and needs no language toolchain on the machine.
 */

export interface TsPathConfig {
  /** Directory of the tsconfig, repo-relative ('' for the root). */
  dir: string;
  baseUrl?: string;
  paths: Record<string, string[]>;
}

export interface ResolverContext {
  files: ReadonlySet<string>;
  tsConfigs: TsPathConfig[];
  /** Workspace package name → package directory. */
  packages: Map<string, string>;
  goModules: { module: string; dir: string }[];
  cIncludeDirs: string[];
  pythonRoots: string[];
  /** Lower-cased basename → paths, for suffix matching (Java packages, C headers). */
  byBasename: Map<string, string[]>;
}

/** Reads a repo-relative file's text, or undefined when it does not exist. */
export type ReadText = (path: string) => string | undefined;

const dirOf = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const join = (...parts: string[]): string => posix.normalize(parts.filter((p) => p !== '').join('/')).replace(/^\.\//, '').replace(/\/$/, '');

/** Parses JSON that may contain comments and trailing commas (tsconfig style). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Builds the resolver context from the repository's file list and config files. */
export function buildResolverContext(files: Iterable<string>, readText: ReadText): ResolverContext {
  const set = new Set(files);
  const ctx: ResolverContext = { files: set, tsConfigs: [], packages: new Map(), goModules: [], cIncludeDirs: [], pythonRoots: [''], byBasename: new Map() };
  const configFiles: string[] = [];
  for (const f of set) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const key = base.toLowerCase();
    const list = ctx.byBasename.get(key) ?? [];
    list.push(f);
    ctx.byBasename.set(key, list);
    if (['tsconfig.json', 'jsconfig.json', 'package.json', 'go.mod', 'CMakeLists.txt', 'compile_commands.json', 'pyproject.toml', 'setup.py'].includes(base)) configFiles.push(f);
  }
  for (const f of configFiles.sort()) {
    const text = readText(f);
    if (text === undefined) continue;
    const dir = dirOf(f);
    const base = f.slice(f.lastIndexOf('/') + 1);
    try {
      if (base === 'tsconfig.json' || base === 'jsconfig.json') {
        const j = parseJsonc(text) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
        const co = j.compilerOptions ?? {};
        if (co.paths || co.baseUrl) ctx.tsConfigs.push({ dir, ...(co.baseUrl ? { baseUrl: co.baseUrl } : {}), paths: co.paths ?? {} });
      } else if (base === 'package.json') {
        const j = JSON.parse(text) as { name?: string };
        if (j.name) ctx.packages.set(j.name, dir);
      } else if (base === 'go.mod') {
        const m = /^module\s+(\S+)/m.exec(text);
        if (m) ctx.goModules.push({ module: m[1]!, dir });
      } else if (base === 'CMakeLists.txt') {
        for (const m of text.matchAll(/(?:target_)?include_directories\s*\(([^)]*)\)/gi)) {
          for (const tokRaw of m[1]!.split(/\s+/)) {
            const tok = tokRaw.replace(/"/g, '').replace(/\$\{(CMAKE_CURRENT_SOURCE_DIR|PROJECT_SOURCE_DIR|CMAKE_SOURCE_DIR)\}\/?/g, '');
            if (!tok || /^(PUBLIC|PRIVATE|INTERFACE|SYSTEM|BEFORE|AFTER)$/.test(tok) || tok.includes('$')) continue;
            if (!/[/.]/.test(tok) && !set.has(join(dir, tok)) && ![...set].some((p) => p.startsWith(join(dir, tok) + '/'))) continue; // target names
            ctx.cIncludeDirs.push(join(dir, tok));
          }
        }
      } else if (base === 'compile_commands.json') {
        const entries = JSON.parse(text) as { directory?: string; command?: string; arguments?: string[] }[];
        for (const e of entries) {
          const args = e.arguments ?? (e.command ?? '').split(/\s+/);
          for (let i = 0; i < args.length; i++) {
            const a = args[i]!;
            const inc = a === '-I' ? args[++i] : a.startsWith('-I') ? a.slice(2) : undefined;
            if (inc && !inc.startsWith('/')) ctx.cIncludeDirs.push(join(dir, inc));
          }
        }
      } else if (base === 'pyproject.toml' || base === 'setup.py') {
        ctx.pythonRoots.push(dir);
        if ([...set].some((p) => p.startsWith(join(dir, 'src') + '/'))) ctx.pythonRoots.push(join(dir, 'src'));
      }
    } catch {
      // a malformed config file must not stop indexing
    }
  }
  if (!ctx.pythonRoots.includes('src') && [...set].some((p) => p.startsWith('src/') && p.endsWith('.py'))) ctx.pythonRoots.push('src');
  ctx.cIncludeDirs = [...new Set(ctx.cIncludeDirs)];
  ctx.pythonRoots = [...new Set(ctx.pythonRoots)];
  return ctx;
}

const TS_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function tryTsFile(ctx: ResolverContext, p: string): string | undefined {
  const bare = p.replace(/\.(m|c)?jsx?$/, '');
  for (const cand of [p, ...TS_EXTS.map((e) => bare + e), ...TS_EXTS.map((e) => `${p}/index${e}`)]) {
    if (ctx.files.has(cand)) return cand;
  }
  return undefined;
}

function resolveTs(ctx: ResolverContext, importer: string, spec: string): string[] {
  if (spec.startsWith('.')) {
    const hit = tryTsFile(ctx, join(dirOf(importer), spec));
    return hit ? [hit] : [];
  }
  // tsconfig paths, nearest config first
  const configs = ctx.tsConfigs.filter((c) => c.dir === '' || importer.startsWith(c.dir + '/')).sort((a, b) => b.dir.length - a.dir.length);
  for (const c of configs) {
    const base = join(c.dir, c.baseUrl ?? '.');
    for (const [pattern, targets] of Object.entries(c.paths)) {
      const star = pattern.indexOf('*');
      let rest: string | undefined;
      if (star < 0) rest = pattern === spec ? '' : undefined;
      else if (spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1))) rest = spec.slice(star, spec.length - (pattern.length - star - 1));
      if (rest === undefined) continue;
      for (const t of targets) {
        const hit = tryTsFile(ctx, join(base, t.replace('*', rest)));
        if (hit) return [hit];
      }
    }
    if (c.baseUrl) {
      const hit = tryTsFile(ctx, join(base, spec));
      if (hit) return [hit];
    }
  }
  // workspace packages: `@scope/name` or `@scope/name/sub`
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  const dir = ctx.packages.get(name);
  if (dir !== undefined) {
    const sub = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
    for (const cand of sub ? [join(dir, 'src', sub), join(dir, sub)] : [join(dir, 'src', 'index'), join(dir, 'index'), join(dir, 'src', 'main')]) {
      const hit = tryTsFile(ctx, cand);
      if (hit) return [hit];
    }
  }
  return [];
}

function resolvePython(ctx: ResolverContext, importer: string, spec: string): string[] {
  const tryModule = (base: string): string | undefined => {
    for (const cand of [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`]) if (ctx.files.has(cand)) return cand;
    return undefined;
  };
  const m = /^(\.*)(.*)$/.exec(spec)!;
  const dots = m[1]!.length;
  const rest = m[2]!.replace(/\./g, '/');
  if (dots > 0) {
    let dir = dirOf(importer);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    const hit = rest ? tryModule(join(dir, rest)) : tryModule(dir);
    return hit ? [hit] : [];
  }
  for (const root of ctx.pythonRoots) {
    const hit = tryModule(join(root, rest));
    if (hit) return [hit];
  }
  // a module imported as `pkg.mod.Name`: drop the last segment once
  const parent = rest.slice(0, rest.lastIndexOf('/'));
  if (parent) for (const root of ctx.pythonRoots) {
    const hit = tryModule(join(root, parent));
    if (hit) return [hit];
  }
  return [];
}

function bySuffix(ctx: ResolverContext, suffix: string): string[] {
  const base = suffix.slice(suffix.lastIndexOf('/') + 1).toLowerCase();
  return (ctx.byBasename.get(base) ?? []).filter((p) => p === suffix || p.endsWith('/' + suffix));
}

function resolveJava(ctx: ResolverContext, spec: string): string[] {
  const s = spec.replace(/^static\s+/, '');
  if (s.endsWith('.*')) {
    const dir = s.slice(0, -2).replace(/\./g, '/');
    return [...ctx.files].filter((p) => p.endsWith('.java') && dirOf(p).endsWith(dir)).sort();
  }
  const segs = s.split('.');
  for (let n = segs.length; n >= 2; n--) {
    const hits = bySuffix(ctx, `${segs.slice(0, n).join('/')}.java`);
    if (hits.length) return hits;
  }
  return [];
}

function resolveGo(ctx: ResolverContext, spec: string): string[] {
  for (const m of [...ctx.goModules].sort((a, b) => b.module.length - a.module.length)) {
    if (spec === m.module || spec.startsWith(m.module + '/')) {
      const dir = join(m.dir, spec.slice(m.module.length + 1));
      return [...ctx.files].filter((p) => dirOf(p) === dir && p.endsWith('.go') && !p.endsWith('_test.go')).sort();
    }
  }
  return [];
}

function resolveC(ctx: ResolverContext, importer: string, spec: string, system: boolean): string[] {
  const candidates = [...(system ? [] : [dirOf(importer)]), ...ctx.cIncludeDirs];
  for (const d of candidates) {
    const p = join(d, spec);
    if (ctx.files.has(p)) return [p];
  }
  const hits = bySuffix(ctx, spec);
  return hits.length === 1 ? hits : system ? [] : hits.slice(0, 1);
}

/** Resolves one import of `importer` to the repository files it refers to (empty when external). */
export function resolveImport(ctx: ResolverContext, importer: string, spec: string, lang: LanguageId, system = false): string[] {
  switch (familyOf(lang)) {
    case 'ts': return resolveTs(ctx, importer, spec);
    case 'python': return resolvePython(ctx, importer, spec);
    case 'java': return resolveJava(ctx, spec);
    case 'go': return resolveGo(ctx, spec);
    case 'c': return resolveC(ctx, importer, spec, system);
    case 'csharp': return []; // namespaces do not map to files; name resolution in @riaf/graph covers C#
  }
}
