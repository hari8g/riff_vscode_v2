import type { EventBus, PipelineEvents } from '@riaf/kernel';
import type { Store, SymbolRecord } from '@riaf/store';

/**
 * Bottom-up extractive summaries: file → directory → package → repo. A file summary is its leading
 * doc comment plus its exported/top-level definitions with their first doc line; a directory summary
 * rolls up its children. Each summary is keyed by the blob or tree hash it was built from, so a save
 * regenerates one file and its ancestors only. Abstractive summaries (ModelPort) can replace the text
 * later without changing the cache keys.
 */

export const SUMMARY_STAGE = 'summaries';
const MANIFESTS = ['package.json', 'pom.xml', 'pyproject.toml', 'setup.py', 'CMakeLists.txt', 'go.mod', 'build.gradle', 'Cargo.toml'];
const TOP_KINDS = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'type', 'function', 'namespace', 'module', 'constant']);

const firstSentence = (t: string | undefined, max = 140): string | undefined => {
  if (!t) return undefined;
  const one = t.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(one);
  const s = (m ? m[1]! : one).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || undefined;
};

/** The leading comment / docstring of a file's first chunk, if any. */
export function leadingDoc(text: string): string | undefined {
  const t = text.trimStart();
  let m = /^\/\*\*?([\s\S]*?)\*\//.exec(t);
  if (m) return m[1]!.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').trim() || undefined;
  m = /^((?:\s*(?:\/\/|#)[^\n]*\n)+)/.exec(t + '\n');
  if (m && !/^#!|^#include|^#ifndef|^#define|^#pragma/.test(t)) return m[1]!.split('\n').map((l) => l.replace(/^\s*(\/\/+|#+)\s?/, '')).join(' ').trim() || undefined;
  m = /^(?:[rubf]*)("""|''')([\s\S]*?)\1/.exec(t);
  if (m) return m[2]!.trim() || undefined;
  return undefined;
}

/** Extractive summary of one file from its symbols and first chunk. */
export function summarizeFile(path: string, symbols: readonly SymbolRecord[], firstChunk: string | undefined): string {
  const lead = firstSentence(firstChunk ? leadingDoc(firstChunk) : undefined);
  const top = symbols.filter((s) => s.kind !== 'file' && TOP_KINDS.has(s.kind) && (!s.parentId || s.parentId.endsWith('#@file')));
  const parts = top.slice(0, 8).map((s) => {
    const d = firstSentence(s.doc, 90);
    return `${s.kind} ${s.name}${d ? ` — ${d}` : ''}`;
  });
  const tests = symbols.filter((s) => s.kind === 'test').length;
  const head = lead ?? (top.length ? `Defines ${top.slice(0, 3).map((s) => s.name).join(', ')}${top.length > 3 ? ', …' : ''}.` : `${path.slice(path.lastIndexOf('/') + 1)}.`);
  const body = parts.length ? ` ${parts.join('; ')}${top.length > 8 ? `; +${top.length - 8} more` : ''}.` : '';
  return `${head}${body}${tests ? ` ${tests} test${tests === 1 ? '' : 's'}.` : ''}`.trim();
}

const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const dirId = (d: string): string => (d === '' ? '' : `${d}/`);

export interface SummaryStageResult {
  files: number;
  directories: number;
  ms: number;
}

/** Runs the summaries stage: changed files, then every directory whose tree hash moved. */
export function runSummaryStage(store: Store, opts: { events?: EventBus<PipelineEvents> } = {}): SummaryStageResult {
  const t0 = performance.now();
  const pending = store.merkle.changedSince(SUMMARY_STAGE);
  opts.events?.emit('stage:start', { stage: SUMMARY_STAGE, pending: pending.length });
  let files = 0;
  store.driver.transaction(() => {
    for (const b of pending) {
      const syms = store.symbols.byPath(b.path);
      const first = store.chunks.byPath(b.path)[0]?.content;
      store.summaries.upsert({ nodeId: b.path, level: 'file', hash: b.hash, text: summarizeFile(b.path, syms, first), model: 'extractive' });
      files++;
    }
    store.merkle.markDone(SUMMARY_STAGE, pending.map((b) => b.path));
  });
  const changedDirs = store.merkle.recomputeTrees();
  const allPaths = store.merkle.paths();
  const childrenOf = new Map<string, { files: string[]; dirs: Set<string> }>();
  const ensure = (d: string) => {
    let c = childrenOf.get(d);
    if (!c) {
      c = { files: [], dirs: new Set() };
      childrenOf.set(d, c);
    }
    return c;
  };
  for (const p of allPaths) {
    let d = parentOf(p);
    ensure(d).files.push(p);
    while (d !== '') {
      const up = parentOf(d);
      ensure(up).dirs.add(d);
      d = up;
    }
  }
  // deepest first so parents read fresh child summaries
  const dirs = [...new Set(changedDirs)].sort((a, b) => b.split('/').length - a.split('/').length || (a < b ? -1 : 1));
  let directories = 0;
  store.driver.transaction(() => {
    for (const d of dirs) {
      const c = childrenOf.get(d);
      const tree = store.merkle.getTree(d);
      if (!c || !tree) continue;
      const manifest = c.files.find((f) => MANIFESTS.includes(f.slice(f.lastIndexOf('/') + 1)));
      const level = d === '' ? 'repo' : manifest ? 'package' : 'directory';
      const readme = c.files.find((f) => /(^|\/)README\.md$/i.test(f));
      const readmeLead = readme ? firstSentence(store.chunks.byPath(readme)[0]?.content.replace(/^#.*\n+/, ''), 200) : undefined;
      const lines: string[] = [];
      for (const sub of [...c.dirs].sort()) {
        const s = store.summaries.get(dirId(sub));
        lines.push(`${sub.slice(sub.lastIndexOf('/') + 1)}/ — ${firstSentence(s?.text, 100) ?? 'directory'}`);
      }
      for (const f of c.files.sort()) {
        if (/README\.md$/i.test(f)) continue;
        const s = store.summaries.get(f);
        if (s) lines.push(`${f.slice(f.lastIndexOf('/') + 1)} — ${firstSentence(s.text, 100)}`);
      }
      const name = d === '' ? 'repository' : d;
      const head = readmeLead ?? `${name}: ${c.files.length} file${c.files.length === 1 ? '' : 's'}${c.dirs.size ? `, ${c.dirs.size} director${c.dirs.size === 1 ? 'y' : 'ies'}` : ''}.`;
      const text = [head, ...lines.slice(0, 12).map((l) => `- ${l}`), ...(lines.length > 12 ? [`- … ${lines.length - 12} more`] : [])].join('\n');
      store.summaries.upsert({ nodeId: dirId(d), level, hash: tree.hash, text, model: 'extractive' });
      directories++;
    }
    // drop summaries of files and directories that no longer exist
    const keep = new Set<string>(allPaths);
    for (const d of childrenOf.keys()) keep.add(dirId(d));
    store.summaries.prune(keep);
  });
  const ms = performance.now() - t0;
  opts.events?.emit('stage:end', { stage: SUMMARY_STAGE, changed: files + directories, ms });
  return { files, directories, ms };
}
