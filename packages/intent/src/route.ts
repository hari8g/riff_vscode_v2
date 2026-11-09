import { RouteRequestSchema, type ComposedPolicy, type Intent, type IntentVector, type ModelPort, type PoliciesFile, type RouteBranch, type RouteRequest, type TaskUnit } from '@riaf/kernel';
import type { Graph } from '@riaf/graph';
import type { Store } from '@riaf/store';
import { groundAnchors, type GroundedAnchor } from './anchors.js';
import { applyPriors, arbitrate, classify, topIntent } from './classify.js';
import { clarifyQuestion } from './clarify.js';
import { aggregate, compose } from './compose.js';
import { decompose } from './decompose.js';
import { DEFAULT_POLICIES } from './defaults.js';
import { gate, normalizedEntropy } from './entropy.js';
import { probe, type ProbeEvidence } from './probe.js';

/**
 * route(request, ideState, policies) → ComposedPolicy: decompose → ground anchors → classify →
 * priors → entropy gate → (probe → clarify | generic) → compose. Deterministic without a model; a
 * ModelPort arbiter is consulted only for uncertain units.
 */

export interface RouteDeps {
  store: Store;
  graph: Graph;
  policies?: PoliciesFile;
  policyVersion?: string;
  /** Per-repo priors from telemetry (M5); uniform when absent. */
  priors?: Partial<Record<Intent, number>>;
  /** Optional classifier arbiter for uncertain units. */
  arbiter?: ModelPort;
}

export interface RouteDiagnostics {
  anchors: GroundedAnchor[];
  probe: ProbeEvidence[];
  /** Branch the gate chose before probing (equals the final branch when no probe ran). */
  gateBranch: RouteBranch;
}

export interface RouteResult {
  policy: ComposedPolicy;
  diagnostics: RouteDiagnostics;
}

/** Routes one request. */
export async function route(request: RouteRequest | (Omit<RouteRequest, 'ide'> & { ide?: Partial<RouteRequest['ide']> }), deps: RouteDeps): Promise<RouteResult> {
  const req = RouteRequestSchema.parse(request);
  const policies = deps.policies ?? DEFAULT_POLICIES;
  const router = policies.router;
  const raw = decompose(req.text);
  const units: TaskUnit[] = [];
  const allAnchors = new Map<string, GroundedAnchor>();
  const allUngrounded: string[] = [];
  for (const [k, u] of raw.entries()) {
    // IDE evidence belongs to the first unit (where the user is looking) and to single-unit requests
    const ide = k === 0 ? req.ide : { ...req.ide, stackTrace: undefined, failingTests: [], selection: undefined };
    const g = groundAnchors(deps.store, u.text, ide);
    for (const a of g.anchors) {
      const prev = allAnchors.get(a.symbol);
      if (!prev || prev.confidence < a.confidence) allAnchors.set(a.symbol, a);
    }
    allUngrounded.push(...g.ungrounded);
    let w = classify({ text: u.text, ide, ...(req.intentHint ? { hint: req.intentHint } : {}) });
    w = applyPriors(w, deps.priors);
    if (deps.arbiter && normalizedEntropy(w) >= router.entropy.single_below) {
      try {
        w = await arbitrate(w, u.text, deps.arbiter);
      } catch {
        // the arbiter is advisory; the lexicon reading stands
      }
    }
    units.push({ id: u.id, text: u.text, anchors: g.anchors.map((a) => a.symbol), ungrounded: g.ungrounded, w, H: normalizedEntropy(w), dependsOn: u.dependsOn });
  }
  let w: IntentVector = aggregate(units);
  let H = normalizedEntropy(w);
  const gateBranch: RouteBranch = units.length > 1 && units.every((u) => gate(u.w, u.H, router) === 'single') && new Set(units.map((u) => topIntent(u.w))).size > 1 ? 'blended' : gate(w, H, router);
  let branch: RouteBranch = gateBranch;
  let evidence: ProbeEvidence[] = [];
  let question: ComposedPolicy['question'] = null;
  if (branch === 'probe') {
    const p = probe(deps.store, deps.graph, req.text, w, { anchors: [...allAnchors.values()], ungrounded: allUngrounded });
    evidence = p.evidence;
    w = p.w;
    H = normalizedEntropy(w);
    const after = gate(w, H, router);
    if (after !== 'probe') branch = after;
    else if (req.ide.interactive && router.clarify_max_questions > 0) {
      branch = 'clarify';
      const subject = [...allAnchors.values()][0]?.mention ?? [...allAnchors.values()][0]?.symbol.split('#')[1]?.split('@')[0] ?? 'this code';
      question = clarifyQuestion(w, subject || 'this code');
    } else branch = 'generic';
    // keep the units consistent with the probed aggregate for single-unit requests
    if (units.length === 1) units[0] = { ...units[0]!, w, H };
  }
  const anchors = [...allAnchors.values()].sort((a, b) => b.confidence - a.confidence).map((a) => a.symbol);
  const policy = compose({ units, w, H, branch, anchors, question, policies, policyVersion: deps.policyVersion ?? 'builtin@1', ...(req.budget ? { budget: req.budget } : {}) });
  return { policy, diagnostics: { anchors: [...allAnchors.values()], probe: evidence, gateBranch } };
}
