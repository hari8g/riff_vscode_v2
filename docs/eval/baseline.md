# Baseline (M2) — frozen

Task set: 30 tasks in `fixtures/tasks` over the four fixture repos, frozen at content hash `2fa5899690d76da2` (sha256 of every task file, sorted). The plan's rule is that the set does not change once M3 work starts. A new task means a new baseline run.

| Repo | Tasks | Kinds |
| --- | --- | --- |
| toll-ts (34 files, TS) | 12 | 6 bugfix (one with a stack trace), 4 feature (one touching two files), 1 refactor, 1 onboarding |
| telemetry-py (12 files, Python) | 7 | 4 bugfix (one with a stack trace, one with a failing test), 2 feature, 1 onboarding |
| embedded-c (13 files, C) | 6 | 3 bugfix, 2 feature, 1 refactor |
| fleet-java (17 files, Java) | 5 | 2 bugfix, 1 feature, 1 refactor, 1 onboarding |

All 27 tasks with hidden tests are verified in CI (`packages/eval/test/tasks.test.ts`): hidden tests fail after `setup` and pass after `gold`, using Vitest, pytest, cc and javac.

## Scripted no-RIAF baseline

`riaf eval --runner scripted` emulates an agent without an index. It lists the tree, greps the request's keywords (identifiers first) and reads the six most-hit files in full, opening IDE anchors (active file, failing test, stack-trace frames) first. Every tool output is charged as context tokens. It is deterministic, so it is the reference point for M3's pack and M5's tool-call gates.

| Runner | Tasks | File recall | Full recall | Precision | Mean tokens | Mean tool calls |
| --- | --- | --- | --- | --- | --- | --- |
| scripted-baseline | 30 | 86.8% | 24/30 | 25.4% | 2.9k | 11.5 |

By intent:

| Intent | Tasks | File recall | Mean tokens | Mean tool calls |
| --- | --- | --- | --- | --- |
| bugfix | 15 | 86.7% | 2.8k | 11.5 |
| feature | 9 | 100.0% | 2.6k | 11.4 |
| refactor | 3 | 83.3% | 2.6k | 11.0 |
| onboarding | 3 | 51.1% | 5.2k | 12.0 |

Raw results: `docs/eval/baseline.json`.

### Reading the numbers
The fixtures are small (13–34 files), so grepping and reading whole files already finds most gold files cheaply. This is a deliberately hard bar for RIAF's token gate. A pack only wins on tokens if it is smaller than six whole files, so the compiler treats its budget as a ceiling and stops at sufficiency. It is not a target to fill. Precision (25%) is where the baseline is weak: three of every four files it reads are noise.

## Claude Code headless baseline: not yet run
`riaf eval --runner claude` runs each task through `claude -p` in a fresh workspace and scores it with the hidden tests. The runner is implemented and tested against a scripted stand-in (`packages/eval/test/fixtures/fake-claude.mjs`). It has not been run against the real model, because a 30-task pass spends API credit and needs an explicit go-ahead. Pass rate is therefore not part of this baseline yet. Run it with:

```bash
pnpm build && node packages/cli/dist/main.js eval --runner claude --out reports/eval-claude
```
