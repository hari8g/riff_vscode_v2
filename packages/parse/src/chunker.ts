import { estimateTokens } from '@riaf/kernel';
import type { DefTag } from './treesitter/tags.js';

/**
 * AST-aligned chunking from definition tags. Chunks follow definition boundaries; a container that is
 * over the cap is split into its header, its members and its trailer; a function is never split, even
 * when it is over the cap; consecutive small segments are merged up to the cap so file-scope glue
 * (imports, small constants) does not become dozens of one-line chunks.
 */

export interface Chunk {
  /** Stable within a blob: `path:startLine`. */
  id: string;
  startLine: number; // 1-based, inclusive
  endLine: number;
  tokens: number;
  content: string;
  /** Qualified names of the definitions that start inside this chunk. */
  symbols: string[];
}

export interface ChunkOptions {
  /** Soft token cap per chunk. */
  maxTokens?: number;
}

interface Segment {
  start: number; // 1-based line
  end: number;
  symbols: string[];
}

export const DEFAULT_CHUNK_TOKENS = 512;

/** Splits a file into AST-aligned chunks using its definitions. Works for any language tags.ts supports. */
export function chunkFile(path: string, source: string, defs: readonly DefTag[], opts: ChunkOptions = {}): Chunk[] {
  const cap = opts.maxTokens ?? DEFAULT_CHUNK_TOKENS;
  const lines = source.split('\n');
  if (source.length === 0) return [];
  const text = (s: number, e: number) => lines.slice(s - 1, e).join('\n');
  const tok = (s: number, e: number) => estimateTokens(text(s, e));

  const children = new Map<string | undefined, DefTag[]>();
  for (const d of defs) {
    const k = d.parent;
    const list = children.get(k) ?? [];
    list.push(d);
    children.set(k, list);
  }
  const descendants = (d: DefTag): string[] => [d.qualifiedName, ...(children.get(d.qualifiedName) ?? []).flatMap(descendants)];

  // Segments for a line span [from, to] containing the definitions `level` (sorted, non-overlapping).
  const segmentSpan = (from: number, to: number, level: readonly DefTag[]): Segment[] => {
    const out: Segment[] = [];
    let cursor = from;
    for (const d of [...level].sort((a, b) => a.startLine - b.startLine)) {
      if (d.startLine < cursor) continue; // overlapping tag (e.g. same-line nested); covered already
      if (d.startLine > cursor) out.push({ start: cursor, end: d.startLine - 1, symbols: [] });
      const end = Math.min(d.endLine, to);
      const kids = children.get(d.qualifiedName) ?? [];
      if (tok(d.startLine, end) <= cap || kids.length === 0) {
        out.push({ start: d.startLine, end, symbols: descendants(d) });
      } else {
        const inner = kids.filter((k) => k.startLine > d.startLine && k.endLine <= end);
        const firstKid = Math.min(...inner.map((k) => k.startLine), end);
        out.push({ start: d.startLine, end: Math.max(d.startLine, firstKid - 1), symbols: [d.qualifiedName] });
        const bodyFrom = Math.max(d.startLine, firstKid - 1) + 1;
        if (bodyFrom <= end) out.push(...segmentSpan(bodyFrom, end, inner));
      }
      cursor = end + 1;
    }
    if (cursor <= to) out.push({ start: cursor, end: to, symbols: [] });
    return out;
  };

  const segments = segmentSpan(1, lines.length, children.get(undefined) ?? []).filter((s) => s.end >= s.start);

  // Merge consecutive segments while they fit under the cap.
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && tok(last.start, s.end) <= cap) {
      last.end = s.end;
      last.symbols.push(...s.symbols);
    } else {
      merged.push({ ...s, symbols: [...s.symbols] });
    }
  }

  const out: Chunk[] = [];
  for (const s of merged) {
    // Trim blank lines at both ends so chunk ranges point at code.
    let a = s.start;
    let b = s.end;
    while (a < b && lines[a - 1]!.trim() === '') a++;
    while (b > a && lines[b - 1]!.trim() === '') b--;
    const content = text(a, b);
    if (content.trim() === '') continue;
    out.push({ id: `${path}:${a}`, startLine: a, endLine: b, tokens: estimateTokens(content), content, symbols: s.symbols });
  }
  return out;
}
