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

  byQualifiedName(qualifiedName: string, limit = 50): SymbolRecord[] {
    return this.db.all<SymbolRow>('SELECT * FROM symbol WHERE qualified_name = ? LIMIT ?', [qualifiedName, limit]).map(fromRow);
  }

  /** The innermost symbol in `path` whose range contains 1-based `line` (files excluded). */
  atLine(path: string, line: number): SymbolRecord | undefined {
    const r = this.db.get<SymbolRow>(
      `SELECT * FROM symbol WHERE path = ? AND kind != 'file' AND start_line <= ? AND end_line >= ?
       ORDER BY (end_line - start_line) ASC LIMIT 1`, [path, line, line]);
    return r ? fromRow(r) : undefined;
  }

  children(parentId: SymbolId): SymbolRecord[] {
    return this.db.all<SymbolRow>('SELECT * FROM symbol WHERE parent_id = ? ORDER BY start_line', [parentId]).map(fromRow);
  }

  /** Every symbol, optionally restricted to kinds (for whole-graph passes). */
  all(kinds?: readonly SymbolKind[]): SymbolRecord[] {
    return (kinds && kinds.length
      ? this.db.all<SymbolRow>(`SELECT * FROM symbol WHERE kind IN (${kinds.map(() => '?').join(',')}) ORDER BY path, start_line`, [...kinds])
      : this.db.all<SymbolRow>('SELECT * FROM symbol ORDER BY path, start_line')
    ).map(fromRow);
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

  /**
   * Deletes edges whose source symbol lives in `path` (ids are `path#...`, so this is a range scan and
   * works after the symbols are gone). Incoming edges from unchanged files are kept.
   */
  deleteOutgoingFromPath(path: string, sources?: readonly EdgeSource[]): number {
    const lo = `${path}#`;
    const hi = `${path}$`; // '$' sorts immediately after '#'
    if (!sources || sources.length === 0) return this.db.run('DELETE FROM edge WHERE src >= ? AND src < ?', [lo, hi]).changes;
    let n = 0;
    for (const s of sources) n += this.db.run('DELETE FROM edge WHERE src >= ? AND src < ? AND source = ?', [lo, hi, s]).changes;
    return n;
  }

  /** Edges pointing into symbols of `path`, e.g. to find dangling edges after a symbol was renamed. */
  incomingToPath(path: string): Required<EdgeRecord>[] {
    return this.db.all<EdgeRow>('SELECT * FROM edge WHERE dst >= ? AND dst < ?', [`${path}#`, `${path}$`]).map(edgeFromRow);
  }

  /** Deletes edges whose destination no longer exists in the symbol table. */
  deleteDangling(): number {
    return this.db.run('DELETE FROM edge WHERE dst NOT IN (SELECT id FROM symbol) OR src NOT IN (SELECT id FROM symbol)').changes;
  }

  /** All edges of the given kinds (for whole-graph algorithms such as PageRank and clustering). */
  allOfKinds(kinds: readonly EdgeKind[]): Required<EdgeRecord>[] {
    if (kinds.length === 0) return [];
    return this.db.all<EdgeRow>(`SELECT * FROM edge WHERE kind IN (${kinds.map(() => '?').join(',')})`, [...kinds]).map(edgeFromRow);
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

/** A reference as stored: `scopeId` is the innermost enclosing symbol (or the file symbol). */
export interface RefRecord {
  path: string;
  scopeId: SymbolId;
  name: string;
  kind: string;
  line: number;
}

interface RefRow { path: string; scope_id: string; name: string; kind: string; line: number }
const refFromRow = (r: RefRow): RefRecord => ({ path: r.path, scopeId: r.scope_id as SymbolId, name: r.name, kind: r.kind, line: Number(r.line) });

export class RefRepo {
  constructor(private readonly db: SqliteDriver) {}

  /** Replaces every reference recorded for `path`. */
  replaceForPath(path: string, refs: readonly RefRecord[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM tag_ref WHERE path = ?', [path]);
      for (const r of refs) this.db.run('INSERT INTO tag_ref(path, scope_id, name, kind, line) VALUES (?, ?, ?, ?, ?)', [r.path, r.scopeId, r.name, r.kind, r.line]);
    });
  }

  byPath(path: string): RefRecord[] {
    return this.db.all<RefRow>('SELECT * FROM tag_ref WHERE path = ? ORDER BY line', [path]).map(refFromRow);
  }

  byName(name: string): RefRecord[] {
    return this.db.all<RefRow>('SELECT * FROM tag_ref WHERE name = ? ORDER BY path, line', [name]).map(refFromRow);
  }

  byScope(scopeId: SymbolId): RefRecord[] {
    return this.db.all<RefRow>('SELECT * FROM tag_ref WHERE scope_id = ? ORDER BY line', [scopeId]).map(refFromRow);
  }

  deleteByPath(path: string): number {
    return this.db.run('DELETE FROM tag_ref WHERE path = ?', [path]).changes;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tag_ref')?.n ?? 0);
  }
}

/** One import statement; a statement resolving to several files is stored once per target. */
export interface ImportRecord {
  path: string;
  spec: string;
  line: number;
  lang: string;
  system?: boolean;
  resolved?: string;
}

interface ImportRow { path: string; spec: string; line: number; lang: string; system: number; resolved: string | null }
const importFromRow = (r: ImportRow): ImportRecord => ({
  path: r.path, spec: r.spec, line: Number(r.line), lang: r.lang,
  ...(Number(r.system) ? { system: true } : {}),
  ...(r.resolved !== null ? { resolved: r.resolved } : {}),
});

export class ImportRepo {
  constructor(private readonly db: SqliteDriver) {}

  /** Replaces every import recorded for `path`. */
  replaceForPath(path: string, rows: readonly ImportRecord[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM import_ref WHERE path = ?', [path]);
      for (const r of rows) {
        this.db.run('INSERT INTO import_ref(path, spec, line, lang, system, resolved) VALUES (?, ?, ?, ?, ?, ?)', [r.path, r.spec, r.line, r.lang, r.system ? 1 : 0, r.resolved ?? null]);
      }
    });
  }

  byPath(path: string): ImportRecord[] {
    return this.db.all<ImportRow>('SELECT * FROM import_ref WHERE path = ? ORDER BY line', [path]).map(importFromRow);
  }

  /** Files that import `path`. */
  importersOf(path: string): string[] {
    return this.db.all<{ path: string }>('SELECT DISTINCT path FROM import_ref WHERE resolved = ? ORDER BY path', [path]).map((r) => r.path);
  }

  /** Every import row (used to re-resolve after files are added or removed). */
  all(): ImportRecord[] {
    return this.db.all<ImportRow>('SELECT * FROM import_ref ORDER BY path, line').map(importFromRow);
  }

  /** Paths that have at least one unresolved import or an import resolved to a file not in `files`. */
  pathsNeedingResolution(files: ReadonlySet<string>): string[] {
    const out = new Set<string>();
    for (const r of this.db.all<{ path: string; resolved: string | null }>('SELECT path, resolved FROM import_ref')) {
      if (r.resolved === null || !files.has(r.resolved)) out.add(r.path);
    }
    return [...out].sort();
  }

  deleteByPath(path: string): number {
    return this.db.run('DELETE FROM import_ref WHERE path = ?', [path]).changes;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM import_ref')?.n ?? 0);
  }
}
