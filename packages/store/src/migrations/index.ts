import type { SqliteDriver } from '../driver/types.js';

/**
 * Numbered migrations. Each runs once, in order, inside a transaction; `schema_version` records
 * the level. Never edit a shipped migration — add the next number (and an ADR when a contract moves).
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'merkle',
    sql: `
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stage (
        name TEXT PRIMARY KEY,
        bit  INTEGER NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS blob (
        path        TEXT PRIMARY KEY,
        hash        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        mtime_ms    INTEGER NOT NULL,
        lang        TEXT,
        stages_done INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS blob_hash ON blob(hash);
      CREATE TABLE IF NOT EXISTS tree (
        path       TEXT PRIMARY KEY,
        hash       TEXT NOT NULL,
        parent     TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tree_parent ON tree(parent);
    `,
  },
  {
    version: 2,
    name: 'symbols_graph',
    sql: `
      CREATE TABLE IF NOT EXISTS symbol (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        name           TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        path           TEXT NOT NULL,
        start_line     INTEGER,
        end_line       INTEGER,
        blob_hash      TEXT NOT NULL,
        signature      TEXT,
        doc            TEXT,
        parent_id      TEXT
      );
      CREATE INDEX IF NOT EXISTS symbol_path  ON symbol(path);
      CREATE INDEX IF NOT EXISTS symbol_name  ON symbol(name);
      CREATE INDEX IF NOT EXISTS symbol_qname ON symbol(qualified_name);
      CREATE INDEX IF NOT EXISTS symbol_kind  ON symbol(kind);

      CREATE TABLE IF NOT EXISTS edge (
        src        TEXT NOT NULL,
        dst        TEXT NOT NULL,
        kind       TEXT NOT NULL,
        weight     REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 1.0,
        source     TEXT NOT NULL DEFAULT 'treesitter',
        PRIMARY KEY (src, dst, kind, source)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS edge_src_kind ON edge(src, kind);
      CREATE INDEX IF NOT EXISTS edge_dst_kind ON edge(dst, kind);

      CREATE TABLE IF NOT EXISTS chunk (
        id         TEXT PRIMARY KEY,
        path       TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line   INTEGER NOT NULL,
        blob_hash  TEXT NOT NULL,
        tokens     INTEGER NOT NULL,
        content    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunk_path ON chunk(path);
      CREATE INDEX IF NOT EXISTS chunk_blob ON chunk(blob_hash);
    `,
  },
  {
    version: 3,
    name: 'search',
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        chunk_id UNINDEXED,
        path     UNINDEXED,
        fts_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS trigram (
        gram     TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (gram, chunk_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS trigram_chunk ON trigram(chunk_id);
      CREATE TABLE IF NOT EXISTS vector (
        chunk_id TEXT PRIMARY KEY,
        model    TEXT NOT NULL,
        dims     INTEGER NOT NULL,
        data     BLOB NOT NULL
      );
    `,
  },
  {
    version: 4,
    name: 'refs_imports',
    sql: `
      CREATE TABLE IF NOT EXISTS tag_ref (
        path     TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        name     TEXT NOT NULL,
        kind     TEXT NOT NULL,
        line     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tag_ref_path  ON tag_ref(path);
      CREATE INDEX IF NOT EXISTS tag_ref_name  ON tag_ref(name);
      CREATE INDEX IF NOT EXISTS tag_ref_scope ON tag_ref(scope_id);

      CREATE TABLE IF NOT EXISTS import_ref (
        path     TEXT NOT NULL,
        spec     TEXT NOT NULL,
        line     INTEGER NOT NULL,
        lang     TEXT NOT NULL,
        system   INTEGER NOT NULL DEFAULT 0,
        resolved TEXT
      );
      CREATE INDEX IF NOT EXISTS import_ref_path     ON import_ref(path);
      CREATE INDEX IF NOT EXISTS import_ref_resolved ON import_ref(resolved);
    `,
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Applies pending migrations; returns the versions applied in this call. */
export function migrate(driver: SqliteDriver): number[] {
  driver.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  const applied = new Set(driver.all<{ version: number }>('SELECT version FROM schema_version').map((r) => Number(r.version)));
  const done: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    driver.transaction(() => {
      driver.exec(m.sql);
      driver.run('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
    });
    done.push(m.version);
  }
  return done;
}

export function schemaVersion(driver: SqliteDriver): number {
  const r = driver.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version');
  return Number(r?.v ?? 0);
}
