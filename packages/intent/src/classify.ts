import { INTENTS, type IdeState, type Intent, type IntentVector, type ModelPort } from '@riaf/kernel';
import { lexiconLogits } from './lexicon.js';

/**
 * Turns lexicon logits plus IDE evidence into a calibrated intent distribution. A stack trace or a
 * failing test is strong bugfix evidence; a diff without other cues leans review; a caller's hint
 * (slash command) is a strong prior, not a verdict.
 */

export interface ClassifyInput {
  text: string;
  ide?: Partial<IdeState>;
  hint?: Intent;
  /** Softmax temperature; calibrated on the eval task set. */
  temperature?: number;
}

/** Softmax over intents in canonical order; every intent gets a non-zero weight. */
export function softmax(logits: Record<Intent, number>, temperature = 1): IntentVector {
  const max = Math.max(...INTENTS.map((i) => logits[i]));
  const exps = INTENTS.map((i) => Math.exp((logits[i] - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  INTENTS.forEach((i, k) => (out[i] = exps[k]! / sum));
  return fixSum(out as IntentVector);
}

/** Rounds to 6 decimals and puts any residue on the largest entry so the vector sums to 1 exactly. */
export function fixSum(w: IntentVector): IntentVector {
  const out: Record<string, number> = {};
  let sum = 0;
  let top: Intent = 'unknown';
  for (const i of INTENTS) {
    const v = Math.round((w[i] ?? 0) * 1e6) / 1e6;
    out[i] = v;
    sum += v;
    if (v > (out[top] ?? -1)) top = i;
  }
  out[top] = Math.round((out[top]! + (1 - sum)) * 1e6) / 1e6;
  return out as IntentVector;
}

/** Calibrated on the eval task set: one clear cue lands in `single`, two competing cues in `blended`. */
export const DEFAULT_TEMPERATURE = 0.6;

/** Lexicon + IDE-signal classifier. */
export function classify(input: ClassifyInput): IntentVector {
  const logits = lexiconLogits(input.text);
  const ide = input.ide ?? {};
  if (ide.stackTrace) logits.bugfix += 2.5;
  if (ide.failingTests && ide.failingTests.length) logits.bugfix += 2;
  if (ide.diffFiles && ide.diffFiles.length && logits.feature + logits.bugfix + logits.refactor < 2) logits.review += 1.5;
  if (input.hint) logits[input.hint] += 3;
  return softmax(logits, input.temperature ?? DEFAULT_TEMPERATURE);
}

/** Blends the lexicon distribution with a model arbiter's (`ModelPort.classify`), 50/50 by default. */
export async function arbitrate(w: IntentVector, text: string, model: ModelPort, share = 0.5, signal?: AbortSignal): Promise<IntentVector> {
  const r = await model.classify(text, { labels: INTENTS, ...(signal ? { signal } : {}) });
  const out: Record<string, number> = {};
  for (const i of INTENTS) out[i] = (1 - share) * (w[i] ?? 0) + share * (r.distribution[i] ?? 0);
  return fixSum(out as IntentVector);
}

/** Multiplies per-repo priors in (w_i ∝ w_i · prior_i^alpha) and renormalises. */
export function applyPriors(w: IntentVector, priors: Partial<Record<Intent, number>> | undefined, alpha = 0.5): IntentVector {
  if (!priors) return w;
  const out: Record<string, number> = {};
  let sum = 0;
  for (const i of INTENTS) {
    const p = Math.max(1e-3, priors[i] ?? 1 / INTENTS.length) * INTENTS.length;
    out[i] = (w[i] ?? 0) * p ** alpha;
    sum += out[i]!;
  }
  for (const i of INTENTS) out[i] = out[i]! / sum;
  return fixSum(out as IntentVector);
}

/** The intent with the largest weight. */
export function topIntent(w: IntentVector): Intent {
  let best: Intent = 'unknown';
  for (const i of INTENTS) if ((w[i] ?? 0) > (w[best] ?? 0)) best = i;
  return best;
}
