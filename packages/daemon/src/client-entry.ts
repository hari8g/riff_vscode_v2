/**
 * `@riaf/daemon/client` — the client SDK alone (no store, no indexing layers), for consumers that
 * only talk to a running daemon: the VS Code extension and the Claude Code hooks.
 */
export * from './paths.js';
export * from './rpc/protocol.js';
export * from './rpc/client.js';
