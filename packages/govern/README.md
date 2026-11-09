# @riaf/govern — L6 governance and learning

`Governor.onToolCall(call) → allow | serve (cache | index) | reflect | block`, `onToolResult`, `onPackCompiled`, `onSessionEnd`. Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/graph`, `@riaf/semantic`, compiler types.

- `budgets.ts` — per-phase call/token/minute limits from `.riaf/governance.yaml`: soft → one reflection per limit, hard → block. The phase is inferred from the session itself: explore until the first edit, implement after it, verify once tests run.
- `serve.ts` — Grep from the trigram index (literal or regex with a literal core) and Glob from the indexed paths. A search the index cannot answer, or that finds nothing, runs as the real tool.
- `governor.ts` — loop guard (the same call `loop_threshold` times in a row), repeat reads of unchanged blobs served from the session cache, compaction advice at `advise_at_ratio` of the context window, and per-call telemetry.
- `learn.ts` — pack utilisation (items the agent read or edited), per-repo intent priors (top-intent frequency, smoothed and blended with uniform) fed to the router, and distillation of successful sessions into skills grounded on the edited symbols (purpose, playbook of steps, APIs used).
