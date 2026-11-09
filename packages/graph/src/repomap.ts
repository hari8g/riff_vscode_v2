import { estimateTokens, type SymbolId } from '@riaf/kernel';
import type { SymbolRecord } from '@riaf/store';
import { personalizedPageRank, type GraphView } from './view.js';

/**
 * The repo map (Aider-style): a signature-only outline of the most relevant files and symbols,
 * ranked by personalized PageRank from the anchors and cut to a token budget. Files are ordered by
 * their best symbol; inside a file, symbols keep source order and nesting.
 */

export interface RepoMapOptions {
  budget: number;
  /** Symbol kinds shown; files and tests are never listed as entries. */
  kinds?: ReadonlySet<string>;
  /** Hide symbols under test files. Default true. */
  hideTests?: boolean;
  /** Precomputed scores (e.g. shared with the compiler); computed from anchors otherwise. */
  scores?: Float64Array;
}

export interface RepoMap {
  text: string;
  tokens: number;
  files: string[];
  symbols: SymbolId[];
}

export const MAP_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'type', 'function', 'method', 'constructor', 'namespace', 'module']);
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/;

function depthOf(view: GraphView, i: number): number {
  let depth = 0;
  let p = view.parent[i]!;
  while (p >= 0 && view.symbols[p]!.kind !== 'file') {
    depth++;
    p = view.parent[p]!;
  }
  return depth;
}

function lineOf(view: GraphView, i: number): string {
  const s = view.symbols[i]!;
  return `${'  '.repeat(depthOf(view, i) + 1)}${s.signature ?? `${s.kind} ${s.name}`}`;
}

/** Renders chosen symbol indexes as the map text, files ordered by `fileOrder`. */
export function renderMap(view: GraphView, chosen: Iterable<number>, fileOrder?: readonly string[]): { text: string; files: string[] } {
  const byFile = new Map<string, number[]>();
  for (const i of chosen) {
    const f = view.symbols[i]!.path;
    const list = byFile.get(f) ?? [];
    list.push(i);
    byFile.set(f, list);
  }
  const files = fileOrder ? fileOrder.filter((f) => byFile.has(f)) : [...byFile.keys()].sort();
  const lines: string[] = [];
  for (const f of files) {
    lines.push(`${f}:`);
    for (const i of byFile.get(f)!.sort((a, b) => (view.symbols[a]!.startLine ?? 0) - (view.symbols[b]!.startLine ?? 0))) lines.push(lineOf(view, i));
  }
  return { text: lines.join('\n'), files };
}

/** Builds a repo map from PPR over `anchors` (global rank when empty) under `opts.budget` tokens. */
export function repoMap(view: GraphView, anchors: readonly SymbolId[], opts: RepoMapOptions): RepoMap {
  const kinds = opts.kinds ?? MAP_KINDS;
  const hideTests = opts.hideTests ?? true;
  const scores = opts.scores ?? personalizedPageRank(view, anchors);
  const eligible = (s: SymbolRecord) => kinds.has(s.kind) && !(hideTests && TEST_PATH.test(s.path));
  const ranked: number[] = [];
  for (let i = 0; i < view.size; i++) if (eligible(view.symbols[i]!)) ranked.push(i);
  ranked.sort((a, b) => scores[b]! - scores[a]! || (view.ids[a]! < view.ids[b]! ? -1 : 1));

  // Greedy by rank with incremental cost: a member drags in its eligible ancestors (so nesting
  // renders) and a new file costs its header line.
  const chosen = new Set<number>();
  const files = new Set<string>();
  let used = 0;
  let misses = 0;
  for (const i of ranked) {
    if (chosen.has(i)) continue;
    const add = [i];
    for (let p = view.parent[i]!; p >= 0 && view.symbols[p]!.kind !== 'file'; p = view.parent[p]!) {
      if (!chosen.has(p) && eligible(view.symbols[p]!)) add.push(p);
    }
    const f = view.symbols[i]!.path;
    let cost = add.reduce((s, a) => s + estimateTokens(lineOf(view, a)) + 1, 0);
    if (!files.has(f)) cost += estimateTokens(`${f}:`) + 1;
    if (used + cost > opts.budget) {
      if (++misses > 200 || opts.budget - used < 8) break;
      continue;
    }
    for (const a of add) chosen.add(a);
    files.add(f);
    used += cost;
  }
  const fileBest = new Map<string, number>();
  for (const i of chosen) {
    const f = view.symbols[i]!.path;
    fileBest.set(f, Math.max(fileBest.get(f) ?? 0, scores[i]!));
  }
  const order = [...fileBest.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f);
  let { text } = renderMap(view, chosen, order);
  let tokens = estimateTokens(text);
  // The incremental estimate is per line; trim the lowest-ranked entries if the whole text overshoots.
  const byRank = [...chosen].sort((a, b) => scores[a]! - scores[b]!);
  while (tokens > opts.budget && byRank.length) {
    const drop = byRank.shift()!;
    if ([...chosen].some((c) => view.parent[c] === drop)) continue; // keep parents of kept members
    chosen.delete(drop);
    ({ text } = renderMap(view, chosen, order));
    tokens = estimateTokens(text);
  }
  const kept = order.filter((f) => [...chosen].some((i) => view.symbols[i]!.path === f));
  return { text, tokens, files: kept, symbols: [...chosen].map((i) => view.ids[i]!) };
}
