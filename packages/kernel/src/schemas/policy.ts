import { z } from 'zod';
import { IntentSchema, IntentVectorSchema, SymbolIdSchema } from './common.js';
import { TaskUnitSchema, RouteBranchSchema, ClarifyQuestionSchema } from './intent.js';

/** Expansion rules the compiler knows how to execute along the graph. */
export const EXPANSION_RULES = [
  'callers', 'callees', 'exercising_test', 'sibling_template', 'implemented_interfaces',
  'both_branch_touched', 'co_change_partners', 'tests_over', 'invariants_on',
  'reference_closure', 'inheritance_tree', 'dynamic_dispatch_sites',
  'module_summaries', 'file_skeletons', 'one_hop',
] as const;
export const ExpansionRuleSchema = z.object({
  rule: z.enum(EXPANSION_RULES),
  hops: z.number().int().min(1).max(4).optional(),
  /** Share of the variable budget this rule may consume at most (0,1]. */
  cap: z.number().gt(0).max(1).optional(),
  exclude: z.enum(['in_diff', 'tests', 'generated']).optional(),
});
export type ExpansionRule = z.infer<typeof ExpansionRuleSchema>;

export const ANCHOR_SOURCES = [
  'stack_trace', 'issue_terms', 'failing_test', 'selection', 'sibling_feature', 'extension_points',
  'conflict_hunks', 'diff_symbols', 'target_symbols', 'architecture_nodes', 'grounded_identifiers',
] as const;
export const HISTORY_SCOPES = [
  'blame_on_anchors', 'reverts_touching_anchors', 'origin_commits_of_sibling', 'both_branch_summaries',
  'recent_incidents_on', 'adrs',
] as const;

export const PrimitivePolicySchema = z.object({
  anchors: z.array(z.enum(ANCHOR_SOURCES)).min(1),
  expansion: z.array(ExpansionRuleSchema).min(1),
  history: z.array(z.enum(HISTORY_SCOPES)),
  /** Named shares of the variable budget; must sum to 1. */
  weights: z.record(z.string(), z.number().min(0).max(1)).refine(
    (w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-6,
    'weights must sum to 1',
  ),
});
export type PrimitivePolicy = z.infer<typeof PrimitivePolicySchema>;

/** Shape of `.riaf/policies.yaml`. */
export const PoliciesFileSchema = z.object({
  version: z.literal(1),
  router: z.object({
    entropy: z.object({
      single_below: z.number().min(0).max(1),
      blend_below: z.number().min(0).max(1),
    }).refine((e) => e.single_below < e.blend_below, 'single_below < blend_below'),
    top_intent_min: z.number().min(0).max(1),
    blend_floor: z.number().min(0).max(1),
    clarify_max_questions: z.number().int().min(0).max(3),
  }),
  budget: z.object({
    default_total: z.number().int().positive(),
    fixed: z.object({ map: z.number().int().nonnegative(), runbook: z.number().int().nonnegative() }),
  }),
  primitives: z.record(IntentSchema, PrimitivePolicySchema).refine(
    (p) => Object.keys(p).length === 7,
    'all seven primitive intents must be defined',
  ),
});
export type PoliciesFile = z.infer<typeof PoliciesFileSchema>;

/** Output of @riaf/intent, input of @riaf/compiler. */
export const ComposedPolicySchema = z.object({
  units: z.array(TaskUnitSchema).min(1),
  branch: RouteBranchSchema,
  /** Aggregate intent vector across units, weighted by unit size. */
  w: IntentVectorSchema,
  H: z.number().min(0).max(1),
  primitives: z.array(z.object({ intent: IntentSchema, weight: z.number().gt(0).max(1) })).min(1),
  anchors: z.array(SymbolIdSchema),
  expansion: z.array(ExpansionRuleSchema),
  historyScope: z.array(z.enum(HISTORY_SCOPES)),
  budget: z.object({
    total: z.number().int().positive(),
    fixed: z.object({ map: z.number().int().nonnegative(), runbook: z.number().int().nonnegative() }),
    /** Renormalised shares of the variable budget by named bucket. */
    variable: z.record(z.string(), z.number().min(0).max(1)),
  }),
  /** Ordered stages; each stage lists unit ids compiled together. */
  stages: z.array(z.array(z.string().min(1)).min(1)).min(1),
  question: ClarifyQuestionSchema.nullable(),
  policyVersion: z.string().min(1),
});
export type ComposedPolicy = z.infer<typeof ComposedPolicySchema>;
