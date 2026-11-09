# Installing RIAF v2

Everything RIAF needs ships in the package: the daemon and CLI bundle, SQLite and tree-sitter compiled to wasm, and the grammars for TypeScript/JavaScript, Python, Java, Go, C, C++ and C#. Nothing is downloaded at install or run time, and nothing native is compiled. That is what lets it install behind a corporate proxy.

## VS Code (Copilot)
1. Download `riaf-vscode-v2-<version>.vsix` from the release (or `pnpm package:vsix` in this repository).
2. **Extensions → … → Install from VSIX…**, or `code --install-extension riaf-vscode-v2-<version>.vsix`.
3. Open a folder. The status bar shows **RIAF n files** once the first index has run. The daemon runs on VS Code's own runtime (`ELECTRON_RUN_AS_NODE`), so no separate Node installation is needed.
4. In Copilot Chat: ask `@riaf <task>`, or reference `#riafPack` / `#riafJump` / `#riafImpact` / `#riafHistory` / `#riafWiki` in agent mode.
5. **RIAF: Open console** shows index health, branch distribution, the repository tree and run-book, the policy editor, sessions and utilisation.

## Claude Code
In the repository, run **RIAF: Initialise repository** from VS Code, or with the CLI:

```bash
riaf init --host claude
```

This writes `.riaf/policies.yaml`, `.riaf/governance.yaml`, `.riaf/constraints.md`, the generated `.riaf/runbook.md` (imported from `CLAUDE.md`), `.mcp.json` with the `riaf` MCP server, the slash commands `/riaf-pack`, `/riaf-jump`, `/riaf-impact` and `/riaf-history`, and the governance hooks in `.claude/settings.json`. Pass `--no-hooks` to skip the hooks. Start `claude` in the repository and approve the project's MCP server and hooks once.

As a plugin instead: `riaf plugin --out ~/riaf-plugin`, then add it with `/plugin` in Claude Code.

## CLI only
Unpack `riaf-cli-<version>.tgz` anywhere and run `node riaf-cli/riaf.mjs <command>` (Node ≥ 20). `riaf doctor` checks the runtime, grammars, index, policies and LSP servers.

## Models (optional)
RIAF needs no model to index, route or compile. A small model improves commit summaries, and a classifier arbiter helps uncertain routes. Configure them in `.riaf/models.json` (daemon) or `riaf.models` (VS Code):

```json
{ "summarize": { "provider": "ollama", "model": "qwen2.5:7b" },
  "classify":  { "provider": "openai", "model": "gpt-4o-mini", "baseUrl": "https://gateway.internal/v1", "apiKeyEnv": "GATEWAY_TOKEN" } }
```

API keys are read from the named environment variable and never stored. Requests honour `HTTPS_PROXY` / `NO_PROXY`.
