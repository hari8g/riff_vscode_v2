# @riaf/store

L0 persistence. One SQLite file per repository at `.riaf/index.sqlite`, opened through a driver interface with two implementations (ADR-0002):

- `wasm` — `@sqlite.org/sqlite-wasm`, default, zero native dependencies. Runs in memory and persists by exporting the database image to disk (`store.persist()`), which the daemon calls on a debounce.
- `native` — `better-sqlite3`, opt-in for the daemon where it installs; same SQL, 5–10x faster bulk writes.

Modules:
- `migrations/` — numbered SQL applied on open; `schema_version` records the level.
- `merkle` — `blob` and `tree` tables with a per-stage completion bitmap: every pipeline stage asks `changedSince(stage)` and marks `done(stage, paths)`.
- `fts` — FTS5 over chunks with identifier splitting done in TypeScript (`TollSession` → `toll session tollsession`), BM25 ranking.
- `trigram` — trigram postings over chunks for instant literal / regex-prefilter search.
- `vectors` — optional embedding storage (M3+).
- `repo` — typed repositories (`blobs`, `symbols`, `edges`, `chunks`, `kv`); no raw SQL leaks above this package.

Depends on: `@riaf/kernel`.
