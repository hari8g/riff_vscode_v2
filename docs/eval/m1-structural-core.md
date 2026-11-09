# M1 — Structural core: gate results

Measured 9 Nov 2026 on darwin-arm64, Node 20.20.2, wasm SQLite driver. Reproduce with `pnpm build && pnpm bench:index` and `pnpm vitest run packages/graph/test/fixtures.test.ts`.

| Gate | Target | Result |
| --- | --- | --- |
| Incremental: second run touches 0 blobs | 0 | **0** blobs in scan, parse and graph (`parse/test/stage.test.ts`, `graph/test/graph.test.ts`, benchmark "warm") |
| One edit touches the file (and only dependents that must re-bind) | 1 file | **1** file for a comment edit; **4** for a rename of a called method (callers re-bound) |
| `riaf jump` resolves fixture references | ≥ 95% | **≥ 95%** on toll-ts, fleet-java, telemetry-py and embedded-c (`resolutionStats`, enforced in CI) |
| 100k LOC cold index | < 60 s | **8.0 s** wall (100,047 LOC, 476 modules in TS/Python/Java/C, 7,393 symbols, 28,921 edges) |

Benchmark detail (`tooling/scripts/bench-index.mjs`):

| Run | Wall | Pipeline | Files touched (scan / parse / graph) |
| --- | --- | --- | --- |
| cold | 8.0 s | 7.8 s | 529 / 529 / 529 |
| warm | 0.20 s | 19 ms | 0 / 0 / 0 |
| one-line edit | 0.48 s | 290 ms | 1 / 1 / 1 |

Wall time includes Node start-up and loading the wasm modules (~0.2 s).

## Open decision closed: native SQLite
The plan deferred "native SQLite in the daemon" to this measurement. The wasm driver meets the 60 s gate with a 7.5× margin, so `better-sqlite3` stays an optional peer dependency and is never required. Parse is 80% of cold time (tree-sitter in wasm). Bulk writes are not the bottleneck.

## Not covered here
- LSP enrichment ran only against a scripted fake server in tests. No real language servers are installed on the measuring machine (`riaf doctor` reports them as warnings).
- No measurement yet on a Bosch repository; that needs the pilot environment.
