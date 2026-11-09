# @riaf/intent — L4 router and policy composer (ADR-0003)

`route(request, deps) → { policy: ComposedPolicy, diagnostics }`. Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/graph`, `@riaf/semantic`.

Pipeline: `decompose` (clauses with their own strong cue become units; order words make dependencies) → `groundAnchors` (stack frames, failing tests, selection, identifiers, paths, diff, symbol-name coverage, prefix full-text search) → `classify` (lexicon + IDE evidence, softmax at T=0.6) → `applyPriors` → optional `arbitrate` through a ModelPort → `gate` on normalised entropy → `probe` (index evidence re-weights) → `clarify` (live) or `generic` (unattended) → `compose` (p-floor, cap-before-blend, history union, renormalised buckets, staged units).

Calibration on the 30 eval tasks (`test/route.test.ts`, gate ≥ 90%): 29/30 intents correct, 29/30 tasks with a gold file among the anchors. `RIAF_CALIBRATE=1 pnpm vitest run packages/intent` prints the per-task table.
