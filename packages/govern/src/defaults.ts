import { GovernanceFileSchema, type GovernanceFile } from '@riaf/kernel';

/** Built-in governance, identical to the repository's `.riaf/governance.yaml` (a test keeps them equal). */
export const DEFAULT_GOVERNANCE: GovernanceFile = GovernanceFileSchema.parse({
  version: 1,
  phases: {
    explore: { soft_calls: 40, max_calls: 80, soft_tokens: 120000, max_tokens: 250000, max_minutes: 30 },
    plan: { soft_calls: 15, max_calls: 40, soft_tokens: 60000, max_tokens: 120000, max_minutes: 15 },
    implement: { soft_calls: 80, max_calls: 200, soft_tokens: 250000, max_tokens: 500000, max_minutes: 90 },
    verify: { soft_calls: 30, max_calls: 80, soft_tokens: 120000, max_tokens: 250000, max_minutes: 30 },
  },
  guard: { serve_first_reads: false, serve_repeat_reads: true, rewrite_grep_to_index: true, loop_threshold: 3 },
  compaction: { advise_at_ratio: 0.7, keep: ['plan', 'anchors', 'open_lookups', 'last_test_result'] },
});
