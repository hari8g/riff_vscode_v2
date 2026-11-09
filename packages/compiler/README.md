# @riaf/compiler — L5 context pack compiler

`compile(composedPolicy, repoView, opts) → Pack` and `render(pack, target)`. Allowed imports: `@riaf/kernel`, `@riaf/store`, `@riaf/graph`, `@riaf/history`, `@riaf/semantic`, `@riaf/intent` (types).

- `expand.ts` — sufficiency expansion. Anchors first, then each composed rule: callers/callees, the exercising test, sibling templates, implemented interfaces, reference sites (±2 lines), inheritance, dynamic-dispatch sites, co-change partners, module summaries, file skeletons (flow both ways, implementations behind interfaces, PageRank hubs), one-hop. Also conventions and history scopes (history becomes open lookups until M4).
- `knapsack.ts` — greedy by score with bucket shares, rule caps (cap-before-blend), a shared second pass, a sufficiency threshold (20% of the best score), body→signature degradation, and refunds when a larger item covers smaller ones.
- `compile.ts` — elastic repo map (30% of the map allowance for `single`, up to 100% for onboarding or `generic`), optional run-book (left out for Claude, whose CLAUDE.md imports it), ordering by tier then stage, open lookups, contract validation.
- `render/` — `claude` (markdown by tier and stage), `copilot` (sheds low-value items to a size limit), `fragment` (system-prompt block), `json` (canonical), `agentsmd`.

Localisation over the 30 eval tasks (`test/compile.test.ts`): mean file recall 97.1%, mean 1,489 tokens per pack, against the scripted baseline's 86.8% and 2,941 tokens.
