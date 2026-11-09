# riaf_vscode_v2

**RIAF v2 — repository intelligence that compiles a budgeted, provenance-stamped context pack for any frontier model.**

Enterprise developer teams lose most of an agent's budget to the agent re-discovering the repository: where things are, what calls what, why a line looks the way it does, which test to copy. RIAF v2 indexes the repository locally (structure, git history, meaning), classifies the developer's intent as a *distribution* rather than a label, composes a retrieval policy, and hands the model the smallest set of tokens with which it can act correctly on the first attempt — plus an explicit list of what it still needs to look up.

- **Local-first.** One daemon per repository owns a single SQLite file under `.riaf/`. Nothing leaves the machine; nothing is downloaded at install time (sqlite-wasm, tree-sitter-wasm — no native modules), so it installs behind a corporate proxy.
- **Portable.** The same pack feeds Claude Code (MCP server + hooks), GitHub Copilot (language-model tools) and any model (system-prompt fragment).
- **Measured.** Every milestone closes on a number from the eval harness: file-level recall, tokens per task, tool calls per task, pass rate, pack utilisation.

## Layout

```
packages/
  kernel      shared vocabulary: ids, hashing, tokens, events, ports, zod schemas (the contracts)
  store       L0  SQLite (wasm), migrations, Merkle table, FTS5, trigram, vectors
  parse       L1  tree-sitter tags, chunker, import resolver, optional LSP enrichment
  graph       L1  ISS structural graph, personalized PageRank repo map, closure, impact
  history     L2  git mining: blame per symbol, co-change, reverts, ADRs, commit summaries
  semantic    L3  bottom-up summaries, architecture map, conventions, skills, embeddings
  intent      L4  decomposer, intent vector, entropy gate, probe, policy composer
  compiler    L5  primitive policies, sufficiency expansion, knapsack, tiers, stages, renders
  govern      L6  tool-call budgets, tool cache, loop guard, telemetry, skill distillation
  models      port adapters: Copilot LM, Anthropic, OpenAI-compatible gateway (SSO), Ollama
  daemon      the process that owns the index: scheduler, watcher, JSON-RPC, client SDK
  serve-mcp   MCP server, Claude Code hooks, plugin bundle
  cli         riaf index | pack | jump | impact | history | eval | doctor | serve | init
  extension   VS Code: LM tools, @riaf participant, console webview
  eval        harness: tasks, runners, metrics, golden packs
```

Dependency direction is one way and enforced by lint: `kernel → store → {parse, graph, history, semantic} → intent → compiler → govern → daemon → {serve-mcp, cli, extension, eval}`. See `docs/architecture.md` and `docs/adr/`.

## Develop

```sh
corepack enable
pnpm install
pnpm verify          # build + lint + test + schema check
pnpm test:watch
```

Node 20+, pnpm 9+. The repository dogfoods RIAF: `.riaf/policies.yaml` and `.riaf/governance.yaml` are the live policy files, `CLAUDE.md` imports the generated run-book.

## Status

M0 (bootstrap, kernel, store) — in progress. See `docs/implementation-plan.md` for milestones M0–M6.

## License

MIT
