import { estimateTokens, type SymbolId } from '@riaf/kernel';
import type { EdgeKind } from '@riaf/store';
import type { GraphView } from './view.js';

/**
 * Graph traversals the compiler's expansion rules and riaf_impact call: callers, callees, the
 * inheritance tree, dynamic-dispatch sites, and a bounded reference closure with cost accounting.
 */

export interface ClosureHit {
  symbol: SymbolId;
  distance: number;
  /** Edge kind of the last hop, prefixed with `<-` when walked backwards (e.g. `<-invokes` = caller). */
  via: string;
  /** Estimated tokens to show this symbol's signature (the compiler charges bodies separately). */
  cost: number;
  /** Product of edge confidences along the path. */
  confidence: number;
}

export interface ClosureOptions {
  hops?: number;
  /** Walk outgoing edges (dependencies), incoming edges (dependents), or both. */
  direction?: 'out' | 'in' | 'both';
  kinds?: readonly EdgeKind[];
  maxNodes?: number;
  /** Stop when the summed signature cost exceeds this many tokens. */
  maxCost?: number;
  minConfidence?: number;
}

const DEFAULT_KINDS: readonly EdgeKind[] = ['invokes', 'references', 'inherits', 'overrides', 'defines_type'];

/** Breadth-first closure from `seeds`; distance-0 seeds are excluded from the result. */
export function closure(view: GraphView, seeds: readonly SymbolId[], opts: ClosureOptions = {}): ClosureHit[] {
  const hops = opts.hops ?? 2;
  const dir = opts.direction ?? 'both';
  const kinds = new Set(opts.kinds ?? DEFAULT_KINDS);
  const maxNodes = opts.maxNodes ?? 500;
  const maxCost = opts.maxCost ?? Number.POSITIVE_INFINITY;
  const minConf = opts.minConfidence ?? 0.05;
  const seen = new Map<number, ClosureHit>();
  let frontier: { i: number; conf: number }[] = [];
  for (const s of seeds) {
    const i = view.idx(s);
    if (i !== undefined && !seen.has(i)) {
      seen.set(i, { symbol: s, distance: 0, via: 'seed', cost: 0, confidence: 1 });
      frontier.push({ i, conf: 1 });
    }
  }
  const out: ClosureHit[] = [];
  let cost = 0;
  for (let d = 1; d <= hops && frontier.length; d++) {
    const next: { i: number; conf: number }[] = [];
    // strongest edges first so the caps keep the most relevant neighbours
    const steps: { to: number; via: string; conf: number }[] = [];
    for (const { i, conf } of frontier) {
      if (dir !== 'in') for (const e of view.out[i]!) if (kinds.has(e.kind)) steps.push({ to: e.to, via: e.kind, conf: conf * Math.min(1, e.weight) });
      if (dir !== 'out') for (const e of view.in[i]!) if (kinds.has(e.kind)) steps.push({ to: e.to, via: `<-${e.kind}`, conf: conf * Math.min(1, e.weight) });
    }
    steps.sort((a, b) => b.conf - a.conf);
    for (const s of steps) {
      if (seen.has(s.to) || s.conf < minConf) continue;
      const sym = view.symbols[s.to]!;
      if (sym.kind === 'file') continue;
      const c = estimateTokens(sym.signature ?? sym.name);
      if (cost + c > maxCost || out.length >= maxNodes) return out;
      const hit: ClosureHit = { symbol: sym.id, distance: d, via: s.via, cost: c, confidence: s.conf };
      seen.set(s.to, hit);
      out.push(hit);
      cost += c;
      next.push({ i: s.to, conf: s.conf });
    }
    frontier = next;
  }
  return out;
}

/** Direct and transitive callers of `symbol` (incoming invokes), nearest first. */
export function callers(view: GraphView, symbol: SymbolId, hops = 1): ClosureHit[] {
  return closure(view, [symbol], { hops, direction: 'in', kinds: ['invokes'] });
}

/** Direct and transitive callees of `symbol` (outgoing invokes), nearest first. */
export function callees(view: GraphView, symbol: SymbolId, hops = 1): ClosureHit[] {
  return closure(view, [symbol], { hops, direction: 'out', kinds: ['invokes'] });
}

export interface InheritanceTree {
  ancestors: SymbolId[];
  descendants: SymbolId[];
}

/** Ancestors (what `symbol` inherits from) and descendants (what inherits from it), transitively. */
export function inheritanceTree(view: GraphView, symbol: SymbolId, maxDepth = 6): InheritanceTree {
  const walk = (dirOut: boolean): SymbolId[] => {
    const start = view.idx(symbol);
    if (start === undefined) return [];
    const seen = new Set<number>([start]);
    const out: SymbolId[] = [];
    let frontier = [start];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (const e of dirOut ? view.out[i]! : view.in[i]!) {
          if (e.kind !== 'inherits' || seen.has(e.to)) continue;
          seen.add(e.to);
          out.push(view.ids[e.to]!);
          next.push(e.to);
        }
      }
      frontier = next;
    }
    return out;
  };
  return { ancestors: walk(true), descendants: walk(false) };
}

/**
 * Call sites that may dispatch dynamically to `method`: callers of the method itself, of the methods
 * it overrides, and of the methods that override it (the whole override family).
 */
export function dynamicDispatchSites(view: GraphView, method: SymbolId): ClosureHit[] {
  const start = view.idx(method);
  if (start === undefined) return [];
  const family = new Set<number>([start]);
  let frontier = [start];
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const e of [...view.out[i]!, ...view.in[i]!]) {
        if (e.kind === 'overrides' && !family.has(e.to)) {
          family.add(e.to);
          next.push(e.to);
        }
      }
    }
    frontier = next;
  }
  const sites = new Map<number, ClosureHit>();
  for (const m of family) {
    for (const e of view.in[m]!) {
      if (e.kind !== 'invokes' || family.has(e.to) || sites.has(e.to)) continue;
      const s = view.symbols[e.to]!;
      sites.set(e.to, { symbol: s.id, distance: 1, via: `<-invokes:${view.symbols[m]!.qualifiedName}`, cost: estimateTokens(s.signature ?? s.name), confidence: Math.min(1, e.weight) });
    }
  }
  return [...sites.values()];
}
