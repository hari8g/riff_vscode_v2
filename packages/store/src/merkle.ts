import { hashTree, type BlobHash, type TreeHash } from '@riaf/kernel';
import type { SqliteDriver } from './driver/types.js';

/**
 * The Merkle table is how every pipeline stage knows what changed.
 *
 * `blob` holds one row per indexed file with its content hash and a bitmap of the stages that have
 * processed that exact hash. When a file changes, its row is upserted with the new hash and the
 * bitmap reset, so `changedSince(stage)` returns it again. `tree` holds directory hashes combined
 * from children (git-style), so the semantic layer can skip unchanged subtrees.
 */

export interface BlobRecord {
  path: string;
  hash: BlobHash;
  size: number;
  mtimeMs: number;
  lang?: string;
}

export interface BlobRow {
  path: string;
  hash: string;
  size: number;
  mtime_ms: number;
  lang: string | null;
  stages_done: number;
  updated_at: string;
}

export interface UpsertSummary {
  added: string[];
  changed: string[];
  unchanged: number;
}

export class MerkleIndex {
  private readonly bits = new Map<string, number>();

  constructor(private readonly db: SqliteDriver) {
    for (const r of db.all<{ name: string; bit: number }>('SELECT name, bit FROM stage')) this.bits.set(r.name, Number(r.bit));
  }

  /** Registers a stage name and returns its bit; stable across runs because it is persisted. */
  registerStage(name: string): number {
    const existing = this.bits.get(name);
    if (existing !== undefined) return existing;
    const max = Math.max(-1, ...this.bits.values());
    const bit = max + 1;
    if (bit > 30) throw new Error('MerkleIndex: more than 31 stages are not supported');
    this.db.run('INSERT INTO stage(name, bit) VALUES (?, ?)', [name, bit]);
    this.bits.set(name, bit);
    return bit;
  }

  stages(): string[] {
    return [...this.bits.keys()];
  }

  /** Upserts a batch of blobs; rows whose hash is unchanged keep their stage bitmap. */
  upsertBlobs(blobs: readonly BlobRecord[], now: Date = new Date()): UpsertSummary {
    const summary: UpsertSummary = { added: [], changed: [], unchanged: 0 };
    const ts = now.toISOString();
    this.db.transaction(() => {
      for (const b of blobs) {
        const cur = this.db.get<{ hash: string }>('SELECT hash FROM blob WHERE path = ?', [b.path]);
        if (!cur) {
          this.db.run(
            'INSERT INTO blob(path, hash, size, mtime_ms, lang, stages_done, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
            [b.path, b.hash, b.size, b.mtimeMs, b.lang ?? null, ts],
          );
          summary.added.push(b.path);
        } else if (cur.hash !== b.hash) {
          this.db.run(
            'UPDATE blob SET hash = ?, size = ?, mtime_ms = ?, lang = ?, stages_done = 0, updated_at = ? WHERE path = ?',
            [b.hash, b.size, b.mtimeMs, b.lang ?? null, ts, b.path],
          );
          summary.changed.push(b.path);
        } else {
          summary.unchanged++;
        }
      }
    });
    return summary;
  }

  /** Refreshes size and mtime for rows whose hash is unchanged (keeps the stage bitmap). */
  touchStats(blobs: readonly BlobRecord[]): void {
    this.db.transaction(() => {
      for (const b of blobs) this.db.run('UPDATE blob SET size = ?, mtime_ms = ? WHERE path = ? AND hash = ?', [b.size, b.mtimeMs, b.path, b.hash]);
    });
  }

  removeBlobs(paths: readonly string[]): number {
    let n = 0;
    this.db.transaction(() => {
      for (const p of paths) n += this.db.run('DELETE FROM blob WHERE path = ?', [p]).changes;
    });
    return n;
  }

