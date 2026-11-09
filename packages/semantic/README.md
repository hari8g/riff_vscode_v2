# @riaf/semantic — L3 meaning and conventions

Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/graph`, `@riaf/history`.

- `summaries.ts` — the `summaries` stage: extractive bottom-up summaries (file → directory → package → repo) built from stored chunks and symbols, keyed by blob/tree hash so one save regenerates one file and its ancestors.
- `architecture.ts` — packages, languages, frameworks, build/test/lint commands, entry points, generated paths, clusters, test layout.
- `conventions.ts` — structural conventions with evidence and confidence; history contributes co-change rules from M4.
- `runbook.ts` — the operational CLAUDE.md fragment; never longer than 60 lines; hand-written constraints are kept verbatim.
- `semantic.ts` — façade: `update`, `summary`, `architecture`, `conventions`, `runbook`, `wikiStructure`, `wikiPage`.
