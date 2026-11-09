import { describe, expect, it } from 'vitest';
import type { ComposedPolicy } from '@riaf/kernel';
import { dedupe, knapsack } from '../src/knapsack.js';
import type { Candidate } from '../src/candidates.js';

const policy = (variable: Record<string, number>, expansion: ComposedPolicy['expansion'] = []) => ({ budget: { total: 0, fixed: { map: 0, runbook: 0 }, variable }, expansion }) as unknown as ComposedPolicy;
// estimateTokens on prose: ~4.1 chars/token; 'x'.repeat(n) has no punctuation → n/4.1 rounded
const cand = (key: string, score: number, chars: number, extra: Partial<Candidate> = {}): Candidate => ({ key, tier: 2, kind: 'body', content: 'x'.repeat(chars), intent: 'bugfix', rule: 'anchor', weight: 1, score, stage: 0, bucket: 'ingredients', ...extra });

describe('knapsack', () => {
  it('matches a hand-computed selection: score order within bucket caps, sufficiency threshold, shared second pass', () => {
    // budget 100 tokens; buckets ingredients 60 / history 40
    const p = policy({ ingredients: 0.6, history: 0.4 });
    const cs = [
      cand('a', 1.0, 205),                                // 50 tokens → ingredients (left 10)
      cand('b', 0.9, 82),                                 // 20 tokens → does not fit ingredients; pass 2 shared
      cand('h', 0.8, 123, { bucket: 'history' }),         // 30 tokens → history (left 10)
      cand('c', 0.1, 41),                                 // below threshold 0.2 × 1.0 → never enters
    ];
    const r = knapsack(p, cs, { budget: 100 });
    expect(r.selected.map((s) => [s.candidate.key, s.tokens])).toEqual([['a', 50], ['h', 30], ['b', 20]]);
    expect(r.used).toBe(100);
    expect(r.overflow).toEqual([]);
  });

  it('degrades a body to its signature when only the signature fits, and respects rule caps', () => {
    const p = policy({ ingredients: 1 }, [{ rule: 'callers', cap: 0.2 }]);
    const big = cand('big', 1, 410, { fallback: { kind: 'signature', content: 'y'.repeat(41) } }); // 100 → 10 tokens
    const caller1 = cand('c1', 0.9, 62, { rule: 'callers' }); // 15 tokens, cap 0.2×60 = 12 → too big for the cap
    const r = knapsack(p, [big, caller1], { budget: 60 });
    expect(r.selected.map((s) => [s.candidate.key, s.kind, s.tokens])).toEqual([['big', 'signature', 10]]);
    expect(r.overflow.map((c) => c.key)).toEqual(['c1']);
  });

  it('dedupes by key keeping the best score and earliest stage', () => {
    const d = dedupe([cand('k', 0.5, 10, { stage: 1 }), cand('k', 0.7, 10, { stage: 0 })]);
    expect(d).toHaveLength(1);
    expect(d[0]!.score).toBe(0.7);
  });
});
