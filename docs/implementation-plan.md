# Implementation plan (summary)

Full plan: *riaf_vscode_v2 — Implementation Plan and Working Tree* (Claude Docs, 9 Nov 2026). Milestones and their gates:

| Milestone | Packages | Gate |
| --- | --- | --- |
| M0 Bootstrap | repo, kernel, store | `pnpm verify` green; store round-trips 10k blobs; FTS query under 20 ms on fixture `toll-ts` |
| M1 Structural core | parse, graph, daemon, cli | second index run touches 0 blobs; `riaf jump` resolves 95% of fixture references; 100k LOC cold index under 60 s |
| M2 Harness and baseline | eval, fixtures | baseline numbers published; task set frozen |
| M3 Compiler and MCP | intent, compiler, semantic (run-book, summaries), serve-mcp | `riaf_pack` live in Claude Code; file recall ≥ 85%; ≥ 30% fewer tokens per task, no pass-rate loss |
| M4 History | history | bug-fix pass rate up where a blame commit exists; history stage < 10% of incremental time |
| M5 Governance and learning | govern, hooks, models | ≥ 40% fewer tool calls per task; skills reused in ≥ 3 of 30 tasks |
| M6 Extension and pilot | extension, console, release | .vsix installs behind the proxy with no downloads; two-week pilot sign-off |

Rules: nothing above `store` starts before M0's tests pass; no serve surface before its harness metric exists; every milestone ends with the run-book regenerated and golden packs re-approved.
