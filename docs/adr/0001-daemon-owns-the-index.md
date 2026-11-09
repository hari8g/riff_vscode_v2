# ADR-0001 — One daemon per repository owns the index

**Status:** accepted · **Date:** 2026-11-09

## Context
riaf-vscode v1 opened the SQLite index from the VS Code extension, the MCP server and the CLI independently, each with its own index manager. That duplicated the incremental pipeline three times and produced write contention on the wasm database.

## Decision
A single local daemon process per repository root owns `.riaf/index.sqlite`, the file watcher and the incremental pipeline. The extension, the MCP server, the CLI and the eval harness are clients of its JSON-RPC socket (`.riaf/daemon.sock` or a Windows named pipe). The daemon is the composition root: the only place adapters are wired into ports.

## Consequences
- One pipeline, one cache, one set of metrics.
- Clients become thin and can be generated from the RPC schema.
- A daemon that is not running must be auto-started by the client SDK; `riaf doctor` reports its health.
