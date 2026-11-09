import { fileId, type EventBus, type PipelineEvents, type SymbolId } from '@riaf/kernel';
import type { EdgeRecord, Store } from '@riaf/store';
import { edgeKindFor, SymbolIndex, type TypeContext } from './resolve.js';

export const GRAPH_STAGE = 'graph';
export const GRAPH_VERSION_KEY = 'graph.version';

/** Edge sources the graph stage owns (LSP and history edges are written by their own passes). */
const OWNED_SOURCES = ['treesitter', 'heuristic'] as const;

export interface GraphStageResult {
  /** Files whose blobs changed and were rebuilt. */
  changed: string[];
  /** Unchanged files rebuilt because their references point into, or may now bind to, changed files. */
  affected: string[];
  edges: number;
  ms: number;
}

const TEST_DIR = /(^|\/)(test|tests|__tests__|spec)\//;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(Test|Tests|IT)\.(java|cs)$/;

/** True when the symbol is test code (a test symbol, or anything defined in a test file). */
export function isTestSymbol(kind: string, path: string): boolean {
  return kind === 'test' || TEST_DIR.test(path) || TEST_FILE.test(path);
}

/** The production name a test file is named after: `FooTest.java`, `foo.test.ts`, `test_foo.py`, `foo_test.go`. */
export function testSubjectName(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const m = /^(.+?)(?:Tests?|IT)\.(?:java|cs|kt)$/.exec(base) ?? /^(.+?)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(base) ??
    /^test_(.+)\.py$/.exec(base) ?? /^(.+)_test\.(?:py|go)$/.exec(base) ?? /^test_(.+)\.(?:c|cc|cpp)$/.exec(base);
  return m?.[1];
}

/** Computes the edges for one file from the store's symbols, refs and imports. */
export function edgesForFile(store: Store, idx: SymbolIndex, path: string): EdgeRecord[] {
  const out: EdgeRecord[] = [];
  const syms = idx.byPath.get(path) ?? [];
  const file = fileId(path);
  // contains: parent → child, file → top-level
  for (const s of syms) {
    if (s.kind === 'file') continue;
    out.push({ src: s.parentId ?? file, dst: s.id, kind: 'contains', source: 'treesitter', confidence: 1, weight: 1 });
  }
  // imports: file → file
  for (const target of idx.importsOf.get(path) ?? []) {
    out.push({ src: file, dst: fileId(target), kind: 'imports', source: 'treesitter', confidence: 1, weight: 1 });
  }
  // references → invokes / inherits / defines_type
  const testCode = (id: SymbolId) => {
    const s = idx.byId.get(id);
    return s ? isTestSymbol(s.kind, s.path) : false;
  };
  const seen = new Map<string, EdgeRecord>();
  const refs = store.refs.byPath(path);
  // type context: names mentioned as types / constructed / inherited, per scope and per file
  const fileTypes = new Set<string>();
  const scopeTypes = new Map<string, Set<string>>();
  for (const r of refs) {
    if (r.kind !== 'type' && r.kind !== 'new' && r.kind !== 'inherit') continue;
    fileTypes.add(r.name);
    // a type mentioned in a scope is visible to that scope and to everything nested in it
    const set = scopeTypes.get(r.scopeId) ?? new Set<string>();
    set.add(r.name);
    scopeTypes.set(r.scopeId, set);
  }
  const ctxFor = (scope: SymbolId): TypeContext => {
    const names = new Set<string>(scopeTypes.get(scope) ?? []);
    for (const a of idx.ancestors(scope)) for (const n of scopeTypes.get(a.id) ?? []) names.add(n);
    return { scope: names, file: fileTypes };
  };
  for (const ref of refs) {
    for (const b of idx.resolve(ref, ctxFor(ref.scopeId))) {
      const kind = edgeKindFor(ref.kind);
      const key = `${ref.scopeId}\u0000${b.dst}\u0000${kind}`;
      const prev = seen.get(key);
      if (prev) {
        prev.weight = (prev.weight ?? 1) + 1; // repeated calls strengthen the edge
        prev.confidence = Math.max(prev.confidence ?? 0, b.confidence);
        continue;
      }
      const e: EdgeRecord = { src: ref.scopeId, dst: b.dst, kind, source: b.confidence >= 0.9 ? 'treesitter' : 'heuristic', confidence: b.confidence, weight: 1 };
      seen.set(key, e);
      out.push(e);
      // tests: test code that invokes production code
      if (kind === 'invokes' && testCode(ref.scopeId) && !testCode(b.dst)) {
        out.push({ src: ref.scopeId, dst: b.dst, kind: 'tests', source: 'heuristic', confidence: b.confidence, weight: 1 });
      }
    }
  }
  // tests at file level: a test file importing a production file, or named after one (FooTest → Foo)
  if (isTestSymbol('file', path)) {
    const targets = new Set<string>();
    for (const target of idx.importsOf.get(path) ?? []) if (!isTestSymbol('file', target)) targets.add(target);
    const subject = testSubjectName(path);
    if (subject) {
      for (const cand of idx.byName.get(subject) ?? []) {
        if (!isTestSymbol(cand.kind, cand.path) && cand.path.slice(cand.path.lastIndexOf('/') + 1).startsWith(subject)) targets.add(cand.path);
      }
      for (const [p] of idx.byPath) {
        const base = p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
        if (base === subject && !isTestSymbol('file', p)) targets.add(p);
      }
    }
    for (const t of targets) out.push({ src: file, dst: fileId(t), kind: 'tests', source: 'heuristic', confidence: 0.8, weight: 1 });
  }
  // overrides: a method whose class inherits from a class/interface declaring a method of the same name
  for (const s of syms) {
    if (s.kind !== 'class' && s.kind !== 'struct' && s.kind !== 'interface') continue;
    const bases = [...seen.values()].filter((e) => e.src === s.id && e.kind === 'inherits').map((e) => e.dst);
    if (bases.length === 0) continue;
    const members = syms.filter((m) => m.parentId === s.id && (m.kind === 'method' || m.kind === 'property'));
    for (const base of bases) {
      const baseMembers = (idx.byPath.get(idx.byId.get(base)?.path ?? '') ?? []).filter((m) => m.parentId === base);
      for (const m of members) {
        const over = baseMembers.find((b) => b.name === m.name && b.kind === m.kind);
        if (over) out.push({ src: m.id, dst: over.id, kind: 'overrides', source: 'heuristic', confidence: 0.9, weight: 1 });
      }
    }
  }
  return out;
}

