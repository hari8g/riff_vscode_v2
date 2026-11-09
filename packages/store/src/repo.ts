import type { SymbolId, SymbolKind } from '@riaf/kernel';
import type { SqliteDriver } from './driver/types.js';

/** Typed repositories over the symbol, edge, chunk and kv tables. No raw SQL above this file. */

export interface SymbolRecord {
  id: SymbolId;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  blobHash: string;
  signature?: string;
  doc?: string;
  parentId?: SymbolId;
}

interface SymbolRow {
  id: string; kind: string; name: string; qualified_name: string; path: string;
  start_line: number | null; end_line: number | null; blob_hash: string;
  signature: string | null; doc: string | null; parent_id: string | null;
}

const fromRow = (r: SymbolRow): SymbolRecord => ({
  id: r.id as SymbolId,
  kind: r.kind as SymbolKind,
  name: r.name,
  qualifiedName: r.qualified_name,
  path: r.path,
  ...(r.start_line !== null ? { startLine: Number(r.start_line) } : {}),
  ...(r.end_line !== null ? { endLine: Number(r.end_line) } : {}),
  blobHash: r.blob_hash,
  ...(r.signature !== null ? { signature: r.signature } : {}),
  ...(r.doc !== null ? { doc: r.doc } : {}),
  ...(r.parent_id !== null ? { parentId: r.parent_id as SymbolId } : {}),
});

export class SymbolRepo {
  constructor(private readonly db: SqliteDriver) {}

  upsertMany(symbols: readonly SymbolRecord[]): void {
    this.db.transaction(() => {
      for (const s of symbols) {
        this.db.run(
          `INSERT INTO symbol(id, kind, name, qualified_name, path, start_line, end_line, blob_hash, signature, doc, parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, qualified_name=excluded.qualified_name,
             path=excluded.path, start_line=excluded.start_line, end_line=excluded.end_line, blob_hash=excluded.blob_hash,
             signature=excluded.signature, doc=excluded.doc, parent_id=excluded.parent_id`,
          [s.id, s.kind, s.name, s.qualifiedName, s.path, s.startLine ?? null, s.endLine ?? null, s.blobHash, s.signature ?? null, s.doc ?? null, s.parentId ?? null],
        );
      }
    });
  }

  get(id: SymbolId): SymbolRecord | undefined {
    const r = this.db.get<SymbolRow>('SELECT * FROM symbol WHERE id = ?', [id]);
    return r ? fromRow(r) : undefined;
  }

  byPath(path: string): SymbolRecord[] {
    return this.db.all<SymbolRow>('SELECT * FROM symbol WHERE path = ? ORDER BY start_line', [path]).map(fromRow);
  }

  byName(name: string, limit = 50): SymbolRecord[] {
    return this.db.all<SymbolRow>('SELECT * FROM symbol WHERE name = ? LIMIT ?', [name, limit]).map(fromRow);
  }

  searchName(prefixOrPart: string, limit = 50): SymbolRecord[] {
    const like = `%${prefixOrPart.replace(/[%_]/g, '')}%`;
    return this.db.all<SymbolRow>('SELECT * FROM symbol WHERE name LIKE ? OR qualified_name LIKE ? LIMIT ?', [like, like, limit]).map(fromRow);
  }

  deleteByPath(path: string): number {
    return this.db.run('DELETE FROM symbol WHERE path = ?', [path]).changes;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM symbol')?.n ?? 0);
  }
}

