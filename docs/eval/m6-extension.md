# M6 — Extension and pilot: gate results

| Gate (implementation plan) | Status |
| --- | --- |
| `.vsix` installs behind the Bosch proxy with no downloads | **met in engineering terms.** `riaf-vscode-v2-0.4.0.vsix` is 2.7 MB with 20 files and **0 native modules**. It carries the extension, the console, the daemon/CLI bundle, `sqlite3.wasm`, `tree-sitter.wasm` and 9 grammars. Unzipped into an empty directory with no `node_modules`, its bundled CLI indexes a C repository and resolves symbols (see below). The same holds for the standalone CLI bundle, checked in CI by `packages/cli/test/bundle.test.ts`. **Not done:** an install inside the Bosch network, and an install into a real VS Code |
| pilot team runs 2 weeks; pilot sign-off | **not started**: needs people and the pilot environment |

## Evidence
- `packages/cli/test/bundle.test.ts` builds the CLI bundle into a temp directory, then runs `index`, `jump` (auto-starting a daemon from the bundle itself) and `riaf_pack` over MCP stdio, with no `node_modules` in reach.
- `packages/extension/test/extension.test.ts`:
  - the five LM tools and `package.json` agree, schemas included;
  - every tool, the `@riaf` participant (pack and clarify paths) and all five console pages work against a real daemon core;
  - policies are saved only after they validate;
  - `activate` registers the status bar, tools, participant and every declared command (against a mocked VS Code API).
- Manual check: unzipped the `.vsix` and ran `node extension/dist/riaf/riaf.mjs index` and `jump uart_send_frame` on `embedded-c`: 13 files, 56 symbols, 126 edges, in 137 ms.

## Release
- `release.yml` (on `v*` tags) attaches the `.vsix` and a portable `riaf-cli-<tag>.tgz`.
- The plan's single-file executables built with `node --experimental-sea-config` are **not** produced. Node's SEA would need the wasm runtimes and grammars to move into SEA assets, and the loaders to read them from there. The portable tarball runs on any Node ≥ 20 and keeps the no-download property.
