import { INTENTS, type IntentVector, type PoliciesFile, type RouteBranch } from '@riaf/kernel';
import { topIntent } from './classify.js';

/** Normalised Shannon entropy of the intent vector, in [0, 1] (1 = uniform over all seven intents). */
export function normalizedEntropy(w: IntentVector): number {
  let h = 0;
  for (const i of INTENTS) {
    const p = w[i] ?? 0;
    if (p > 0) h -= p * Math.log(p);
  }
  return Math.min(1, Math.max(0, h / Math.log(INTENTS.length)));
}

/** The entropy gate (ADR-0003): single, blended, or probe when the reading is too uncertain. */
export function gate(w: IntentVector, H: number, router: PoliciesFile['router']): Extract<RouteBranch, 'single' | 'blended' | 'probe'> {
  const top = w[topIntent(w)] ?? 0;
  if (H < router.entropy.single_below && top >= router.top_intent_min) return 'single';
  if (H < router.entropy.blend_below) return 'blended';
  return 'probe';
}
