/** Driver-agnostic SQLite surface. Both drivers implement exactly this; nothing above depends on either. */

export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;
export type Row = Record<string, SqlValue>;

export interface RunResult {
  changes: number;
}

export interface SqliteDriver {
  readonly kind: 'wasm' | 'native';
  /** Executes one or more statements without binding; used for DDL. */
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): RunResult;
  all<T extends object = Row>(sql: string, params?: SqlParams): T[];
  get<T extends object = Row>(sql: string, params?: SqlParams): T | undefined;
  /** Runs `fn` inside BEGIN/COMMIT; rolls back and rethrows on error. */
  transaction<T>(fn: () => T): T;
  /** Writes the database to its backing path. No-op for the native driver (already on disk). */
  persist(): Promise<void>;
  close(): Promise<void>;
}