/**
 * Runs the graph stage: rebuilds outgoing edges for files whose blobs changed, plus unchanged files
 * whose references pointed into changed files or may now bind to newly defined names.
 */
export function runGraphStage(store: Store, opts: { events?: EventBus<PipelineEvents>; force?: string[] } = {}): GraphStageResult {
  const t0 = performance.now();
  const pending = store.merkle.changedSince(GRAPH_STAGE).map((b) => b.path);
  const changed = [...new Set([...pending, ...(opts.force ?? [])])];
  opts.events?.emit('stage:start', { stage: GRAPH_STAGE, pending: changed.length });
  if (changed.length === 0) {
    const ms = performance.now() - t0;
    opts.events?.emit('stage:end', { stage: GRAPH_STAGE, changed: 0, ms });
    return { changed: [], affected: [], edges: 0, ms };
  }
  const idx = SymbolIndex.load(store);
  const changedSet = new Set(changed);
  const affected = new Set<string>();
  const firstRun = store.edges.count() === 0;
  const namesKey = (p: string) => `graph.names:${p}`;
  const currentNames = new Map<string, Set<string>>();
  for (const p of changed) currentNames.set(p, new Set((idx.byPath.get(p) ?? []).filter((s) => s.kind !== 'file').map((s) => s.name)));
  if (!firstRun) {
    for (const p of changed) {
      // edges from unchanged files that now dangle (a symbol was renamed, removed or changed kind)
      for (const e of store.edges.incomingToPath(p)) {
        if (idx.byId.has(e.dst)) continue;
        const src = idx.byId.get(e.src);
        const srcPath = src?.path ?? e.src.slice(0, e.src.indexOf('#'));
        if (!changedSet.has(srcPath)) affected.add(srcPath);
      }
      // references elsewhere that may now bind to names this change introduced
      const before = new Set<string>(JSON.parse(store.kv.get(namesKey(p)) ?? '[]') as string[]);
      for (const name of currentNames.get(p)!) {
        if (before.has(name)) continue;
        for (const r of store.refs.byName(name)) if (!changedSet.has(r.path)) affected.add(r.path);
      }
    }
  }
  const rebuild = [...changed, ...affected].filter((p) => idx.byPath.has(p) || store.merkle.getBlob(p));
  let edges = 0;
  store.driver.transaction(() => {
    for (const p of rebuild) {
      store.edges.deleteOutgoingFromPath(p, OWNED_SOURCES);
      const es = edgesForFile(store, idx, p);
      store.edges.upsertMany(es);
      edges += es.length;
    }
    store.edges.deleteDangling();
    for (const [p, names] of currentNames) {
      if (idx.byPath.has(p)) store.kv.set(namesKey(p), JSON.stringify([...names].sort()));
      else store.kv.delete(namesKey(p));
    }
    store.merkle.markDone(GRAPH_STAGE, pending);
    store.kv.set(GRAPH_VERSION_KEY, String(Number(store.kv.get(GRAPH_VERSION_KEY) ?? '0') + 1));
  });
  const ms = performance.now() - t0;
  opts.events?.emit('stage:end', { stage: GRAPH_STAGE, changed: changed.length, ms });
  return { changed, affected: [...affected].sort(), edges, ms };
}
