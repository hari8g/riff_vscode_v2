import type { SymbolId } from '@riaf/kernel';
import type { SqliteDriver } from './driver/types.js';

/** Typed access to the history tables (migration 0006). */

export type CommitKind = 'feat' | 'fix' | 'revert' | 'incident' | 'refactor' | 'style' | 'docs' | 'test' | 'chore' | 'merge' | 'other';

export interface CommitRecord {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  at: string;
  subject: string;
  body: string;
  files: number;
  added: number;
  deleted: number;
  kind: CommitKind;
  noise: boolean;
}

export interface CommitFileRecord {
  sha: string;
  path: string;
  added: number;
  deleted: number;
}

interface CommitRow { sha: string; parents: string; author: string; email: string; at: string; subject: string; body: string; files: number; added: number; deleted: number; kind: string; noise: number }
const commitFromRow = (r: CommitRow): CommitRecord => ({
  sha: r.sha, parents: r.parents ? r.parents.split(' ') : [], author: r.author, email: r.email, at: r.at, subject: r.subject, body: r.body,
  files: Number(r.files), added: Number(r.added), deleted: Number(r.deleted), kind: r.kind as CommitKind, noise: Number(r.noise) === 1,
});

export interface BlameEntry {
  commit: string;
  lines: number;
}

export class HistoryRepo {
  constructor(private readonly db: SqliteDriver) {}

