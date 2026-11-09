# @riaf/serve-mcp — MCP server, Claude Code hooks, plugin

Tools: `riaf_pack`, `riaf_jump`, `riaf_impact`, `riaf_history`, `riaf_wiki`. Resources: `riaf://pack/current`, `riaf://runbook`, `riaf://architecture`. Transports: stdio (`riaf mcp`, launched by Claude Code from `.mcp.json`) and stateless streamable HTTP (`riaf mcp --http PORT`).

`hooks.ts` generates the Claude Code hook script: one dependency-free `.mjs` speaking JSON-RPC to the daemon. It handles SessionStart, UserPromptSubmit (pack injection), PreToolUse (governor), PostToolUse (telemetry) and Stop (learning). It fails open and never emits `allow`. Also generated: the settings block (`riaf init --host claude`) and an installable plugin (`riaf plugin --out DIR`).

Allowed imports: `@riaf/kernel`, `@riaf/daemon` (client), compiler render types.
