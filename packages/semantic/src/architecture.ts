import type { Graph } from '@riaf/graph';
import type { Store } from '@riaf/store';

/**
 * The architecture map: workspaces/packages from manifests, languages, frameworks, build/test/lint
 * commands, entry points, generated paths, and layers from the graph's clusters. Derived from the
 * index only (manifest chunks, symbols, edges), so it is cheap to recompute after each run.
 */

export interface PackageInfo {
  dir: string;
  manifest: string;
  name: string;
}

export interface Architecture {
  packages: PackageInfo[];
  languages: Record<string, number>;
  frameworks: string[];
  commands: { build?: string; test?: string; lint?: string; run?: string };
  entryPoints: string[];
  generated: string[];
  clusters: { name: string; files: number; sample: string[] }[];
  testLayout: string[];
}

const textOf = (store: Store, path: string): string => store.chunks.byPath(path).map((c) => c.content).join('\n');

function detectFrameworks(store: Store, paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (base === 'package.json') {
      const t = textOf(store, p);
      for (const [needle, name] of [['vitest', 'vitest'], ['jest', 'jest'], ['react', 'react'], ['express', 'express'], ['@nestjs', 'nestjs'], ['typescript', 'typescript'], ['esbuild', 'esbuild'], ['eslint', 'eslint']] as const) {
        if (t.includes(`"${needle}`)) out.add(name);
      }
    } else if (base === 'pom.xml') {
      const t = textOf(store, p);
      out.add('maven');
      if (t.includes('spring')) out.add('spring');
      if (t.includes('junit')) out.add('junit');
    } else if (base === 'pyproject.toml' || base === 'setup.py') {
      const t = textOf(store, p);
      if (t.includes('pytest')) out.add('pytest');
      if (t.includes('django')) out.add('django');
      if (t.includes('fastapi')) out.add('fastapi');
    } else if (base === 'CMakeLists.txt') {
      out.add('cmake');
      if (textOf(store, p).includes('add_test')) out.add('ctest');
    } else if (base === 'go.mod') out.add('go-modules');
  }
  return [...out].sort();
}

function detectCommands(store: Store, paths: readonly string[]): Architecture['commands'] {
  const cmds: Architecture['commands'] = {};
  const root = (b: string) => paths.includes(b) ? b : paths.find((p) => p.endsWith(`/${b}`) && p.split('/').length === 2);
  const pkg = root('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(textOf(store, pkg)) as { scripts?: Record<string, string> };
      const runner = paths.includes('pnpm-lock.yaml') || paths.includes('pnpm-workspace.yaml') ? 'pnpm' : paths.includes('yarn.lock') ? 'yarn' : 'npm run';
      const run = (s: string) => (runner === 'npm run' && s === 'test' ? 'npm test' : `${runner} ${s}`);
      if (j.scripts?.['build']) cmds.build = run('build');
      if (j.scripts?.['test']) cmds.test = run('test');
      if (j.scripts?.['lint']) cmds.lint = run('lint');
      if (j.scripts?.['start'] || j.scripts?.['dev']) cmds.run = run(j.scripts['dev'] ? 'dev' : 'start');
    } catch {
      // malformed package.json: no commands
    }
  }
  if (!cmds.test && root('pom.xml')) Object.assign(cmds, { build: 'mvn -q package -DskipTests', test: 'mvn -q test' });
  if (!cmds.test && (root('pyproject.toml') || root('setup.py'))) cmds.test = 'pytest -q';
  if (!cmds.test && root('CMakeLists.txt')) Object.assign(cmds, { build: 'cmake -S . -B build && cmake --build build', test: 'ctest --test-dir build' });
  if (!cmds.test && root('go.mod')) Object.assign(cmds, { build: 'go build ./...', test: 'go test ./...' });
  return cmds;
}

/** Derives the architecture map from the index and the graph. */
export function deriveArchitecture(store: Store, graph: Graph): Architecture {
  const paths = store.merkle.paths();
  const blobs = store.merkle.listBlobs();
  const languages: Record<string, number> = {};
  for (const b of blobs) if (b.lang) languages[b.lang] = (languages[b.lang] ?? 0) + 1;
  const packages: PackageInfo[] = [];
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (!['package.json', 'pom.xml', 'pyproject.toml', 'go.mod', 'CMakeLists.txt', 'Cargo.toml'].includes(base)) continue;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    let name = dir || '.';
    const t = textOf(store, p);
    const m = base === 'package.json' ? /"name"\s*:\s*"([^"]+)"/.exec(t) : base === 'pom.xml' ? /<artifactId>([^<]+)<\/artifactId>/.exec(t.replace(/<parent>[\s\S]*?<\/parent>/, '')) : base === 'pyproject.toml' ? /^name\s*=\s*"([^"]+)"/m.exec(t) : base === 'go.mod' ? /^module\s+(\S+)/m.exec(t) : /project\(\s*([\w-]+)/i.exec(t);
    if (m) name = m[1]!;
    packages.push({ dir, manifest: base, name });
  }
  // entry points: files nobody imports that import others, plus conventional names
  const view = graph.view();
  const entry = new Set<string>();
  for (let i = 0; i < view.size; i++) {
    const s = view.symbols[i]!;
    if (s.kind !== 'file' || /(^|\/)(test|tests|__tests__)\/|\.test\.|_test\.|Test\.java$/.test(s.path)) continue;
    const importedBy = view.in[i]!.some((e) => e.kind === 'imports');
    const imports = view.out[i]!.filter((e) => e.kind === 'imports').length;
    const base = s.path.slice(s.path.lastIndexOf('/') + 1);
    if ((!importedBy && imports >= 2) || /^(main|index|app|server|cli)\.[a-z]+$/.test(base) || /Controller\.java$|Application\.java$/.test(base)) entry.add(s.path);
  }
  const testDirs = new Set<string>();
  for (const p of paths) {
    const m = /^(.*?(?:^|\/)(?:test|tests|__tests__|spec))\//.exec(p);
    if (m) testDirs.add(m[1]!);
    else if (/\.test\.[jt]sx?$|_test\.(go|py)$|Test\.java$/.test(p)) testDirs.add(`${p.slice(0, p.lastIndexOf('/'))} (colocated)`);
  }
  const clusters = graph.clusters().filter((c) => c.files.length > 1).slice(0, 8).map((c) => ({ name: c.name || '.', files: c.files.length, sample: c.files.slice(0, 3) }));
  return {
    packages, languages, frameworks: detectFrameworks(store, paths), commands: detectCommands(store, paths),
    entryPoints: [...entry].sort().slice(0, 10), generated: ['dist/', 'build/', 'target/', 'node_modules/'].filter((g) => paths.some((p) => p.startsWith(g))),
    clusters, testLayout: [...testDirs].sort().slice(0, 6),
  };
}
