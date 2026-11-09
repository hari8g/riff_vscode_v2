# @riaf/serve-mcp — MCP server for Claude Code and any MCP client

Tools: `riaf_pack` (compile a context pack), `riaf_jump`, `riaf_impact`, `riaf_history`, `riaf_wiki`. Resources: `riaf://pack/current`, `riaf://runbook`, `riaf://architecture`. Transports: stdio (`riaf mcp`, launched by Claude Code from `.mcp.json`) and streamable HTTP (`riaf mcp --http PORT`, stateless).

Every tool delegates to the daemon over RPC; errors come back as tool errors, never as transport failures. Allowed imports: `@riaf/kernel`, `@riaf/daemon` (client), compiler render types. Claude Code hooks and the installable plugin arrive with M5.
