# RIAF v2 for VS Code

Repository intelligence for Copilot and Claude Code. RIAF indexes the workspace locally and compiles a **budgeted, provenance-stamped context pack** for each task: the code bodies that matter, the test to mimic, callers, conventions and history. Indexing uses tree-sitter and SQLite in wasm, so nothing is downloaded at install time and no native modules are built.

- **Copilot**: language-model tools `#riafPack`, `#riafJump`, `#riafImpact`, `#riafHistory`, `#riafWiki`, and the `@riaf` participant, which compiles a pack and hands the task to Copilot agent mode or Claude Code.
- **Claude Code**: run **RIAF: Initialise repository** to write `.riaf/` policies, the run-book (`CLAUDE.md` imports it), `.mcp.json` and the governance hooks.
- **Console** (status bar → RIAF): index health, branch distribution, the repository tree and run-book, the policy editor (validated before saving), sessions and utilisation, and adapters.

Settings: `riaf.budget`, `riaf.models` (API keys are referenced by environment variable name only).
