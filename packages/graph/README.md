# @riaf/graph — L1 structural graph

Builds and queries the symbol graph. Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/parse`.

- `build.ts` — the incremental `graph` stage. Writes `contains`, `imports`, `invokes`, `inherits`, `defines_type`, `overrides` and `tests` edges for changed files, plus untouched files whose references pointed into them or may now bind to their new names. Only `treesitter`/`heuristic` edges are owned here; `lsp` and `history` edges belong to their passes.
- `resolve.ts` — binds references in order: enclosing class members → same file → resolved imports (one re-export hop) → owner type mentioned in scope → same package → global name match with confidence decaying by ambiguity. C/C++ header prototypes also link to their implementation.
- `view.ts` — cached in-memory adjacency (rebuilt when `graph.version` moves) and personalized PageRank.
- `repomap.ts` — signature-only ranked map under a token budget. `closure.ts` — callers, callees, inheritance tree, dynamic-dispatch sites, bounded closure with cost. `impact.ts` — dependents, tests, co-change partners. `tests.ts` — test ↔ symbol map. `clusters.ts` — label propagation over the file graph. `jump.ts` — lookup by id, `path:line`, qualified or bare name.
- `stats.ts` — reference-resolution rate (M1 gate: ≥ 95% on every fixture repo).

Public façade: `new Graph(store)` with `update`, `jump`, `closure`, `impact`, `repoMap`, `ppr`, `tests`, `clusters`.