export const EDGE_KINDS = ['contains', 'imports', 'invokes', 'inherits', 'overrides', 'tests', 'defines_type', 'co_changes', 'references'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type EdgeSource = 'treesitter' | 'lsp' | 'history' | 'heuristic';

export interface EdgeRecord {
  src: SymbolId;
  dst: SymbolId;
  kind: EdgeKind;
  weight?: number;
  confidence?: number;
  source?: EdgeSource;
}

interface EdgeRow { src: string; dst: string; kind: string; weight: number; confidence: number; source: string }
const edgeFromRow = (r: EdgeRow): Required<EdgeRecord> => ({
  src: r.src as SymbolId, dst: r.dst as SymbolId, kind: r.kind as EdgeKind,
  weight: Number(r.weight), confidence: Number(r.confidence), source: r.source as EdgeSource,
});

export class EdgeRepo {
  constructor(private readonly db: SqliteDriver) {}

  upsertMany(edges: readonly EdgeRecord[]): void {
    this.db.transaction(() => {
      for (const e of edges) {
        this.db.run(
          `INSERT INTO edge(src, dst, kind, weight, confidence, source) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(src, dst, kind, source) DO UPDATE SET weight = excluded.weight, confidence = excluded.confidence`,
          [e.src, e.dst, e.kind, e.weight ?? 1, e.confidence ?? 1, e.source ?? 'treesitter'],
        );
      }
    });
  }

  outgoing(src: SymbolId, kind?: EdgeKind): Required<EdgeRecord>[] {
    return (kind
      ? this.db.all<EdgeRow>('SELECT * FROM edge WHERE src = ? AND kind = ?', [src, kind])
      : this.db.all<EdgeRow>('SELECT * FROM edge WHERE src = ?', [src])
    ).map(edgeFromRow);
  }

  incoming(dst: SymbolId, kind?: EdgeKind): Required<EdgeRecord>[] {
    return (kind
      ? this.db.all<EdgeRow>('SELECT * FROM edge WHERE dst = ? AND kind = ?', [dst, kind])
      : this.db.all<EdgeRow>('SELECT * FROM edge WHERE dst = ?', [dst])
    ).map(edgeFromRow);
  }

  /** Removes every edge touching a symbol defined in `path` from the given source (re-index of one file). */
  deleteBySourcePath(path: string, source: EdgeSource): number {
    return this.db.run(
      `DELETE FROM edge WHERE source = ? AND (src IN (SELECT id FROM symbol WHERE path = ?) OR dst IN (SELECT id FROM symbol WHERE path = ?))`,
      [source, path, path],
    ).changes;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM edge')?.n ?? 0);
  }
}

export interface ChunkRecord {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  blobHash: string;
  tokens: number;
  content: string;
}

interface ChunkRow { id: string; path: string; start_line: number; end_line: number; blob_hash: string; tokens: number; content: string }
const chunkFromRow = (r: ChunkRow): ChunkRecord => ({
  id: r.id, path: r.path, startLine: Number(r.start_line), endLine: Number(r.end_line), blobHash: r.blob_hash, tokens: Number(r.tokens), content: r.content,
});

export class ChunkRepo {
  constructor(private readonly db: SqliteDriver) {}

  upsertMany(chunks: readonly ChunkRecord[]): void {
    this.db.transaction(() => {
      for (const c of chunks) {
        this.db.run(
          `INSERT INTO chunk(id, path, start_line, end_line, blob_hash, tokens, content) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET path=excluded.path, start_line=excluded.start_line, end_line=excluded.end_line,
             blob_hash=excluded.blob_hash, tokens=excluded.tokens, content=excluded.content`,
          [c.id, c.path, c.startLine, c.endLine, c.blobHash, c.tokens, c.content],
        );
      }
    });
  }

  get(id: string): ChunkRecord | undefined {
    const r = this.db.get<ChunkRow>('SELECT * FROM chunk WHERE id = ?', [id]);
    return r ? chunkFromRow(r) : undefined;
  }

  byPath(path: string): ChunkRecord[] {
    return this.db.all<ChunkRow>('SELECT * FROM chunk WHERE path = ? ORDER BY start_line', [path]).map(chunkFromRow);
  }

  idsByPath(path: string): string[] {
    return this.db.all<{ id: string }>('SELECT id FROM chunk WHERE path = ?', [path]).map((r) => r.id);
  }

  deleteByPath(path: string): number {
    return this.db.run('DELETE FROM chunk WHERE path = ?', [path]).changes;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunk')?.n ?? 0);
  }
}

export class KvRepo {
  constructor(private readonly db: SqliteDriver) {}
  get(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])?.value;
  }
  set(key: string, value: string): void {
    this.db.run('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  delete(key: string): void {
    this.db.run('DELETE FROM kv WHERE key = ?', [key]);
  }
}
