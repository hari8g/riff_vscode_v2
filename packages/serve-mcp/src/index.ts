/**
 * @riaf/serve-mcp — the MCP server for Claude Code and any MCP client: riaf_pack, riaf_jump,
 * riaf_impact, riaf_history, riaf_wiki and the riaf:// resources, over stdio or streamable HTTP.
 * `hooks.ts` generates the Claude Code hook script, its settings block and the installable plugin.
 */
export * from './format.js';
export * from './server.js';
export * from './transports.js';
export * from './hooks.js';
