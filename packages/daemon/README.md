# @riaf/daemon — the process that owns the index (ADR-0001)

Composition root, incremental pipeline, watcher, JSON-RPC server, and the client SDK every consumer uses. Allowed imports: every layer package plus `@riaf/models`.

- `core.ts` — `DaemonCore`: opens the store, builds the layers, registers the pipeline stages (`scan → parse → graph → lsp`) and exposes every capability as RPC handlers. Tests, eval and in-process CLI runs use it directly.
- `scheduler.ts` — ordered stage DAG with Merkle-gated pending counts. Triggers that arrive during a run coalesce into one follow-up run. A failing stage is recorded and does not stop later stages.
- `watcher.ts` — debounced recursive `fs.watch` (polling fallback). Working-tree edits and git ref moves are reported separately.
- `rpc/` — newline-delimited JSON-RPC 2.0 over a unix socket or Windows named pipe. Params are validated against the kernel contract on every call. `DaemonClient` auto-starts the daemon, checks the protocol major (ADR-0004) and knows which methods the daemon serves.
- `main.ts` — `startDaemon`: socket, `.riaf/daemon.json`, debounced persistence, idle shutdown, clean stop. `bin.ts` — the detached daemon entry.
- `health.ts` — checks behind `riaf doctor`. `policies.ts` — loads and validates `.riaf/*.yaml`.
