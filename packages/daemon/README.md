# @riaf/daemon

The process that owns the index: pipeline scheduler, watcher, JSON-RPC server and client SDK (ADR-0001).

Arrives in milestone **M1**. Allowed imports: @riaf/kernel, @riaf/store, @riaf/parse, @riaf/graph, @riaf/history, @riaf/semantic, @riaf/intent, @riaf/compiler, @riaf/govern, @riaf/models (enforced by `pnpm lint`).
