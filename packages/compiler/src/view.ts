import type { SymbolId } from '@riaf/kernel';
import type { Graph } from '@riaf/graph';
import type { Semantic } from '@riaf/semantic';
import type { Store } from '@riaf/store';

/** History facts the compiler can use; supplied by @riaf/history from M4 (optional before). */
export interface HistoryFacts {
  /** Most recent commits that touched the symbol's lines (blame per symbol). */
  blame(symbol: SymbolId, limit?: number): { commit: string; at: string; summary: string; author?: string }[];
  /** Reverts and incident-marked commits touching the symbol. */
  incidents(symbol: SymbolId, limit?: number): { commit: string; at: string; summary: string; kind: 'revert' | 'incident' | 'fix' }[];
  /** Commits that introduced the symbol (its origin), for sibling templates. */
  origin(symbol: SymbolId): { commit: string; at: string; summary: string; files: string[] } | undefined;
  /** Newest non-noise commits touching a path — sees deletions, which blame cannot. */
  recent?(path: string, limit?: number): { commit: string; at: string; summary: string }[];
  /** ADRs and post-mortems that mention the symbol or its file. */
  adrs(symbol: SymbolId, limit?: number): { path: string; title: string; excerpt: string }[];
}

/** Everything the compiler reads. The daemon builds one per repository. */
export interface RepoView {
  repoName: string;
  store: Store;
  graph: Graph;
  semantic: Semantic;
  history?: HistoryFacts;
  /** HEAD commit, stamped into the pack. */
  commit?: string;
  /** Hand-written run-book constraints (`.riaf/constraints.md`). */
  constraints?: string;
}

/** Reconstructs a file's lines from its stored chunks (blank gaps between chunks become empty lines). */
export function fileLines(store: Store, path: string): string[] {
  const out: string[] = [];
  for (const c of store.chunks.byPath(path)) {
    const lines = c.content.split('\n');
    for (let i = 0; i < lines.length; i++) out[c.startLine - 1 + i] = lines[i]!;
  }
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
  return out;
}

/** 1-based inclusive line range of a file as text. */
export function sliceLines(lines: readonly string[], start: number, end: number): string {
  return lines.slice(Math.max(0, start - 1), Math.max(start - 1, end)).join('\n');
}
