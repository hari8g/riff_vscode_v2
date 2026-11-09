/**
 * Files `riaf init` writes. The YAML templates are the same documents as this repository's own
 * `.riaf/` files (a test keeps them identical), so new repositories start from dogfooded policies.
 */

export const POLICIES_YAML = `# RIAF v2 retrieval policies — versioned with the repository.
# Validated by @riaf/kernel schemas/policy.ts. Loaded by @riaf/intent and @riaf/compiler.
version: 1

router:
  # normalised entropy H(w) in [0,1] over the intent vector
  entropy:
    single_below: 0.35        # one intent dominates → single primitive policy
    blend_below: 0.70         # two or more intents → weighted union
    # at or above blend_below → probe anchors, rescore; then clarify (live) or generic pack (unattended)
  top_intent_min: 0.70        # required for the single branch
  blend_floor: 0.15           # primitives below this weight do not contribute to a blend
  clarify_max_questions: 1

budget:
  default_total: 16000
  fixed:
    map: 2000                 # skeleton repo map (signatures only)
    runbook: 1500             # operational run-book fragment

primitives:
  bugfix:
    anchors: [stack_trace, issue_terms, failing_test, selection]
    expansion:
      - { rule: callers, hops: 2 }
      - { rule: callees, hops: 2 }
      - { rule: exercising_test }
    history: [blame_on_anchors, reverts_touching_anchors]
    weights: { ingredients: 0.6, history: 0.4 }
  feature:
    anchors: [sibling_feature, extension_points, selection]
    expansion:
      - { rule: sibling_template }
      - { rule: implemented_interfaces }
      - { rule: exercising_test }
    history: [origin_commits_of_sibling]
    weights: { template: 0.65, conventions: 0.2, history: 0.15 }
  merge:
    anchors: [conflict_hunks]
    expansion:
      - { rule: both_branch_touched }
      - { rule: co_change_partners }
      - { rule: tests_over }
    history: [both_branch_summaries]
    weights: { diffs: 0.4, co_change: 0.3, tests: 0.3 }
  review:
    anchors: [diff_symbols]
    expansion:
      - { rule: co_change_partners, exclude: in_diff }
      - { rule: invariants_on }
    history: [recent_incidents_on]
    weights: { diff_context: 0.4, invariants: 0.3, co_change: 0.3 }
  refactor:
    anchors: [target_symbols, selection]
    expansion:
      - { rule: reference_closure, cap: 0.5 }
      - { rule: inheritance_tree }
      - { rule: dynamic_dispatch_sites }
    history: [reverts_touching_anchors]
    weights: { closure: 0.85, history: 0.15 }
  onboarding:
    anchors: [architecture_nodes]
    expansion:
      - { rule: module_summaries }
      - { rule: file_skeletons }
    history: [adrs]
    weights: { summaries: 0.7, skeletons: 0.3 }
  unknown:
    anchors: [grounded_identifiers]
    expansion:
      - { rule: one_hop }
    history: []
    weights: { grounded_hits: 0.5, open_lookups: 0.5 }
`;

export const GOVERNANCE_YAML = `# RIAF v2 tool-call governance — versioned with the repository.
# Validated by @riaf/kernel schemas/governance.ts. Enforced by @riaf/govern through the Claude Code hooks (M5).
version: 1
phases:
  explore:   { soft_calls: 40, max_calls: 80,  soft_tokens: 120000, max_tokens: 250000, max_minutes: 30 }
  plan:      { soft_calls: 15, max_calls: 40,  soft_tokens: 60000,  max_tokens: 120000, max_minutes: 15 }
  implement: { soft_calls: 80, max_calls: 200, soft_tokens: 250000, max_tokens: 500000, max_minutes: 90 }
  verify:    { soft_calls: 30, max_calls: 80,  soft_tokens: 120000, max_tokens: 250000, max_minutes: 30 }
guard:
  serve_first_reads: false      # Claude Code's Edit needs a real Read first
  serve_repeat_reads: true      # identical re-reads of unchanged blobs come from the cache
  rewrite_grep_to_index: true   # PreToolUse: answer grep/glob from trigram + graph when cheaper
  loop_threshold: 3             # identical calls in a row before blocking
compaction:
  advise_at_ratio: 0.7          # of the model's context window
  keep: [plan, anchors, open_lookups, last_test_result]
`;

export const CONSTRAINTS_MD = `## Hard constraints
<!-- Hand-written rules the generated run-book always keeps verbatim. Keep it short. -->
- (add the rules every change in this repository must follow)

## Definition of done
- (tests, lint, review steps)
`;

/** Slash commands for Claude Code (`.claude/commands/*.md`). */
export const SLASH_COMMANDS: Record<string, string> = {
  'riaf-pack.md': `Compile a RIAF context pack for the task below before touching code.

Task: $ARGUMENTS

Steps: call \`riaf_pack\` with the task text (pass the active file, stack trace or failing tests when you have them). Read the pack header (intent, entropy, branch); if it asks a clarifying question, ask the user. Perform the suggested lookups before grepping or reading whole files; then plan.
`,
  'riaf-jump.md': 'Call `riaf_jump` for: $ARGUMENTS — then read only the lines it points at.\n',
  'riaf-impact.md': 'Before changing $ARGUMENTS, call `riaf_impact` on it and list the dependents and tests that must be updated or run.\n',
  'riaf-history.md': 'Call `riaf_history` for $ARGUMENTS and summarise why the code is the way it is (commits, reverts, incidents, ADRs) before proposing a change.\n',
};
