# @riaf/eval — the harness

Measures RIAF against baselines on the frozen task set. Allowed imports: `@riaf/kernel`, `@riaf/daemon`, compiler types.

- `fixtureHistory.ts` — replays a fixture as a deterministic 200-commit git history (features, bug fixes with tickets, a revert, a bulk reformat, co-changing pairs) and returns the manifest of known answers. CLI: `tooling/scripts/make-fixture-history.mjs`.
- `tasks.ts` — `fixtures/tasks/<id>/task.yaml`: request, IDE state, gold intent, gold files and symbols, `setup`/`gold` find-replace edits, hidden tests. `tasks.test.ts` proves every hidden test fails after setup and passes after gold.
- `workspace.ts`, `testrun.ts` — disposable task workspaces and per-language test execution (Vitest, pytest via uv, cc, javac).
- `runners/` — `scripted` (no-RIAF grep-and-read baseline), `claude` (Claude Code headless with stream-json parsing; spends API credit, opt-in). The compiler runner arrives with M3.
- `metrics.ts`, `report.ts`, `harness.ts` — recall, precision, tokens, tool calls, pass rate, branch distribution, clarification rate, utilisation, and markdown/JSON reports.
- `golden.ts` — canonical JSON and line diffs for golden packs (re-approval is explicit).

Run: `riaf eval --runner scripted` → `reports/eval/report.{md,json}`. Baseline: `docs/eval/baseline.md`.
