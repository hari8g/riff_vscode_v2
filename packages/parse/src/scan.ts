import { readFileSync, readdirSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { hashBlob, type BlobHash } from '@riaf/kernel';
import type { BlobRecord, Store } from '@riaf/store';
import { languageOf } from './languages.js';

/*
 * File discovery: walks the repository honouring .gitignore files (nested ones too) and a fixed set
 * of directories no index wants, skips binaries and oversized files, and upserts the Merkle table.
 * A file whose size and mtime match the stored row is not re-hashed, so a warm scan of a large repo
 * reads directory entries and stats only.
 */

export const DEFAULT_IGNORED_DIRS = [
  '.git', '.hg', '.svn', '.riaf', 'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.gradle', '.idea', '.vscode',
  'coverage', '.next', '.turbo', 'vendor', '.tox',
];

/** Extensions indexed as plain text (chunked for search, no symbols). */
export const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.xml', '.gradle', '.properties',
  '.cmake', '.sh', '.bash', '.sql', '.proto', '.graphql', '.ini', '.cfg', '.env.example', '.html', '.css', '.scss',
]);
const TEXT_BASENAMES = new Set(['Dockerfile', 'Makefile', 'CMakeLists.txt', 'Jenkinsfile', 'go.mod', 'requirements.txt', '.gitignore']);

export const MAX_FILE_BYTES = 1_000_000;

/** One compiled .gitignore rule. */
interface IgnoreRule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

/** Compiles one gitignore pattern relative to `base` (a repo-relative dir, '' for root). */
export function compileIgnore(pattern: string, base: string): IgnoreRule | undefined {
  let p = pattern.replace(/\s+$/, '');
  if (!p || p.startsWith('#')) return undefined;
  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) re += '\\[';
      else { re += p.slice(i, end + 1); i = end; }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  const prefix = base ? `${base.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')}/` : '';
  const full = anchored ? `^${prefix}${re}(?:/.*)?$` : `^${prefix}(?:.*/)?${re}(?:/.*)?$`;
  return { re: new RegExp(full), negate, dirOnly };
}

class IgnoreSet {
  constructor(private readonly rules: readonly IgnoreRule[]) {}
  with(more: readonly IgnoreRule[]): IgnoreSet {
    return more.length ? new IgnoreSet([...this.rules, ...more]) : this;
  }
  ignores(path: string, isDir: boolean): boolean {
    let ignored = false;
    // The walker never descends into an ignored directory, so a directory-only rule only needs to
    // match directories themselves.
    for (const r of this.rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(path)) ignored = !r.negate;
    }
    return ignored;
  }
}

function readIgnoreFile(abs: string, base: string): IgnoreRule[] {
  try {
    return readFileSync(abs, 'utf8').split('\n').map((l) => compileIgnore(l, base)).filter((r): r is IgnoreRule => r !== undefined);
  } catch {
    return [];
  }
}

export interface DiscoveredFile {
  path: string; // repo-relative, forward slashes
  size: number;
  mtimeMs: number;
  lang?: string;
}

export interface DiscoverOptions {
  extraIgnores?: readonly string[];
  maxFileBytes?: number;
  /** Include plain-text files (docs, configs) for search. Default true. */
  includeText?: boolean;
}

/** True when RIAF indexes this path: a parsed language or a known text file. */
export function isIndexable(path: string, includeText = true): boolean {
  if (languageOf(path)) return true;
  if (!includeText) return false;
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (TEXT_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

/** Walks `root` and returns indexable files, honouring .gitignore and the default ignored directories. */
export function discoverFiles(root: string, opts: DiscoverOptions = {}): DiscoveredFile[] {
  const max = opts.maxFileBytes ?? MAX_FILE_BYTES;
  const ignoredDirs = new Set(DEFAULT_IGNORED_DIRS);
  const out: DiscoveredFile[] = [];
  // `.riafignore` (gitignore syntax) excludes paths from the index without touching git
  const base = new IgnoreSet([
    ...(opts.extraIgnores ?? []).map((p) => compileIgnore(p, '')).filter((r): r is IgnoreRule => r !== undefined),
    ...readIgnoreFile(join(root, '.riafignore'), ''),
  ]);
  const walk = (dir: string, rel: string, ignore: IgnoreSet) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    const here = ignore.with(names.includes('.gitignore') ? readIgnoreFile(join(dir, '.gitignore'), rel) : []);
    for (const name of names.sort()) {
      const abs = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      let st: Stats;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (ignoredDirs.has(name) || here.ignores(path, true)) continue;
        walk(abs, path, here);
      } else if (st.isFile()) {
        if (st.size > max || here.ignores(path, false) || !isIndexable(path, opts.includeText ?? true)) continue;
        const lang = languageOf(path);
        out.push({ path, size: st.size, mtimeMs: Math.floor(st.mtimeMs), ...(lang ? { lang } : {}) });
      }
    }
  };
  walk(root, '', base);
  return out;
}

/** Heuristic binary check: a NUL byte in the first 8 KiB. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export interface ScanResult {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  hashed: number;
  ms: number;
}

/**
 * Scans the working tree into the Merkle table: new and modified files are hashed and upserted
 * (resetting their stage bits), vanished files are removed with every derived row.
 */
export function scanIntoStore(store: Store, root: string, opts: DiscoverOptions = {}): ScanResult {
  const t0 = performance.now();
  const found = discoverFiles(root, opts);
  const known = new Map(store.merkle.listBlobs().map((b) => [b.path, b]));
  const records: BlobRecord[] = [];
  let hashed = 0;
  for (const f of found) {
    const prev = known.get(f.path);
    known.delete(f.path);
    if (prev && Number(prev.size) === f.size && Number(prev.mtime_ms) === f.mtimeMs) continue;
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(root, f.path));
    } catch {
      continue;
    }
    if (looksBinary(bytes)) continue;
    hashed++;
    records.push({ path: f.path, hash: hashBlob(bytes) as BlobHash, size: f.size, mtimeMs: f.mtimeMs, ...(f.lang ? { lang: f.lang } : {}) });
  }
  const summary = store.merkle.upsertBlobs(records);
  // Same hash but new mtime: refresh the stat columns so the next scan takes the fast path.
  const removed = [...known.keys()];
  for (const p of removed) store.removePath(p);
  if (records.length > summary.added.length + summary.changed.length) store.merkle.touchStats(records);
  return { added: summary.added, changed: summary.changed, removed, unchanged: found.length - summary.added.length - summary.changed.length, hashed, ms: performance.now() - t0 };
}

/** Reads a repo file as UTF-8 text. */
export function readRepoText(root: string, path: string): string | undefined {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return undefined;
  }
}

/** Hashes a string the same way the scanner hashes file bytes. */
export function hashText(text: string): BlobHash {
  return hashBlob(Buffer.from(text, 'utf8'));
}
