import type { SymbolId } from '@riaf/kernel';
import type { EdgeKind } from '@riaf/store';
import type { GraphView } from './view.js';

/**
 * Whole-graph structural insights: where the code is load-bearing (hubs), where it is tangled
 * (high fan-out, import cycles), what nothing uses (unreferenced definitions) and which hubs no
 * test reaches. Computed from the in-memory view in one pass plus Tarjan's SCC over file imports.
 */

/** Edge kinds that mean "depends on" for fan-in / fan-out (containment and co-change are not dependencies). */
const DEPENDENCY_KINDS: ReadonlySet<EdgeKind> = new Set(['invokes', 'references', 'inherits', 'overrides', 'defines_type', 'imports']);
/** Definitions worth reporting; files, tests, parameters and the like are not. */
const DEFINITION_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'type', 'enum', 'function', 'method', 'const']);
/** Kinds that carry behaviour a test can exercise (types and constants cannot be "untested"). */
const BEHAVIOUR_KINDS: ReadonlySet<string> = new Set(['class', 'function', 'method']);
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.\w+$|_test\.\w+$|(^|\/)test_[^/]+$/;

export interface SymbolMetric {
  symbol: SymbolId;
  path: string;
  kind: string;
  /** Distinct dependants (symbols that invoke, reference, inherit or import it). */
  fanIn: number;
  /** Distinct dependencies. */
  fanOut: number;
  /** Tests that reach it directly. */
  tests: number;
}

export interface GraphInsights {
  totals: { symbols: number; files: number; edges: number; definitions: number; testedDefinitions: number };
  /** Most depended-on definitions: changes here ripple furthest. */
  hubs: SymbolMetric[];
  /** Definitions that depend on the most others: the hardest to read and test in isolation. */
  tangled: SymbolMetric[];
  /** Behavioural hubs (classes, functions, methods with fan-in ≥ 2) that no test reaches directly. */
  untestedHubs: SymbolMetric[];
  /** Non-test definitions nothing depends on and no test exercises: dead-code or entry-point candidates. */
  unreferenced: SymbolMetric[];
  /** Import cycles between files (each a strongly connected component of size ≥ 2), largest first. */
  cycles: string[][];
}

export interface InsightOptions {
  /** How many entries each ranked list keeps (default 10). */
  top?: number;
}

/** Computes structural insights over the current graph view. */
export function graphInsights(v: GraphView, opts: InsightOptions = {}): GraphInsights {
  const top = opts.top ?? 10;
  const metrics: SymbolMetric[] = [];
  let edges = 0;
  let files = 0;
  for (let i = 0; i < v.size; i++) {
    const s = v.symbols[i]!;
    edges += v.out[i]!.length;
    if (s.kind === 'file') { files++; continue; }
    if (!DEFINITION_KINDS.has(s.kind) || TEST_PATH.test(s.path)) continue;
    const ins = new Set<number>(), outs = new Set<number>(), tests = new Set<number>();
    for (const a of v.in[i]!) {
      if (a.kind === 'tests') tests.add(a.to);
      else if (DEPENDENCY_KINDS.has(a.kind) && !sameOwner(v, a.to, i)) ins.add(a.to);
    }
    for (const a of v.out[i]!) if (DEPENDENCY_KINDS.has(a.kind) && !sameOwner(v, i, a.to)) outs.add(a.to);
    metrics.push({ symbol: s.id, path: s.path, kind: s.kind, fanIn: ins.size, fanOut: outs.size, tests: tests.size });
  }
  const by = (k: keyof Pick<SymbolMetric, 'fanIn' | 'fanOut'>) => [...metrics].filter((m) => m[k] > 0).sort((a, b) => b[k] - a[k] || a.symbol.localeCompare(b.symbol));
  const hubs = by('fanIn');
  return {
    totals: { symbols: v.size, files, edges, definitions: metrics.length, testedDefinitions: metrics.filter((m) => m.tests > 0).length },
    hubs: hubs.slice(0, top),
    tangled: by('fanOut').slice(0, top),
    untestedHubs: hubs.filter((m) => BEHAVIOUR_KINDS.has(m.kind) && m.fanIn >= 2 && m.tests === 0 && !testedViaParent(v, m.symbol)).slice(0, top),
    unreferenced: metrics.filter((m) => m.fanIn === 0 && m.tests === 0 && !isEntryLike(v, m)).sort((a, b) => a.symbol.localeCompare(b.symbol)).slice(0, top * 3),
    cycles: importCycles(v),
  };
}

