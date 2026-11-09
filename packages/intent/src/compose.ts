import { INTENTS, type ComposedPolicy, type ExpansionRule, type HISTORY_SCOPES, type Intent, type IntentVector, type PoliciesFile, type RouteBranch, type TaskUnit } from '@riaf/kernel';
import { fixSum, topIntent } from './classify.js';

/**
 * The policy composer: blends the primitive policies of the intents that matter into one
 * ComposedPolicy — p-floor on weights, cap-before-blend on expansion rules, union of history scopes,
 * renormalised budget buckets, and stages ordered by unit dependencies.
 */

/** Aggregate intent vector across units, weighted by unit length. */
export function aggregate(units: readonly Pick<TaskUnit, 'text' | 'w'>[]): IntentVector {
  const out: Record<string, number> = {};
  const total = units.reduce((a, u) => a + Math.max(1, u.text.length), 0);
  for (const i of INTENTS) out[i] = units.reduce((a, u) => a + (u.w[i] ?? 0) * Math.max(1, u.text.length), 0) / total;
  return fixSum(out as IntentVector);
}

/** Primitive weights after the p-floor; `unknown` only contributes when nothing else does. */
export function primitives(w: IntentVector, branch: RouteBranch, floor: number): { intent: Intent; weight: number }[] {
  if (branch === 'generic' || branch === 'clarify') return [{ intent: 'unknown', weight: 1 }];
  if (branch === 'single') return [{ intent: topIntent(w), weight: 1 }];
  let kept = INTENTS.filter((i) => i !== 'unknown' && (w[i] ?? 0) >= floor).map((i) => ({ intent: i, weight: w[i] ?? 0 }));
  if (kept.length === 0) kept = [{ intent: topIntent(w), weight: 1 }];
  const sum = kept.reduce((a, k) => a + k.weight, 0);
  return kept.map((k) => ({ intent: k.intent, weight: Math.round((k.weight / sum) * 1e6) / 1e6 })).sort((a, b) => b.weight - a.weight);
}

/** Topological layering of units by dependsOn: each stage holds units whose dependencies are done. */
export function stagesOf(units: readonly Pick<TaskUnit, 'id' | 'dependsOn'>[]): string[][] {
  const done = new Set<string>();
  const stages: string[][] = [];
  let remaining = [...units];
  while (remaining.length) {
    const ready = remaining.filter((u) => u.dependsOn.every((d) => done.has(d) || !units.some((x) => x.id === d)));
    const layer = ready.length ? ready : [remaining[0]!]; // break cycles deterministically
    stages.push(layer.map((u) => u.id));
    for (const u of layer) done.add(u.id);
    remaining = remaining.filter((u) => !done.has(u.id));
  }
  return stages;
}

export interface ComposeInput {
  units: TaskUnit[];
  w: IntentVector;
  H: number;
  branch: RouteBranch;
  anchors: ComposedPolicy['anchors'];
  question: ComposedPolicy['question'];
  policies: PoliciesFile;
  policyVersion: string;
  budget?: number;
}

/** Blends primitive policies into the ComposedPolicy the compiler executes. */
export function compose(input: ComposeInput): ComposedPolicy {
  const { policies } = input;
  const prims = primitives(input.w, input.branch, policies.router.blend_floor);
  // cap-before-blend: a rule's cap is scaled by its primitive's weight; duplicates keep the largest
  const rules = new Map<string, ExpansionRule>();
  for (const p of prims) {
    for (const r of policies.primitives[p.intent]!.expansion) {
      const key = `${r.rule}:${r.exclude ?? ''}`;
      const cap = Math.min(1, (r.cap ?? 1) * (input.branch === 'single' ? 1 : p.weight));
      const prev = rules.get(key);
      const next: ExpansionRule = { rule: r.rule, ...(r.hops !== undefined ? { hops: r.hops } : {}), cap: Math.round(cap * 1e4) / 1e4, ...(r.exclude ? { exclude: r.exclude } : {}) };
      if (!prev) rules.set(key, next);
      else rules.set(key, { ...prev, hops: Math.max(prev.hops ?? 1, next.hops ?? 1), cap: Math.min(1, Math.round(((prev.cap ?? 0) + (next.cap ?? 0)) * 1e4) / 1e4) });
    }
  }
  const history = new Set<(typeof HISTORY_SCOPES)[number]>();
  for (const p of prims) for (const h of policies.primitives[p.intent]!.history) history.add(h);
  const variable: Record<string, number> = {};
  for (const p of prims) for (const [bucket, share] of Object.entries(policies.primitives[p.intent]!.weights)) variable[bucket] = (variable[bucket] ?? 0) + share * p.weight;
  const vsum = Object.values(variable).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(variable)) variable[k] = Math.round((variable[k]! / vsum) * 1e6) / 1e6;
  return {
    units: input.units,
    branch: input.branch,
    w: input.w,
    H: Math.round(input.H * 1e6) / 1e6,
    primitives: prims,
    anchors: input.anchors,
    expansion: [...rules.values()],
    historyScope: [...history],
    budget: { total: input.budget ?? policies.budget.default_total, fixed: { ...policies.budget.fixed }, variable },
    stages: stagesOf(input.units),
    question: input.question,
    policyVersion: input.policyVersion,
  };
}
