import { INTENTS, type Intent, type IntentVector } from '@riaf/kernel';
import type { Graph } from '@riaf/graph';
import type { Store } from '@riaf/store';
import { fixSum } from './classify.js';
import type { GroundResult } from './anchors.js';

/**
 * Cheap grounding probes for an uncertain reading: each candidate intent looks for evidence in the
 * index (an error string the code actually throws, an identifier that does not exist yet, a symbol
 * with many references, a question with no grounded code) and its weight is scaled by what it finds.
 */

export interface ProbeEvidence {
  intent: Intent;
  factor: number;
  why: string;
}

export function probe(store: Store, graph: Graph, text: string, w: IntentVector, grounding: GroundResult): { w: IntentVector; evidence: ProbeEvidence[] } {
  const evidence: ProbeEvidence[] = [];
  const quoted = [...text.matchAll(/"([^"]{4,80})"|'([^']{4,80})'/g)].map((m) => m[1] ?? m[2]!).filter(Boolean);
  const errorStringInCode = quoted.some((q) => store.trigram.search(q.replace(/\d+/g, '').trim().slice(0, 40), 3).length > 0);
  if (errorStringInCode) evidence.push({ intent: 'bugfix', factor: 1.8, why: 'a quoted message from the request occurs in the code' });
  const newNames = grounding.ungrounded.filter((u) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(u) && /[A-Z_]|[a-z][A-Z]/.test(u));
  if (newNames.length) evidence.push({ intent: 'feature', factor: 1.5, why: `names not in the index yet: ${newNames.slice(0, 3).join(', ')}` });
  const explicit = grounding.anchors.filter((a) => a.source === 'identifier' || a.source === 'path');
  if (explicit.length) {
    const view = graph.view();
    const refs = explicit.map((a) => {
      const i = view.idx(a.symbol);
      return i === undefined ? 0 : view.in[i]!.filter((e) => e.kind === 'invokes' || e.kind === 'references' || e.kind === 'defines_type').length;
    });
    if (Math.max(...refs) >= 3) evidence.push({ intent: 'refactor', factor: 1.3, why: 'the named symbol has many references' });
  } else if (/\?\s*$|^\s*(how|what|where|why)\b/i.test(text)) {
    evidence.push({ intent: 'onboarding', factor: 1.6, why: 'a question with no named code' });
  }
  if (evidence.length === 0) return { w, evidence };
  const out: Record<string, number> = {};
  let sum = 0;
  for (const i of INTENTS) {
    const f = evidence.filter((e) => e.intent === i).reduce((a, e) => a * e.factor, 1);
    out[i] = (w[i] ?? 0) * f;
    sum += out[i]!;
  }
  for (const i of INTENTS) out[i] = out[i]! / sum;
  return { w: fixSum(out as IntentVector), evidence };
}
