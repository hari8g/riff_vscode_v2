import type { SymbolId } from '@riaf/kernel';
import type { EdgeKind, Store, SymbolRecord } from '@riaf/store';
import { GRAPH_VERSION_KEY } from './build.js';

/**
 * A read-only, in-memory adjacency view of the symbol graph for whole-graph algorithms (PageRank,
 * closure, clustering). Rebuilt lazily when the graph stage bumps `graph.version`.
 */

export interface Adj {
  to: number;
  kind: EdgeKind;
  weight: number;
}

export const STRUCTURAL_KINDS: readonly EdgeKind[] = ['invokes', 'references', 'inherits', 'overrides', 'defines_type', 'imports', 'tests', 'co_changes'];

export class GraphView {
  readonly ids: SymbolId[] = [];
  readonly index = new Map<SymbolId, number>();
  readonly symbols: SymbolRecord[] = [];
  readonly out: Adj[][] = [];
  readonly in: Adj[][] = [];
  /** child → parent index (contains edges), -1 for roots. */
  readonly parent: number[] = [];
  /** parent → children indexes. */
  readonly children: number[][] = [];

  private constructor(readonly version: string) {}

  static build(store: Store): GraphView {
    const v = new GraphView(store.kv.get(GRAPH_VERSION_KEY) ?? '0');
    for (const s of store.symbols.all()) {
      v.index.set(s.id, v.ids.length);
      v.ids.push(s.id);
      v.symbols.push(s);
      v.out.push([]);
      v.in.push([]);
      v.parent.push(-1);
      v.children.push([]);
    }
    for (const s of v.symbols) {
      if (s.parentId) {
        const p = v.index.get(s.parentId);
        if (p !== undefined) {
          const c = v.index.get(s.id)!;
          v.parent[c] = p;
          v.children[p]!.push(c);
        }
      }
    }
    for (const e of store.edges.allOfKinds(STRUCTURAL_KINDS)) {
      const a = v.index.get(e.src);
      const b = v.index.get(e.dst);
      if (a === undefined || b === undefined || a === b) continue;
      const w = e.weight * e.confidence;
      v.out[a]!.push({ to: b, kind: e.kind, weight: w });
      v.in[b]!.push({ to: a, kind: e.kind, weight: w });
    }
    return v;
  }

  get size(): number {
    return this.ids.length;
  }

  idx(id: SymbolId): number | undefined {
    return this.index.get(id);
  }
}

/** Caches one GraphView per store and rebuilds it when the graph version changes. */
export class GraphViewCache {
  private view: GraphView | undefined;
  constructor(private readonly store: Store) {}
  get(): GraphView {
    const ver = this.store.kv.get(GRAPH_VERSION_KEY) ?? '0';
    if (!this.view || this.view.version !== ver) this.view = GraphView.build(this.store);
    return this.view;
  }
}

export interface PprOptions {
  damping?: number;
  iterations?: number;
  tolerance?: number;
  /** Weight of reverse edges (callee → caller), so anchors also lift their callers. */
  reverseWeight?: number;
  /** Edge kinds to walk; defaults to every structural kind. */
  kinds?: readonly EdgeKind[];
}

/**
 * Personalized PageRank seeded on `anchors` (uniform restart over them; global PageRank when empty).
 * Containment propagates rank to parents at a small weight so a hot method lifts its class and file.
 * Returns a score per node index, summing to 1.
 */
export function personalizedPageRank(view: GraphView, anchors: readonly SymbolId[], opts: PprOptions = {}): Float64Array {
  const n = view.size;
  const d = opts.damping ?? 0.85;
  const iters = opts.iterations ?? 50;
  const tol = opts.tolerance ?? 1e-9;
  const rev = opts.reverseWeight ?? 0.3;
  const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
  const restart = new Float64Array(n);
  const seeds = anchors.map((a) => view.idx(a)).filter((i): i is number => i !== undefined);
  if (seeds.length) for (const s of seeds) restart[s]! += 1 / seeds.length;
  else restart.fill(n ? 1 / n : 0);

  // Weighted out-adjacency including reverse and containment links.
  const links: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (let a = 0; a < n; a++) {
    for (const e of view.out[a]!) {
      if (kinds && !kinds.has(e.kind)) continue;
      links[a]!.push({ to: e.to, w: e.weight });
      links[e.to]!.push({ to: a, w: e.weight * rev });
    }
    const p = view.parent[a]!;
    if (p >= 0) {
      links[a]!.push({ to: p, w: 0.25 });
      links[p]!.push({ to: a, w: 0.05 });
    }
  }
  const totals = links.map((l) => l.reduce((s, x) => s + x.w, 0));

  let rank = Float64Array.from(restart);
  let next = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    next.fill(0);
    let dangling = 0;
    for (let a = 0; a < n; a++) {
      const r = rank[a]!;
      if (r === 0) continue;
      const tot = totals[a]!;
      if (tot === 0) {
        dangling += r;
        continue;
      }
      for (const l of links[a]!) next[l.to]! += (d * r * l.w) / tot;
    }
    let delta = 0;
    for (let i = 0; i < n; i++) {
      next[i]! += (1 - d + d * dangling) * restart[i]!;
      delta += Math.abs(next[i]! - rank[i]!);
    }
    [rank, next] = [next, rank];
    if (delta < tol) break;
  }
  return rank;
}

/** Top-k symbols by PPR score, excluding the anchors themselves unless `includeAnchors`. */
export function rankSymbols(view: GraphView, scores: Float64Array, k: number, opts: { includeAnchors?: boolean; anchors?: readonly SymbolId[]; exclude?: (s: SymbolRecord) => boolean } = {}): { symbol: SymbolRecord; score: number }[] {
  const anchorSet = new Set(opts.anchors ?? []);
  const out: { symbol: SymbolRecord; score: number }[] = [];
  for (let i = 0; i < view.size; i++) {
    const s = view.symbols[i]!;
    if (!opts.includeAnchors && anchorSet.has(s.id)) continue;
    if (opts.exclude?.(s)) continue;
    if (scores[i]! > 0) out.push({ symbol: s, score: scores[i]! });
  }
  return out.sort((a, b) => b.score - a.score || (a.symbol.id < b.symbol.id ? -1 : 1)).slice(0, k);
}
