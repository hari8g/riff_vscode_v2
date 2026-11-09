import { join } from 'node:path';
import { openDriver, type OpenDriverOptions } from './driver/index.js';
import type { SqliteDriver } from './driver/types.js';
import { CURRENT_SCHEMA_VERSION, migrate, schemaVersion } from './migrations/index.js';
import { MerkleIndex } from './merkle.js';
import { FtsIndex } from './fts.js';
import { TrigramIndex } from './trigram.js';
import { CompileLog, SummaryRepo } from './compile.js';
import { HistoryRepo } from './history.js';
import { ChunkRepo, EdgeRepo, ImportRepo, KvRepo, RefRepo, SymbolRepo, type ChunkRecord } from './repo.js';

export interface StoreOptions {
  driver?: OpenDriverOptions['driver'];
  /** Repository root; the database lives at `<root>/.riaf/index.sqlite`. Omit for in-memory. */
  repoRoot?: string;
  /** Explicit database path; overrides repoRoot. */
  path?: string;
}

/** The store façade every index layer uses. Owns the driver; nothing else opens the database. */
export class Store {
  readonly merkle: MerkleIndex;
  readonly symbols: SymbolRepo;
  readonly edges: EdgeRepo;
  readonly chunks: ChunkRepo;
  readonly kv: KvRepo;
  readonly refs: RefRepo;
  readonly imports: ImportRepo;
  readonly summaries: SummaryRepo;
  readonly compileLog: CompileLog;
  readonly history: HistoryRepo;
  readonly fts: FtsIndex;
  readonly trigram: TrigramIndex;

  private constructor(readonly driver: SqliteDriver, readonly path: string | undefined) {
    this.merkle = new MerkleIndex(driver);
    this.symbols = new SymbolRepo(driver);
    this.edges = new EdgeRepo(driver);
    this.chunks = new ChunkRepo(driver);
    this.kv = new KvRepo(driver);
    this.refs = new RefRepo(driver);
    this.imports = new ImportRepo(driver);
    this.summaries = new SummaryRepo(driver);
    this.compileLog = new CompileLog(driver);
    this.history = new HistoryRepo(driver);
    this.fts = new FtsIndex(driver);
    this.trigram = new TrigramIndex(driver);
  }

  static async open(opts: StoreOptions = {}): Promise<Store> {
    const path = opts.path ?? (opts.repoRoot ? join(opts.repoRoot, '.riaf', 'index.sqlite') : undefined);
    const driver = await openDriver(path ? { driver: opts.driver ?? 'wasm', path } : { driver: 'wasm' });
    migrate(driver);
    return new Store(driver, path);
  }

  get schemaVersion(): number {
    return schemaVersion(this.driver);
  }

  get isCurrent(): boolean {
    return this.schemaVersion === CURRENT_SCHEMA_VERSION;
  }

  /** Writes chunks and both search indexes for a file in one transaction, replacing previous chunks. */
  replaceChunksForPath(path: string, chunks: readonly ChunkRecord[]): void {
    this.driver.transaction(() => {
      for (const id of this.chunks.idsByPath(path)) {
        this.fts.removeChunk(id);
        this.trigram.removeChunk(id);
      }
      this.chunks.deleteByPath(path);
      this.chunks.upsertMany(chunks);
      this.fts.indexMany(chunks.map((c) => ({ chunkId: c.id, path: c.path, content: c.content })));
      this.trigram.indexMany(chunks.map((c) => ({ chunkId: c.id, content: c.content })));
    });
  }

  /** Removes every trace of a deleted file. */
  removePath(path: string): void {
    this.driver.transaction(() => {
      for (const id of this.chunks.idsByPath(path)) {
        this.fts.removeChunk(id);
        this.trigram.removeChunk(id);
      }
      this.chunks.deleteByPath(path);
      this.history.deleteBlameForPath(path);
      this.refs.deleteByPath(path);
      this.imports.deleteByPath(path);
      this.edges.deleteBySourcePath(path, 'treesitter');
      this.edges.deleteBySourcePath(path, 'lsp');
      this.symbols.deleteByPath(path);
      this.merkle.removeBlobs([path]);
    });
  }

  stats(): { blobs: number; symbols: number; edges: number; chunks: number; schemaVersion: number } {
    return {
      blobs: this.merkle.countBlobs(),
      symbols: this.symbols.count(),
      edges: this.edges.count(),
      chunks: this.chunks.count(),
      schemaVersion: this.schemaVersion,
    };
  }

  persist(): Promise<void> {
    return this.driver.persist();
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export const openStore = Store.open;
