import type { SymbolId } from '@riaf/kernel';
import { closure, type ClosureHit } from './closure.js';
import { testsFor } from './tests.js';
import type { GraphView } from './view.js';

/**
 * Blast radius of a change to `symbols`: everything that depends on them (reverse closure through
 * invokes, references, inherits, overrides and type use), the tests that exercise the affected set,
 * and co-change partners recorded by @riaf/history as `co_changes` edges.
 */

export interface CoChangePartner {
  symbol: SymbolId;
  support: number;
  confidence: number;
}

export interface Impact {
  closure: ClosureHit[];
  coChange: CoChangePartner[];
  tests: SymbolId[];
}

/** Computes the impact of changing `symbols` up to `hops` dependency hops. */
export function impact(view: GraphView, symbols: readonly SymbolId[], hops = 2): Impact {
  const dependents = closure(view, symbols, { hops, direction: 'in', kinds: ['invokes', 'references', 'inherits', 'overrides', 'defines_type', 'imports'], maxNodes: 300 });
  // members of a changed class are affected too
  const seeds = new Set(symbols);
  const affected = [...symbols, ...dependents.map((d) => d.symbol)];
  const coChange: CoChangePartner[] = [];
  const seenCo = new Set<number>();
  for (const s of symbols) {
    const i = view.idx(s);
    if (i === undefined) continue;
    for (const e of [...view.out[i]!, ...view.in[i]!]) {
      if (e.kind !== 'co_changes' || seenCo.has(e.to) || seeds.has(view.ids[e.to]!)) continue;
      seenCo.add(e.to);
      coChange.push({ symbol: view.ids[e.to]!, support: Math.round(e.weight), confidence: Math.min(1, e.weight / Math.max(1, e.weight + 1)) });
    }
  }
  coChange.sort((a, b) => b.support - a.support);
  const tests = testsFor(view, affected);
  return { closure: dependents.filter((d) => !tests.includes(d.symbol)), coChange, tests };
}
