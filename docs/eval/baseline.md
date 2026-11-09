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

## Claude Code headless baseline (no RIAF)

Run 9 Nov 2026 with Claude Code 2.1.318 (`riaf eval --runner claude`, three tasks in parallel). Each task ran with `claude -p` in a fresh workspace, with edits accepted and shell commands not pre-approved, and was then scored by its hidden tests. Raw results are in `docs/eval/claude-baseline.json`.

| Runner | Tasks | File recall | Full recall | Precision | Mean tokens | Mean tool calls | Pass rate | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-baseline | 30 | 96.7% | 29/30 | 54.6% | 246k | 8.2 | 100% (27) | $6.99 |

| Intent | Tasks | Passed | Mean tokens | Mean tool calls | Cost |
| --- | --- | --- | --- | --- | --- |
| bugfix | 15 | 15/15 | 219k | 7.0 | $3.21 |
| feature | 9 | 9/9 | 300k | 9.9 | $2.33 |
| refactor | 3 | 3/3 | 279k | 9.7 | $0.71 |
| onboarding | 3 | 0/0 | 187k | 8.0 | $0.74 |

### Reading the numbers
- **Pass rate is saturated.** Claude Code solves every task on these small fixtures without help. RIAF's M3 condition, "no pass-rate loss", therefore means staying at 100%. Any gain has to show in tokens, tool calls and cost.
- **Tokens are dominated by Claude Code's own context.** The mean of 246k counts input (mostly cached system prompt and tool definitions), output and cache reads per task. The scripted baseline's 2.9k counts only what exploration pulls in. The two are not comparable, which is why RIAF has to be measured in the same harness.
- **Not yet run: the RIAF condition.** That means Claude Code with the RIAF MCP server and hooks attached, so there is no RIAF-vs-baseline comparison under Claude Code yet. It costs about the same as this run (≈ $7).