/** Fan-in, fan-out and direct tests of one symbol (undefined when it is not in the graph). */
export function symbolMetric(v: GraphView, id: SymbolId): SymbolMetric | undefined {
  const i = v.idx(id);
  if (i === undefined) return undefined;
  const s = v.symbols[i]!;
  const ins = new Set<number>(), outs = new Set<number>(), tests = new Set<number>();
  for (const a of v.in[i]!) {
    if (a.kind === 'tests') tests.add(a.to);
    else if (DEPENDENCY_KINDS.has(a.kind) && !sameOwner(v, a.to, i)) ins.add(a.to);
  }
  for (const a of v.out[i]!) if (DEPENDENCY_KINDS.has(a.kind) && !sameOwner(v, i, a.to)) outs.add(a.to);
  return { symbol: s.id, path: s.path, kind: s.kind, fanIn: ins.size, fanOut: outs.size, tests: tests.size + (testedViaParent(v, s.id) ? 1 : 0) };
}

/** True when `a` and `b` are the same symbol family (a member and its class), so self-use is not counted. */
function sameOwner(v: GraphView, a: number, b: number): boolean {
  return a === b || v.parent[a] === b || v.parent[b] === a;
}

/** A method counts as tested when its class is, and vice versa (tests often target one or the other). */
function testedViaParent(v: GraphView, id: SymbolId): boolean {
  const i = v.idx(id);
  if (i === undefined) return false;
  const p = v.parent[i]!;
  const hasTests = (k: number) => v.in[k]!.some((a) => a.kind === 'tests');
  return (p >= 0 && v.symbols[p]!.kind !== 'file' && hasTests(p)) || v.children[i]!.some(hasTests);
}

/** Constructors, members of used classes and module entry points are reached implicitly, not by name. */
function isEntryLike(v: GraphView, m: SymbolMetric): boolean {
  const i = v.idx(m.symbol)!;
  const s = v.symbols[i]!;
  if (s.name === 'constructor' || s.name === '__init__' || s.name === 'main') return true;
  const p = v.parent[i]!;
  if (p >= 0 && v.symbols[p]!.kind !== 'file') {
    // a member of a class that is itself used or tested is part of that class's surface
    return v.in[p]!.some((a) => DEPENDENCY_KINDS.has(a.kind) || a.kind === 'tests');
  }
  return /(^|\/)(index|main|bin|cli|server)\.\w+$/.test(s.path);
}

/** Tarjan's strongly connected components over file → file import edges. */
export function importCycles(v: GraphView): string[][] {
  const fileIdx: number[] = [];
  for (let i = 0; i < v.size; i++) if (v.symbols[i]!.kind === 'file') fileIdx.push(i);
  const index = new Map<number, number>(), low = new Map<number, number>(), on = new Set<number>(), stack: number[] = [];
  const out: string[][] = [];
  let counter = 0;
  const strong = (n: number) => {
    // iterative Tarjan to stay safe on deep import chains
    const work: { n: number; next: number }[] = [{ n, next: 0 }];
    index.set(n, counter); low.set(n, counter); counter++; stack.push(n); on.add(n);
    while (work.length) {
      const top = work[work.length - 1]!;
      const succ = v.out[top.n]!.filter((a) => a.kind === 'imports').map((a) => a.to);
      if (top.next < succ.length) {
        const w = succ[top.next++]!;
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++; stack.push(w); on.add(w);
          work.push({ n: w, next: 0 });
        } else if (on.has(w)) low.set(top.n, Math.min(low.get(top.n)!, index.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.n, Math.min(low.get(parent.n)!, low.get(top.n)!));
      if (low.get(top.n) === index.get(top.n)) {
        const comp: number[] = [];
        let w: number;
        do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== top.n);
        if (comp.length > 1) out.push(comp.map((c) => v.symbols[c]!.path).sort());
      }
    }
  };
  for (const f of fileIdx) if (!index.has(f)) strong(f);
  return out.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}
