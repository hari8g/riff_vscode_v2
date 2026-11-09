import { RiafError } from '@riaf/kernel';
import type { Row, RunResult, SqlParams, SqliteDriver } from './types.js';

/*
 * Optional better-sqlite3 driver (ADR-0002). Loaded dynamically so the package has no hard
 * dependency; `isNativeAvailable()` tells the daemon whether it may opt in.
 */

interface NativeStatement {
  run(...params: unknown[]): { changes: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface NativeDb {
  exec(sql: string): void;
  prepare(sql: string): NativeStatement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  pragma(s: string): unknown;
}
type NativeCtor = new (path: string) => NativeDb;

async function loadNative(): Promise<NativeCtor | undefined> {
  try {
    const mod = (await import('better-sqlite3' as string)) as { default?: NativeCtor } | NativeCtor;
    return (typeof mod === 'function' ? mod : mod.default) as NativeCtor | undefined;
  } catch {
    return undefined;
  }
}

export async function isNativeAvailable(): Promise<boolean> {
  return (await loadNative()) !== undefined;
}

export class NativeDriver implements SqliteDriver {
  readonly kind = 'native' as const;
  private constructor(private readonly db: NativeDb) {}

  static async open(path: string): Promise<NativeDriver> {
    const Ctor = await loadNative();
    if (!Ctor) throw new RiafError('store_failure', 'better-sqlite3 is not installed; use the wasm driver');
    const db = new Ctor(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return new NativeDriver(db);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }
  run(sql: string, params?: SqlParams): RunResult {
    const r = this.db.prepare(sql).run(...(params ? [params] : []));
    return { changes: Number(r.changes) };
  }
  all<T extends object = Row>(sql: string, params?: SqlParams): T[] {
    return this.db.prepare(sql).all(...(params ? [params] : [])) as T[];
  }
  get<T extends object = Row>(sql: string, params?: SqlParams): T | undefined {
    return this.db.prepare(sql).get(...(params ? [params] : [])) as T | undefined;
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  async persist(): Promise<void> {
    // already on disk
  }
  async close(): Promise<void> {
    this.db.close();
  }
}