  /** Paths whose current hash has not been processed by `stage`. */
  changedSince(stage: string, limit?: number): BlobRow[] {
    const bit = this.registerStage(stage);
    const mask = 1 << bit;
    const sql = `SELECT * FROM blob WHERE (stages_done & ${mask}) = 0 ORDER BY path${limit ? ` LIMIT ${Math.floor(limit)}` : ''}`;
    return this.db.all<BlobRow>(sql);
  }

  /** Marks `paths` as processed by `stage` for their current hash. */
  markDone(stage: string, paths: readonly string[]): void {
    const bit = this.registerStage(stage);
    const mask = 1 << bit;
    this.db.transaction(() => {
      for (const p of paths) this.db.run(`UPDATE blob SET stages_done = stages_done | ${mask} WHERE path = ?`, [p]);
    });
  }

  /** Resets `stage` for every blob (used by `riaf index --full`). */
  resetStage(stage: string): void {
    const bit = this.registerStage(stage);
    const mask = 1 << bit;
    this.db.run(`UPDATE blob SET stages_done = stages_done & ~${mask}`);
  }

  getBlob(path: string): BlobRow | undefined {
    return this.db.get<BlobRow>('SELECT * FROM blob WHERE path = ?', [path]);
  }

  /** Every indexed path, sorted. */
  paths(): string[] {
    return this.db.all<{ path: string }>('SELECT path FROM blob ORDER BY path').map((r) => r.path);
  }

  /** Every blob row, sorted by path. */
  listBlobs(): BlobRow[] {
    return this.db.all<BlobRow>('SELECT * FROM blob ORDER BY path');
  }

  countBlobs(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM blob')?.n ?? 0);
  }

  /**
   * Recomputes every directory hash bottom-up from the blob table. Returns the directories whose
   * hash changed since the last computation (the root is '' and is always present).
   */
  recomputeTrees(now: Date = new Date()): string[] {
    const blobs = this.db.all<{ path: string; hash: string }>('SELECT path, hash FROM blob');
    const children = new Map<string, { name: string; hash: BlobHash | TreeHash }[]>();
    const dirs = new Set<string>(['']);
    const parentOf = (p: string): string => {
      const i = p.lastIndexOf('/');
      return i < 0 ? '' : p.slice(0, i);
    };
    const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
    for (const b of blobs) {
      const dir = parentOf(b.path);
      let d = dir;
      while (!dirs.has(d)) {
        dirs.add(d);
        d = parentOf(d);
      }
      const list = children.get(dir) ?? [];
      list.push({ name: nameOf(b.path), hash: b.hash as BlobHash });
      children.set(dir, list);
    }
    const sorted = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length || (a < b ? 1 : -1)); // deepest first
    const hashes = new Map<string, TreeHash>();
    for (const d of sorted) {
      const h = hashTree(children.get(d) ?? []);
      hashes.set(d, h);
      if (d !== '') {
        const parent = parentOf(d);
        const list = children.get(parent) ?? [];
        list.push({ name: nameOf(d), hash: h });
        children.set(parent, list);
      }
    }
    const changed: string[] = [];
    const ts = now.toISOString();
    this.db.transaction(() => {
      const existing = new Map(this.db.all<{ path: string; hash: string }>('SELECT path, hash FROM tree').map((r) => [r.path, r.hash]));
      for (const [d, h] of hashes) {
        if (existing.get(d) !== h) {
          changed.push(d);
          this.db.run(
            'INSERT INTO tree(path, hash, parent, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, parent = excluded.parent, updated_at = excluded.updated_at',
            [d, h, d === '' ? null : parentOf(d), ts],
          );
        }
        existing.delete(d);
      }
      for (const gone of existing.keys()) this.db.run('DELETE FROM tree WHERE path = ?', [gone]);
    });
    return changed;
  }

  getTree(path: string): { path: string; hash: TreeHash; parent: string | null } | undefined {
    const r = this.db.get<{ path: string; hash: string; parent: string | null }>('SELECT path, hash, parent FROM tree WHERE path = ?', [path]);
    return r ? { path: r.path, hash: r.hash as TreeHash, parent: r.parent } : undefined;
  }
}
