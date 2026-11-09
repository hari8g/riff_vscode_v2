# ADR-0004 — The daemon RPC evolves additively within a protocol major

**Status:** accepted · **Date:** 2026-11-09

## Context
The RPC table in `kernel/src/schemas/rpc.ts` is the contract between the daemon and every client (extension, MCP server, CLI, eval). Milestones add capabilities one at a time (history in M4, governance in M5), so the table grows across releases while old clients keep running against newer daemons and vice versa during an upgrade.

## Decision
`RPC_PROTOCOL_VERSION` is `major.minor`. Adding a method or an optional field (params or result) bumps the minor; removing or retyping anything bumps the major and needs a new ADR. The daemon advertises its protocol and method list through `daemon.info`; the client SDK refuses a daemon with a different major and reports "method not available" for methods the daemon does not list, instead of failing at call time.

Protocol 1.1 (this ADR) adds `daemon.info`, `daemon.shutdown`, a free-text `query` on `graph.jump`, optional `kind`, `doc`, `alternatives` and per-reference `confidence` in its result, and `wait` on `index.rebuild` with the run summary in its result.

## Consequences
- Clients built for 1.0 keep working against a 1.1 daemon.
- Each milestone that adds RPC methods bumps the minor in the same commit as the schema change.

Protocol 1.2 (M3) adds `pack.get`, `wiki.structure`, `wiki.page`, `runbook.get`, and optional `sessionId` / `includeRunbook` on `pack.compile`; `route` and `pack.compile` become served.

Protocol 1.3 (M4) adds `history.timeline` and `history.rationale`; `graph.jump` now fills `blame`.

Protocol 1.4 (M5) serves `govern.toolCall` and `govern.event` (kinds `session.start`, `tool.result`, `pack.read`, `session.end`) and adds `telemetry.query`.
