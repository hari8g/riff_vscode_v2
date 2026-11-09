import { INTENTS, type ClarifyQuestion, type Intent, type IntentVector } from '@riaf/kernel';
import { fixSum } from './classify.js';

const READING: Record<Intent, (subject: string) => string> = {
  bugfix: (s) => `fix a defect in ${s}`,
  feature: (s) => `add new behaviour to ${s}`,
  refactor: (s) => `restructure ${s} without changing behaviour`,
  review: (s) => `review recent changes to ${s}`,
  merge: (s) => `resolve a merge involving ${s}`,
  onboarding: (s) => `understand how ${s} works`,
  unknown: (s) => `look into ${s}`,
};

const oneHot = (intent: Intent): IntentVector => {
  const out: Record<string, number> = {};
  for (const i of INTENTS) out[i] = i === intent ? 0.94 : 0.01;
  return fixSum(out as IntentVector);
};

/** The one question with two readings, asked when the probe cannot settle an uncertain request. */
export function clarifyQuestion(w: IntentVector, subject: string): ClarifyQuestion {
  const top = INTENTS.filter((i) => i !== 'unknown').sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0)).slice(0, 2);
  return {
    question: `Should I ${READING[top[0]!](subject)} or ${READING[top[1]!](subject)}?`,
    options: top.map((i) => ({ label: READING[i](subject).replace(/^\w/, (c) => c.toUpperCase()), intent: i, w: oneHot(i) })),
  };
}
