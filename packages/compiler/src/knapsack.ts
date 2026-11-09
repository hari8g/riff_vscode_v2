import type { ComposedPolicy } from '@riaf/kernel';
import { tokensOf, type Candidate } from './candidates.js';

/**
 * Fills the variable budget greedily by score per token. Each item is charged to its bucket (the
 * composed policy's renormalised shares) and to its rule (cap-before-blend); unused bucket budget
 * flows to a shared pool in a second pass. Items under the sufficiency threshold (a share of the best
 * score) never enter, so a small task gets a small pack. A body that does not fit degrades to its
 * signature.
 */

export interface Selected {
  candidate: Candidate;
  content: string;
  kind: Candidate['kind'];
  endLine?: number;
  tokens: number;
}

export interface KnapsackOptions {
  /** Tokens available for the variable part. */
  budget: number;
  /** Relative score below which candidates are dropped (sufficiency stop). */
  threshold?: number;
  /** Absolute cap on items (keeps renders readable). */
  maxItems?: number;
}

export interface KnapsackResult {
  selected: Selected[];
  /** Candidates that scored above the threshold but did not fit (for open lookups). */
  overflow: Candidate[];
  used: number;
}

/** Deduplicates candidates by key (keeping the best score) and drops ranges covered by a larger item. */
export function dedupe(cands: readonly Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = byKey.get(c.key);
    if (!prev || c.score > prev.score) byKey.set(c.key, prev ? { ...c, stage: Math.min(prev.stage, c.stage) } : c);
  }
  return [...byKey.values()];
}

/** True when `outer` already shows `inner`'s lines in full. */
function covers(outer: Selected, inner: Candidate): boolean {
  const o = outer.candidate;
  return o.path !== undefined && o.path === inner.path && outer.kind !== 'signature' && o.startLine !== undefined && inner.startLine !== undefined
    && o.startLine <= inner.startLine && (outer.endLine ?? o.endLine ?? 0) >= (inner.endLine ?? inner.startLine);
}

export function knapsack(policy: ComposedPolicy, cands: readonly Candidate[], opts: KnapsackOptions): KnapsackResult {
  const pool = dedupe(cands).sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const best = pool[0]?.score ?? 0;
  const threshold = (opts.threshold ?? 0.2) * best;
  const shares = policy.budget.variable;
  const bucketLeft = new Map<string, number>(Object.entries(shares).map(([k, v]) => [k, Math.floor(v * opts.budget)]));
  const ruleCap = new Map<string, number>();
  for (const r of policy.expansion) if (r.cap !== undefined) ruleCap.set(r.rule, Math.floor(r.cap * opts.budget));
  const ruleUsed = new Map<string, number>();
  const selected: Selected[] = [];
  const overflow: Candidate[] = [];
  let used = 0;
  const maxItems = opts.maxItems ?? 60;

  const tryTake = (c: Candidate, fromShared: boolean): boolean => {
    if (selected.some((s) => covers(s, c))) return true; // already visible in a larger item
    const options = [{ kind: c.kind, content: c.content, endLine: c.endLine }, ...(c.fallback ? [{ kind: c.fallback.kind, content: c.fallback.content, endLine: c.fallback.endLine ?? c.endLine }] : [])];
    for (const o of options) {
      const t = tokensOf(o.content);
      if (used + t > opts.budget) continue;
      const cap = ruleCap.get(c.rule);
      if (cap !== undefined && (ruleUsed.get(c.rule) ?? 0) + t > cap) continue;
      const left = bucketLeft.get(c.bucket) ?? 0;
      if (!fromShared && t > left) continue;
      if (!fromShared) bucketLeft.set(c.bucket, left - t);
      ruleUsed.set(c.rule, (ruleUsed.get(c.rule) ?? 0) + t);
      used += t;
      const taken: Selected = { candidate: c, content: o.content, kind: o.kind, ...(o.endLine !== undefined ? { endLine: o.endLine } : {}), tokens: t };
      // a larger item makes earlier, smaller items it fully shows redundant: drop them and refund
      for (let k = selected.length - 1; k >= 0; k--) {
        const prev = selected[k]!;
        if (covers(taken, prev.candidate) && prev.candidate.key !== c.key) {
          selected.splice(k, 1);
          used -= prev.tokens;
          ruleUsed.set(prev.candidate.rule, (ruleUsed.get(prev.candidate.rule) ?? 0) - prev.tokens);
          bucketLeft.set(prev.candidate.bucket, (bucketLeft.get(prev.candidate.bucket) ?? 0) + prev.tokens);
        }
      }
      selected.push(taken);
      return true;
    }
    return false;
  };

  const eligible = pool.filter((c) => c.score >= threshold);
  // pass 1: within buckets, by value density (score per token, with a floor so tiny items do not dominate)
  const density = (c: Candidate) => c.score / Math.max(40, tokensOf(c.content));
  const pending: Candidate[] = [];
  for (const c of [...eligible].sort((a, b) => b.score - a.score || density(b) - density(a))) {
    if (selected.length >= maxItems) break;
    if (!tryTake(c, false)) pending.push(c);
  }
  // pass 2: leftover budget from under-used buckets is shared
  for (const c of pending) {
    if (selected.length >= maxItems) break;
    if (!tryTake(c, true)) overflow.push(c);
  }
  return { selected, overflow, used };
}
