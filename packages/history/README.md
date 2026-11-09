# @riaf/history — L2 git intelligence

Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/graph`.

- `gitio.ts` — git through machine formats only (record-separated `log --numstat`, porcelain blame); HEAD read from `.git` without spawning git.
- `commits.ts` — commit kinds (conventional prefixes and keywords), the noise filter (bulk reformats, balanced sweeps, vendored/generated/lock-only changes, `.git-blame-ignore-revs`), reverts (`This reverts commit …`), ticket / incident refs, extractive summaries.
- `stage.ts` — the incremental `history` stage. It mines `last..HEAD`, re-mines everything when history was rewritten, and blames files once per commit that touches them (or when never blamed). Blame uses `-w` and ignores noise revisions, so it is attributed per symbol. ADRs are refreshed, and co-change only when commits arrive. An optional ModelPort writes abstractive commit summaries.
- `cochange.ts` — symbol co-change from commits that own current lines of both symbols (across files, focused commits only) as `co_changes` edges, plus file co-change from commit file lists.
- `adr.ts` — ADRs and post-mortems linked to the symbols and files they mention.
- `history.ts` — façade: `blame` (a file id aggregates its symbols), `timeline`, `rationale`, `conventions` (co-change ≥ 0.8 confidence), and `facts()` for the compiler (`blame`, `incidents`, `origin`, `recent`, `adrs`).
