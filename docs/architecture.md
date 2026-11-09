# RIAF v2 architecture (summary)

Full brief: *RIAF v2 — Repository Understanding Architecture Brief* (Claude Docs, Nov 2026). This file carries the parts the code refers to.

## Layers

| Layer | Package | Responsibility |
| --- | --- | --- |
| L0 | store | one SQLite file per repo: Merkle table, symbols, graph edges, FTS5, trigram, vectors, history, summaries, packs, telemetry |
| L1 | parse, graph | tree-sitter tags and chunks, import resolution, optional LSP enrichment; heterogeneous structural graph, personalized PageRank repo map, closure, impact |
| L2 | history | blame per symbol, co-change matrix, reverts and incidents, ADRs, commit summaries |
| L3 | semantic | bottom-up summaries, architecture map, conventions and invariants, entity-grounded skills, optional embeddings |
| L4 | intent | task units → intent vector → entropy gate → composed policy (ADR-0003) |
| L5 | compiler | sufficiency expansion, knapsack under budget, tiers, stages, renders |
| L6 | govern | tool-call budgets, tool cache, loop guard, compaction advice, telemetry, skill distillation |
| — | models, daemon, serve-mcp, cli, extension, eval | adapters, process, serve surfaces, harness |

## Design constraints
1. Local-first; nothing leaves the machine; nothing downloaded at install (ADR-0002).
2. One daemon owns the index (ADR-0001).
3. Everything incremental and content-addressed through the Merkle table.
4. Ports in kernel, adapters in models; no vendor types below the daemon.
5. Policies are data in `.riaf/*.yaml`, validated by kernel schemas.
6. Every milestone closes on an eval-harness number.

## The pack contract (short form)
Header: `packId, repo, commit, route{w, H, branch, stages}, budget, tokensUsed, openLookups[], policyVersion, createdAt`.
Items: `id, tier (1 map · 2 ingredients · 3 history/conventions · 4 runbook), kind, source, hash, why, tokens, stage, content`.
