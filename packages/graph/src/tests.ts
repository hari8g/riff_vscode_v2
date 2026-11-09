import type { SymbolId } from '@riaf/kernel';
import type { GraphView } from './view.js';

/**
 * Test ↔ symbol mapping from `tests` edges (test code invoking production code, and test files
 * importing production files). A symbol is covered by the tests that reach it or any of its members.
 */

/** Tests that exercise any of `symbols` (or their members, or their files). Sorted, unique. */
export function testsFor(view: GraphView, symbols: readonly SymbolId[]): SymbolId[] {
  const targets = new Set<number>();
  for (const s of symbols) {
    const i = view.idx(s);
    if (i === undefined) continue;
    targets.add(i);
    // the file containing the symbol (file-level tests edges)
    let p = view.parent[i]!;
    while (p >= 0) {
      if (view.symbols[p]!.kind === 'file') targets.add(p);
      p = view.parent[p]!;
    }
  }
  // members of a target class are targets too
  const stack = [...targets].filter((t) => view.symbols[t]!.kind !== 'file');
  while (stack.length) {
    for (const c of view.children[stack.pop()!]!) {
      if (!targets.has(c)) {
        targets.add(c);
        stack.push(c);
      }
    }
  }
  const out = new Set<SymbolId>();
  for (const t of targets) {
    for (const e of view.in[t]!) if (e.kind === 'tests') out.add(view.ids[e.to]!);
  }
  return [...out].sort();
}

/** Production symbols a test exercises (direct `tests` edges). */
export function exercisedBy(view: GraphView, test: SymbolId): SymbolId[] {
  const i = view.idx(test);
  if (i === undefined) return [];
  const out = new Set<SymbolId>();
  const stack = [i];
  const seen = new Set<number>();
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of view.out[n]!) if (e.kind === 'tests') out.add(view.ids[e.to]!);
    // nested test blocks belong to the outer test
    stack.push(...view.children[n]!);
  }
  return [...out].sort();
}