  upsertCommits(commits: readonly CommitRecord[], files: readonly CommitFileRecord[]): void {
    this.db.transaction(() => {
      for (const c of commits) {
        this.db.run(
          `INSERT OR REPLACE INTO commit_log(sha, parents, author, email, at, subject, body, files, added, deleted, kind, noise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.sha, c.parents.join(' '), c.author, c.email, c.at, c.subject, c.body, c.files, c.added, c.deleted, c.kind, c.noise ? 1 : 0],
        );
      }
      for (const f of files) this.db.run('INSERT OR REPLACE INTO commit_file(sha, path, added, deleted) VALUES (?, ?, ?, ?)', [f.sha, f.path, f.added, f.deleted]);
    });
  }

  commit(sha: string): CommitRecord | undefined {
    const r = this.db.get<CommitRow>('SELECT * FROM commit_log WHERE sha = ?', [sha]);
    return r ? commitFromRow(r) : undefined;
  }

  /** Resolves an abbreviated sha. */
  resolve(prefix: string): CommitRecord | undefined {
    const r = this.db.get<CommitRow>('SELECT * FROM commit_log WHERE sha >= ? AND sha < ? LIMIT 1', [prefix, `${prefix}g`]);
    return r ? commitFromRow(r) : undefined;
  }

  commitsTouching(path: string, limit = 50): CommitRecord[] {
    return this.db.all<CommitRow>(
      'SELECT c.* FROM commit_log c JOIN commit_file f ON f.sha = c.sha WHERE f.path = ? ORDER BY c.at DESC LIMIT ?', [path, limit],
    ).map(commitFromRow);
  }

  filesOf(sha: string): CommitFileRecord[] {
    return this.db.all<CommitFileRecord>('SELECT sha, path, added, deleted FROM commit_file WHERE sha = ? ORDER BY path', [sha]);
  }

  recent(limit = 500, includeNoise = false): CommitRecord[] {
    return this.db.all<CommitRow>(`SELECT * FROM commit_log ${includeNoise ? '' : 'WHERE noise = 0'} ORDER BY at DESC LIMIT ?`, [limit]).map(commitFromRow);
  }

  noiseShas(): string[] {
    return this.db.all<{ sha: string }>('SELECT sha FROM commit_log WHERE noise = 1').map((r) => r.sha);
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM commit_log')?.n ?? 0);
  }

  clear(): void {
    this.db.transaction(() => {
      for (const t of ['commit_log', 'commit_file', 'blame', 'revert', 'incident', 'commit_summary', 'co_change_file']) this.db.run(`DELETE FROM ${t}`);
    });
  }

  // blame per symbol ------------------------------------------------------------------------------

  replaceBlame(symbol: SymbolId, blobHash: string, entries: readonly BlameEntry[]): void {
    this.db.run('DELETE FROM blame WHERE symbol_id = ?', [symbol]);
    for (const e of entries) this.db.run('INSERT INTO blame(symbol_id, blob_hash, commit_sha, lines) VALUES (?, ?, ?, ?)', [symbol, blobHash, e.commit, e.lines]);
  }

  deleteBlameForPath(path: string): void {
    this.db.run('DELETE FROM blame WHERE symbol_id >= ? AND symbol_id < ?', [`${path}#`, `${path}$`]);
  }

  /** True when any symbol of `path` has blame rows. */
  hasBlameForPath(path: string): boolean {
    return this.db.get<{ x: number }>('SELECT 1 AS x FROM blame WHERE symbol_id >= ? AND symbol_id < ? LIMIT 1', [`${path}#`, `${path}$`]) !== undefined;
  }

  /** Commits owning the symbol's current lines, most recent first. */
  blame(symbol: SymbolId): (BlameEntry & { at: string; subject: string; author: string; kind: CommitKind })[] {
    return this.db.all<{ commit_sha: string; lines: number; at: string; subject: string; author: string; kind: string }>(
      `SELECT b.commit_sha, b.lines, c.at, c.subject, c.author, c.kind FROM blame b JOIN commit_log c ON c.sha = b.commit_sha
       WHERE b.symbol_id = ? ORDER BY c.at DESC`, [symbol],
    ).map((r) => ({ commit: r.commit_sha, lines: Number(r.lines), at: r.at, subject: r.subject, author: r.author, kind: r.kind as CommitKind }));
  }

  /** Symbols whose current lines a commit owns. */
  symbolsOf(sha: string): SymbolId[] {
    return this.db.all<{ symbol_id: string }>('SELECT symbol_id FROM blame WHERE commit_sha = ?', [sha]).map((r) => r.symbol_id as SymbolId);
  }

  /** symbol → commits, for co-change over the given symbols (or all). */
  blameIndex(): Map<SymbolId, Set<string>> {
    const out = new Map<SymbolId, Set<string>>();
    for (const r of this.db.all<{ symbol_id: string; commit_sha: string }>('SELECT symbol_id, commit_sha FROM blame')) {
      const set = out.get(r.symbol_id as SymbolId) ?? new Set<string>();
      set.add(r.commit_sha);
      out.set(r.symbol_id as SymbolId, set);
    }
    return out;
  }

  // reverts, incidents ----------------------------------------------------------------------------

  recordRevert(commit: string, reverted: string): void {
    this.db.run('INSERT OR REPLACE INTO revert(commit_sha, reverted_sha) VALUES (?, ?)', [commit, reverted]);
  }

  revertOf(sha: string): string | undefined {
    return this.db.get<{ commit_sha: string }>('SELECT commit_sha FROM revert WHERE reverted_sha = ?', [sha])?.commit_sha;
  }

  reverts(): { commit: string; reverted: string }[] {
    return this.db.all<{ commit_sha: string; reverted_sha: string }>('SELECT * FROM revert').map((r) => ({ commit: r.commit_sha, reverted: r.reverted_sha }));
  }

  recordIncident(commit: string, kind: string, ref: string): void {
    this.db.run('INSERT OR IGNORE INTO incident(commit_sha, kind, ref) VALUES (?, ?, ?)', [commit, kind, ref]);
  }

  incidentsOf(sha: string): { kind: string; ref: string }[] {
    return this.db.all<{ kind: string; ref: string }>('SELECT kind, ref FROM incident WHERE commit_sha = ?', [sha]);
  }

  // ADRs ------------------------------------------------------------------------------------------

  upsertAdr(a: { path: string; title: string; status: string; hash: string; text: string }, symbols: readonly SymbolId[]): void {
    this.db.transaction(() => {
      this.db.run('INSERT OR REPLACE INTO adr(path, title, status, hash, text) VALUES (?, ?, ?, ?, ?)', [a.path, a.title, a.status, a.hash, a.text]);
      this.db.run('DELETE FROM adr_link WHERE path = ?', [a.path]);
      for (const s of symbols) this.db.run('INSERT OR IGNORE INTO adr_link(path, symbol_id) VALUES (?, ?)', [a.path, s]);
    });
  }

  adrHash(path: string): string | undefined {
    return this.db.get<{ hash: string }>('SELECT hash FROM adr WHERE path = ?', [path])?.hash;
  }

  deleteAdr(path: string): void {
    this.db.run('DELETE FROM adr WHERE path = ?', [path]);
    this.db.run('DELETE FROM adr_link WHERE path = ?', [path]);
  }

  adrPaths(): string[] {
    return this.db.all<{ path: string }>('SELECT path FROM adr').map((r) => r.path);
  }

  adrsFor(symbol: SymbolId): { path: string; title: string; status: string; text: string }[] {
    const file = symbol.slice(0, symbol.indexOf('#'));
    return this.db.all<{ path: string; title: string; status: string; text: string }>(
      `SELECT DISTINCT a.path, a.title, a.status, a.text FROM adr a JOIN adr_link l ON l.path = a.path
       WHERE l.symbol_id = ? OR l.symbol_id = ? ORDER BY a.path`, [symbol, `${file}#@file`],
    );
  }

  // commit summaries and file co-change -----------------------------------------------------------

  upsertSummary(sha: string, goal: string, terms: readonly string[], model: string): void {
    this.db.run('INSERT OR REPLACE INTO commit_summary(sha, goal, terms, model) VALUES (?, ?, ?, ?)', [sha, goal, terms.join(' '), model]);
  }

  summary(sha: string): { goal: string; terms: string[]; model: string } | undefined {
    const r = this.db.get<{ goal: string; terms: string; model: string }>('SELECT goal, terms, model FROM commit_summary WHERE sha = ?', [sha]);
    return r ? { goal: r.goal, terms: r.terms ? r.terms.split(' ') : [], model: r.model } : undefined;
  }

  replaceFileCoChange(rows: readonly { a: string; b: string; support: number; confidence: number }[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM co_change_file');
      for (const r of rows) this.db.run('INSERT INTO co_change_file(a, b, support, confidence) VALUES (?, ?, ?, ?)', [r.a, r.b, r.support, r.confidence]);
    });
  }

  fileCoChange(path: string, limit = 10): { path: string; support: number; confidence: number }[] {
    return this.db.all<{ b: string; support: number; confidence: number }>('SELECT b, support, confidence FROM co_change_file WHERE a = ? ORDER BY support DESC, confidence DESC LIMIT ?', [path, limit])
      .map((r) => ({ path: r.b, support: Number(r.support), confidence: Number(r.confidence) }));
  }
}
