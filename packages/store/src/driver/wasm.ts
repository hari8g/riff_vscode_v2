import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RiafError } from '@riaf/kernel';
import type { Row, RunResult, SqlParams, SqliteDriver } from './types.js';

/*
 * sqlite-wasm has no persistent VFS under Node, so the database lives in memory and is
 * persisted as a whole image: load = sqlite3_deserialize(file bytes), save = sqlite3_js_db_export.
 * The daemon debounces persist(); a crash loses at most the last debounce window, and every stage
 * is re-runnable from the Merkle table anyway.
 */

// Minimal structural types for the parts of the sqlite-wasm API we use; the package ships loose typings.
interface OoDb {
  pointer: number;
  exec(opts: { sql: string; bind?: SqlParams; rowMode?: 'object' | 'array'; returnValue?: 'resultRows' }): unknown;
  changes(): number;
  close(): void;
}
interface Sqlite3 {
  oo1: { DB: new (filename: string, flags?: string) => OoDb };
  capi: {
    sqlite3_js_db_export(db: number): Uint8Array;
    sqlite3_deserialize(db: number, schema: string, data: number, size: number, cap: number, flags: number): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(bytes: Uint8Array): number };
}

let sqlite3Promise: Promise<Sqlite3> | undefined;

async function loadSqlite3(): Promise<Sqlite3> {
  if (!sqlite3Promise) {
    sqlite3Promise = (async () => {
      const mod = (await import('@sqlite.org/sqlite-wasm')) as unknown as { default: (cfg?: { print?: () => void; printErr?: () => void }) => Promise<Sqlite3> };
      // Silence the module's console chatter (OPFS warnings etc.).
      return mod.default({ print: () => undefined, printErr: () => undefined });
    })();
  }
  return sqlite3Promise;
}

export class WasmDriver implements SqliteDriver {
  readonly kind = 'wasm' as const;
  private inTx = 0;

  private constructor(
    private readonly sqlite3: Sqlite3,
    private readonly db: OoDb,
    private readonly path: string | undefined,
  ) {}

  /** Opens `path` (loading its bytes if the file exists) or an in-memory database when `path` is undefined. */
  static async open(path?: string): Promise<WasmDriver> {
    const sqlite3 = await loadSqlite3();
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    if (path) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = new Uint8Array(await readFile(path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new RiafError('store_failure', `cannot read ${path}`, undefined, { cause: e });
      }
      if (bytes && bytes.length > 0) {
        const p = sqlite3.wasm.allocFromTypedArray(bytes);
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer, 'main', p, bytes.length, bytes.length,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        );
        if (rc !== 0) throw new RiafError('store_failure', `sqlite3_deserialize failed with rc=${rc} for ${path}`);
      }
    }
    const d = new WasmDriver(sqlite3, db, path);
    d.exec('PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;');
    return d;
  }

  exec(sql: string): void {
    this.db.exec({ sql });
  }

  run(sql: string, params?: SqlParams): RunResult {
    this.db.exec(params ? { sql, bind: params } : { sql });
    return { changes: this.db.changes() };
  }

  all<T extends object = Row>(sql: string, params?: SqlParams): T[] {
    const rows = this.db.exec({ sql, ...(params ? { bind: params } : {}), rowMode: 'object', returnValue: 'resultRows' });
    return rows as T[];
  }

  get<T extends object = Row>(sql: string, params?: SqlParams): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  transaction<T>(fn: () => T): T {
    if (this.inTx > 0) return fn(); // nested: join the outer transaction
    this.exec('BEGIN');
    this.inTx++;
    try {
      const out = fn();
      this.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.exec('ROLLBACK');
      } catch {
        // ignore rollback failure; the original error matters
      }
      throw e;
    } finally {
      this.inTx--;
    }
  }

  /** Exports the image and writes it atomically (tmp + rename). */
  async persist(): Promise<void> {
    if (!this.path) return;
    const bytes = this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, bytes);
    await rename(tmp, this.path);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
