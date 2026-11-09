# @riaf/parse — L1 syntax and symbols

Turns files into symbols, references, imports and search chunks. Allowed imports: `@riaf/kernel`, `@riaf/store`.

- `scan.ts` — discovers indexable files (honours `.gitignore`, skips binaries and >1 MB files) and upserts the Merkle table; unchanged size+mtime is never re-hashed.
- `treesitter/` — web-tree-sitter 0.22 + grammars from `tree-sitter-wasms` (no native code, nothing downloaded at runtime). `queries.ts` holds the tags queries for TypeScript, TSX, JavaScript, Python, Java, Go, C, C++ and C#; `tags.ts` turns matches into qualified definitions (signature, doc), scoped references and imports.
- `chunker.ts` — AST-aligned chunks under a soft token cap: never splits a function, splits oversized containers into members, merges small siblings.
- `imports.ts` — resolves specifiers from config files only: tsconfig `paths`/`baseUrl`, workspace `package.json` names, Python roots, Java package suffixes, `go.mod`, CMake `include_directories` and `compile_commands.json`.
- `stage.ts` — the incremental `parse` stage: only blobs whose parse bit is unset are parsed; when the file set changes, stale imports in untouched files are re-resolved.
- `lsp/` — minimal stdio LSP client, server detection (`riaf doctor`), and `enrichWithLsp`, which writes precise `references` edges with source `lsp`. Off by default.

Grammar lookup order: `RIAF_GRAMMARS_DIR`, `grammars/` beside the bundle, `tooling/grammars/`, then `tree-sitter-wasms` in `node_modules`.
Lines are 1-based and inclusive everywhere.
