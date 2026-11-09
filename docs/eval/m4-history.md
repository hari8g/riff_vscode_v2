# M4 — History: gate results

Measured 9 Nov 2026. Reproduce with `pnpm build && pnpm bench:index` and `node packages/cli/dist/main.js eval --runner compiler,compiler+history`.

## Gates

| Gate (implementation plan) | Status |
| --- | --- |
| history stage adds < 10% to incremental index time | **met**: 2 ms of a 279 ms one-line edit (0.7%) on the 100k-LOC benchmark repo; 3 ms on a warm no-op run |
| bug-fix pass rate up on tasks with a blame commit | **not measured**: needs paid Claude Code headless runs. The proxy below shows the signal reaches the pack |

## What history adds to a pack
Eval workspaces with `history: true` start from the fixture's synthetic 200-commit history, with the task's starting state committed last (`chore: <task> starting state`). For the 14 bugfix tasks that inject a bug, that commit is the culprit.

| Measure | Result |
| --- | --- |
| bugfix packs that contain the culprit commit | **12 / 14** |
| commit items per bugfix pack | 8.3 on average |
| file recall with vs without history | 97.1% vs 97.1% (unchanged) |
| mean pack tokens with vs without history | 1.6k vs 1.5k (+10.3%) |

The two misses are `fleet-001` and `tel-003`. `fleet-001` routes to the `generic` branch, whose policy has no history scope. `tel-003` anchors on the failing test file, and its faulty file is reached only through expansion.

Three design points came out of the measurement:
- **File anchors get file-wide history.** The active file or a stack-trace file is often the only anchor in a bug report.
- **"Recent change in file" items** use the commit log, not blame, because blame cannot see a bug that *deletes* a line (`fleet-002`).
- **A save without a commit does not trigger `git blame`.** Uncommitted lines have no history. Files are re-blamed when a commit touches them, and co-change is recomputed only when commits arrive. This took the edit-time cost from 19.3% to 0.7%.

## Correctness (known answers, `packages/history/test/history.test.ts`)
On the synthetic toll-ts history: 200 commits mined. The bulk reformat is flagged as noise and owns no line in blame. Every injected bug line is blamed on its fix commit, never on the bug commit. The revert is linked to the change it undoes. Both scripted co-change pairs are found at file level. A new commit mines one commit and re-blames one file. A rewritten (amended) history is detected and re-mined. An ADR is linked to the symbols it mentions. Symbol-level co-change connects functions in different files that change in the same commits.
