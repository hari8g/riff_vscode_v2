## Hard constraints
- Dependency direction: kernel → store → {parse, graph, history, semantic} → intent → compiler → govern → daemon → {serve-mcp, cli, extension, eval}. Never import upward or sideways; use a port in `kernel/src/ports`.
- No native Node modules in any package that ships in the .vsix. SQLite is `@sqlite.org/sqlite-wasm`; tree-sitter is wasm.
- Every contract is a zod schema in `packages/kernel/src/schemas`; changing one needs a new migration and an ADR.
- `.riaf/index.sqlite` is runtime state and is never committed.

## Definition of done
- `pnpm verify` is green (build, lint, tests, schema check); golden packs unchanged or re-approved with a reason.
- New public function: one-line doc comment and a test in the package's `test/`.
- Conventional commit message; one package per PR where possible.
