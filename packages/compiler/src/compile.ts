import { hashWith, PackSchema, RiafError, shortHash, type ComposedPolicy, type OpenLookup, type Pack, type PackItem, type SymbolId, type TokenModelFamily } from '@riaf/kernel';
import { personalizedPageRank } from '@riaf/graph';
import { hashOf, SourceCache, tokensOf, type Candidate } from './candidates.js';
import { expand } from './expand.js';
import { knapsack } from './knapsack.js';
import type { RepoView } from './view.js';

/**
 * compile(composedPolicy, repoView) → Pack. Fixed parts first (an elastic repo map, the run-book when
 * the target lacks it), then sufficiency expansion and the knapsack over the variable budget, then
 * ordering by tier and stage, open lookups for what did not fit, and schema validation.
 */

export interface CompileOptions {
  /** Overrides the policy's total budget. */
  budget?: number;
  /** Include the run-book item (targets without CLAUDE.md / AGENTS.md). Default false. */
  includeRunbook?: boolean;
  /** Relative score threshold for the sufficiency stop. */
  threshold?: number;
  now?: Date;
  family?: TokenModelFamily;
  sessionId?: string;
}

/** Share of the fixed map budget used per branch: precise requests need less orientation. */
export const MAP_SHARE: Record<ComposedPolicy['branch'], number> = { single: 0.3, blended: 0.5, probe: 0.6, clarify: 0.8, generic: 1 };

export function compile(policy: ComposedPolicy, view: RepoView, opts: CompileOptions = {}): Pack {
  const total = opts.budget ?? policy.budget.total;
  if (total <= 0) throw new RiafError('invalid_input', 'budget must be positive');
  const now = opts.now ?? new Date();
  const src = new SourceCache(view);
  const graphView = view.graph.view();
  const anchors = policy.anchors as SymbolId[];
  const ppr = personalizedPageRank(graphView, anchors);
  let pmax = 0;
  for (const v of ppr) pmax = Math.max(pmax, v);
  const pprOf = (id: SymbolId) => {
    const i = graphView.idx(id);
    return i === undefined || pmax === 0 ? 0 : ppr[i]! / pmax;
  };

  const items: { c: Candidate; kind: PackItem['kind']; content: string; endLine?: number; tokens: number }[] = [];
  let used = 0;
  // tier 1: repo map, elastic by branch and never more than the fixed allowance
  const onboarding = policy.primitives.some((p) => p.intent === 'onboarding' && p.weight >= 0.3);
  const mapBudget = Math.min(policy.budget.fixed.map, Math.floor(total * 0.25), Math.floor(policy.budget.fixed.map * (onboarding ? 1 : MAP_SHARE[policy.branch])));
  if (mapBudget >= 60) {
    const map = view.graph.repoMap(anchors, { budget: mapBudget, scores: ppr });
    if (map.text) {
      const c: Candidate = { key: 'map', tier: 1, kind: 'summary', virtual: 'repo-map', content: map.text, intent: policy.primitives[0]!.intent, rule: 'repo_map', weight: policy.primitives[0]!.weight, score: 1, stage: 0, bucket: 'fixed' };
      items.push({ c, kind: 'summary', content: map.text, tokens: map.tokens });
      used += map.tokens;
    }
  }
  // tier 4: run-book for targets that do not load CLAUDE.md / AGENTS.md themselves
  if (opts.includeRunbook) {
    const rb = view.semantic.runbook(view.constraints);
    const t = tokensOf(rb);
    if (t <= policy.budget.fixed.runbook && used + t <= total) {
      items.push({ c: { key: 'runbook', tier: 4, kind: 'runbook', virtual: 'runbook', content: rb, intent: policy.primitives[0]!.intent, rule: 'runbook', weight: 1, score: 1, stage: 0, bucket: 'fixed' }, kind: 'runbook', content: rb, tokens: t });
      used += t;
    }
  }
  // variable part
  const candidates: Candidate[] = [];
  const lookups: OpenLookup[] = [];
  expand({ view, src, policy, ppr: pprOf, candidates, lookups });
  const ks = knapsack(policy, candidates, { budget: Math.max(0, total - used), ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}) });
  for (const s of ks.selected) items.push({ c: s.candidate, kind: s.kind, content: s.content, ...(s.endLine !== undefined ? { endLine: s.endLine } : {}), tokens: s.tokens });
  used += ks.used;

  // open lookups: ungrounded mentions, then the best candidates that did not fit
  for (const u of policy.units) for (const name of u.ungrounded.slice(0, 2)) lookups.push({ tool: 'riaf_jump', args: { query: name }, reason: `“${name}” is not in the index — new code or a different name?` });
  for (const c of ks.overflow.slice(0, 3)) {
    if (c.path && c.startLine !== undefined) lookups.push({ tool: 'Read', args: { file_path: c.path, offset: c.startLine, limit: (c.endLine ?? c.startLine) - c.startLine + 1 }, reason: `${c.rule} candidate did not fit the budget (score ${c.score.toFixed(2)})` });
  }

  const ordered = items.sort((a, b) => a.c.tier - b.c.tier || a.c.stage - b.c.stage || b.c.score - a.c.score || (a.c.key < b.c.key ? -1 : 1));
  const packItems: PackItem[] = ordered.map((it, i) => {
    const c = it.c;
    const source: PackItem['source'] = c.path
      ? { path: c.path, ...(c.startLine !== undefined ? { range: { startLine: c.startLine, endLine: Math.max(c.startLine, it.endLine ?? c.endLine ?? c.startLine) } } : {}) }
      : c.commit ? { commit: c.commit } : { virtual: c.virtual ?? c.key };
    return {
      id: `i${i + 1}`, tier: c.tier, kind: it.kind, source, hash: hashOf(it.content),
      why: { intent: c.intent, rule: c.rule, weight: Math.min(1, Math.max(0, Math.round(c.weight * 1e4) / 1e4)), score: Math.round(c.score * 1e4) / 1e4 },
      tokens: it.tokens, stage: c.stage, content: it.content,
    };
  });
  const tokensUsed = packItems.reduce((a, i) => a + i.tokens, 0);
  const packId = `pk-${shortHash(hashWith('pack', JSON.stringify(policy), now.toISOString(), String(total)), 12)}`;
  const pack: Pack = {
    packId, repo: view.repoName, ...(view.commit ? { commit: view.commit } : {}),
    route: { w: policy.w, H: policy.H, branch: policy.branch, stages: policy.stages, ...(policy.question ? { question: policy.question.question } : {}) },
    budget: total, tokensUsed, openLookups: dedupeLookups(lookups).slice(0, 6), items: packItems,
    policyVersion: policy.policyVersion, schemaVersion: 1, createdAt: now.toISOString(),
  };
  const v = PackSchema.safeParse(pack);
  if (!v.success) throw new RiafError('internal', `compiled pack violates the contract: ${v.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return pack;
}

function dedupeLookups(ls: readonly OpenLookup[]): OpenLookup[] {
  const seen = new Set<string>();
  return ls.filter((l) => {
    const k = `${l.tool}:${JSON.stringify(l.args)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
