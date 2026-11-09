import type { SqliteDriver } from './driver/types.js';

/**
 * Trigram postings for instant literal search and regex pre-filtering (the "Instant Grep" idea).
 * Postings are per chunk; a query extracts its trigrams, intersects the postings to a candidate set,
 * then confirms against chunk content so results are exact.
 */

export interface TrigramHit {
  chunkId: string;
  path: string;
  line: number; // 1-based within the file
  text: string;
}

export function trigramsOf(text: string): Set<string> {
  const s = text.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    if (/\s/.test(g)) continue; // whitespace-spanning grams add noise, not selectivity
    out.add(g);
  }
  return out;
}

export class TrigramIndex {
  constructor(private readonly db: SqliteDriver) {}

  index(chunkId: string, content: string): void {
    this.db.run('DELETE FROM trigram WHERE chunk_id = ?', [chunkId]);
    for (const g of trigramsOf(content)) this.db.run('INSERT OR IGNORE INTO trigram(gram, chunk_id) VALUES (?, ?)', [g, chunkId]);
  }

  indexMany(rows: readonly { chunkId: string; content: string }[]): void {
    this.db.transaction(() => {
      for (const r of rows) this.index(r.chunkId, r.content);
    });
  }

  removeChunk(chunkId: string): void {
    this.db.run('DELETE FROM trigram WHERE chunk_id = ?', [chunkId]);
  }

  /** Chunk ids that contain every trigram of `literal` (candidates; may include false positives). */
  candidates(literal: string, limit = 500): string[] {
    const grams = [...trigramsOf(literal)];
    if (grams.length === 0) {
      return this.db.all<{ id: string }>('SELECT id FROM chunk LIMIT ?', [limit]).map((r) => r.id);
    }
    // Start from the rarest gram to keep the intersection small.
    const counts = grams.map((g) => ({ g, n: Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trigram WHERE gram = ?', [g])?.n ?? 0) }));
    counts.sort((a, b) => a.n - b.n);
    const first = counts[0]!;
    if (first.n === 0) return [];
    let set = new Set(this.db.all<{ chunk_id: string }>('SELECT chunk_id FROM trigram WHERE gram = ?', [first.g]).map((r) => r.chunk_id));
    for (const { g } of counts.slice(1, 8)) {
      if (set.size === 0) break;
      const next = new Set(this.db.all<{ chunk_id: string }>('SELECT chunk_id FROM trigram WHERE gram = ?', [g]).map((r) => r.chunk_id));
      set = new Set([...set].filter((id) => next.has(id)));
    }
    return [...set].slice(0, limit);
  }

  /** Exact literal search (case-insensitive) confirmed against content, with line numbers. */
  search(literal: string, limit = 50): TrigramHit[] {
    const ids = this.candidates(literal);
    if (ids.length === 0) return [];
    const needle = literal.toLowerCase();
    const hits: TrigramHit[] = [];
    for (const id of ids) {
      const row = this.db.get<{ path: string; start_line: number; content: string }>('SELECT path, start_line, content FROM chunk WHERE id = ?', [id]);
      if (!row) continue;
      const lines = row.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLowerCase().includes(needle)) {
          hits.push({ chunkId: id, path: row.path, line: Number(row.start_line) + i, text: lines[i]! });
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  }

  /** Regex search: trigram prefilter from the regex's literal fragments, then a real regex pass. */
  searchRegex(pattern: string, flags = 'i', limit = 50): TrigramHit[] {
    const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
    const literal = longestLiteral(pattern);
    const ids = literal.length >= 3 ? this.candidates(literal) : this.db.all<{ id: string }>('SELECT id FROM chunk').map((r) => r.id);
    const hits: TrigramHit[] = [];
    for (const id of ids) {
      const row = this.db.get<{ path: string; start_line: number; content: string }>('SELECT path, start_line, content FROM chunk WHERE id = ?', [id]);
      if (!row) continue;
      const lines = row.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i]!)) {
          hits.push({ chunkId: id, path: row.path, line: Number(row.start_line) + i, text: lines[i]! });
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  }
}

/** Longest run of plain literal characters in a regex source, used as the trigram prefilter. */
export function longestLiteral(pattern: string): string {
  let best = '';
  let cur = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next !== undefined && /[.*+?^${}()|[\]\\-]/.test(next)) {
        cur += next; // an escaped metacharacter is a literal character
      } else if (next !== undefined && /[A-Za-z0-9_]/.test(next) && !/[dDwWsSbBnrtfvpPk0-9]/.test(next)) {
        cur += next;
      } else {
        if (cur.length > best.length) best = cur; // a class like \w or \d breaks the literal run
        cur = '';
      }
      i++;
      continue;
    }
    if (/[.*+?^${}()|[\]]/.test(ch)) {
      // a quantifier applies to the previous literal char, which is then not guaranteed
      if (/[*+?{]/.test(ch) && cur.length > 0) cur = cur.slice(0, -1);
      if (cur.length > best.length) best = cur;
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > best.length) best = cur;
  return best;
}
