import { PoliciesFileSchema, type PoliciesFile } from '@riaf/kernel';

/**
 * Built-in policies, identical to the repository's `.riaf/policies.yaml`; used when a repository has
 * not run `riaf init` yet. Validated at load time so a typo here fails tests, not users.
 */
export const DEFAULT_POLICIES: PoliciesFile = PoliciesFileSchema.parse({
  version: 1,
  router: { entropy: { single_below: 0.35, blend_below: 0.7 }, top_intent_min: 0.7, blend_floor: 0.15, clarify_max_questions: 1 },
  budget: { default_total: 16000, fixed: { map: 2000, runbook: 1500 } },
  primitives: {
    bugfix: { anchors: ['stack_trace', 'issue_terms', 'failing_test', 'selection'], expansion: [{ rule: 'callers', hops: 2 }, { rule: 'callees', hops: 2 }, { rule: 'exercising_test' }], history: ['blame_on_anchors', 'reverts_touching_anchors'], weights: { ingredients: 0.6, history: 0.4 } },
    feature: { anchors: ['sibling_feature', 'extension_points', 'selection'], expansion: [{ rule: 'sibling_template' }, { rule: 'implemented_interfaces' }, { rule: 'exercising_test' }], history: ['origin_commits_of_sibling'], weights: { template: 0.65, conventions: 0.2, history: 0.15 } },
    merge: { anchors: ['conflict_hunks'], expansion: [{ rule: 'both_branch_touched' }, { rule: 'co_change_partners' }, { rule: 'tests_over' }], history: ['both_branch_summaries'], weights: { diffs: 0.4, co_change: 0.3, tests: 0.3 } },
    review: { anchors: ['diff_symbols'], expansion: [{ rule: 'co_change_partners', exclude: 'in_diff' }, { rule: 'invariants_on' }], history: ['recent_incidents_on'], weights: { diff_context: 0.4, invariants: 0.3, co_change: 0.3 } },
    refactor: { anchors: ['target_symbols', 'selection'], expansion: [{ rule: 'reference_closure', cap: 0.5 }, { rule: 'inheritance_tree' }, { rule: 'dynamic_dispatch_sites' }], history: ['reverts_touching_anchors'], weights: { closure: 0.85, history: 0.15 } },
    onboarding: { anchors: ['architecture_nodes'], expansion: [{ rule: 'module_summaries' }, { rule: 'file_skeletons' }], history: ['adrs'], weights: { summaries: 0.7, skeletons: 0.3 } },
    unknown: { anchors: ['grounded_identifiers'], expansion: [{ rule: 'one_hop' }], history: [], weights: { grounded_hits: 0.5, open_lookups: 0.5 } },
  },
});
