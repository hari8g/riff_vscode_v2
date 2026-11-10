/**
 * @riaf/daemon — the process that owns the index (ADR-0001): composition root, incremental pipeline
 * scheduler, file watcher, JSON-RPC server, and the client SDK every consumer uses.
 */
export * from './paths.js';
export * from './git.js';
export * from './policies.js';
export * from './tokens.js';
export * from './scheduler.js';
export * from './watcher.js';
export * from './core.js';
export * from './health.js';
export * from './main.js';
export * from './rpc/protocol.js';
export { dispatch, RpcServer, type RpcHandlers, type DispatchOptions } from './rpc/server.js';
export * from './rpc/client.js';
