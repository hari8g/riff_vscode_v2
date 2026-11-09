import type { ClassifyResult, CompleteResult, ModelMessage } from '@riaf/kernel';

/** Classification through a chat model: ask for a JSON distribution, parse it defensively. */

export function classifyMessages(text: string, labels: readonly string[]): ModelMessage[] {
  return [
    { role: 'system', content: `Classify the developer request into these labels: ${labels.join(', ')}. Reply with only a JSON object mapping every label to a probability; the probabilities sum to 1.` },
    { role: 'user', content: text },
  ];
}

/** Extracts a normalised distribution from model output; uniform when nothing parses. */
export function parseDistribution(out: string, labels: readonly string[]): Record<string, number> {
  const m = /\{[\s\S]*\}/.exec(out);
  let raw: Record<string, unknown> = {};
  if (m) {
    try {
      raw = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const vals = labels.map((l) => {
    const v = Number(raw[l]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const sum = vals.reduce((a, b) => a + b, 0);
  return Object.fromEntries(labels.map((l, i) => [l, sum > 0 ? vals[i]! / sum : 1 / labels.length]));
}

export function toClassifyResult(r: CompleteResult, labels: readonly string[]): ClassifyResult {
  return { distribution: parseDistribution(r.text, labels), model: r.model };
}
