import type { SqliteDriver } from './driver/types.js';
import { buildFtsQuery, toFtsText } from './identifiers.js';

export interface FtsHit {
  chunkId: string;
  path: string;
  /** Lower is better (FTS5 bm25 returns negative scores). */
  score: number;
}

/** FTS5-backed lexical search over chunks with identifier splitting. */
export class FtsIndex {
  constructor(private readonly db: SqliteDriver) {}

  index(chunkId: string, path: string, content: string): void {
    this.db.run('DELETE FROM chunk_fts WHERE chunk_id = ?', [chunkId]);
    this.db.run('INSERT INTO chunk_fts(chunk_id, path, fts_text) VALUES (?, ?, ?)', [chunkId, path, toFtsText(content)]);
  }

  indexMany(rows: readonly { chunkId: string; path: string; content: string }[]): void {
    this.db.transaction(() => {
      for (const r of rows) this.index(r.chunkId, r.path, r.content);
    });
  }

  removeByPath(path: string): void {
    this.db.run('DELETE FROM chunk_fts WHERE path = ?', [path]);
  }

  removeChunk(chunkId: string): void {
    this.db.run('DELETE FROM chunk_fts WHERE chunk_id = ?', [chunkId]);
  }

  /**
   * Ranked search. Tries an AND query first (all terms), and falls back to OR when nothing matches,
   * so "where do we validate plates" still finds `validatePlate` even if "where" is absent.
   */
  search(query: string, limit = 20): FtsHit[] {
    const run = (match: string) =>
      this.db
        .all<{ chunk_id: string; path: string; score: number }>(
          'SELECT chunk_id, path, bm25(chunk_fts) AS score FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY score LIMIT ?',
          [match, limit],
        )
        .map((r) => ({ chunkId: r.chunk_id, path: r.path, score: Number(r.score) }));
    const and = buildFtsQuery(query, 'and');
    if (!and) return [];
    const hits = run(and);
    if (hits.length > 0) return hits;
    const or = buildFtsQuery(query, 'or');
    return or ? run(or) : [];
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunk_fts')?.n ?? 0);
  }
}
