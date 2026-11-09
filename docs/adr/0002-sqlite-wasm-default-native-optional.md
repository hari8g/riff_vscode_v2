# ADR-0002 — sqlite-wasm by default, native driver optional

**Status:** accepted · **Date:** 2026-11-09

## Context
RIAF must install as a .vsix behind the Bosch corporate proxy with no post-install downloads and no native build step. v1 proved `@sqlite.org/sqlite-wasm` is sufficient for FTS5 and the graph tables at mid-size repositories, but bulk writes are 5–10x slower than a native build.

## Decision
`@riaf/store` exposes one `SqliteDriver` interface with two implementations: `wasm` (default, always present) and `native` (better-sqlite3, opt-in, used only by the daemon when the module is importable on the machine). The schema, migrations and all repositories are driver-agnostic. FTS5's tokenizer is not customisable in wasm, so identifier splitting (camelCase, snake_case) is done in TypeScript into an indexed `fts_text` column.

## Consequences
- Zero native dependencies in the shipped artefact.
- The M1 gate (100k LOC cold index under 60 s) decides whether native becomes recommended for the daemon.
- Tests run against the wasm driver only; the native driver is tested where it installs.
