import type { CompleteResult } from '@riaf/kernel';

/** USD per million tokens (input, output, cached input), by model id prefix. Update as prices change. */
export const PRICES: readonly { prefix: string; input: number; output: number; cachedInput: number }[] = [
  { prefix: 'claude-opus', input: 15, output: 75, cachedInput: 1.5 },
  { prefix: 'claude-sonnet', input: 3, output: 15, cachedInput: 0.3 },
  { prefix: 'claude-haiku', input: 1, output: 5, cachedInput: 0.1 },
  { prefix: 'gpt-4o-mini', input: 0.15, output: 0.6, cachedInput: 0.075 },
  { prefix: 'gpt-4o', input: 2.5, output: 10, cachedInput: 1.25 },
];

/** Cost of one completion in USD; local models (no matching price) cost 0. */
export function costUsd(r: Pick<CompleteResult, 'usage' | 'model'>): number {
  const p = PRICES.find((x) => r.model.startsWith(x.prefix) || r.model.includes(`:${x.prefix}`));
  if (!p) return 0;
  const cached = r.usage.cachedInputTokens ?? 0;
  return ((r.usage.inputTokens - cached) * p.input + cached * p.cachedInput + r.usage.outputTokens * p.output) / 1_000_000;
}
