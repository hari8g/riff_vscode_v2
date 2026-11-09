import type { GovernanceFile, ToolCall } from '@riaf/kernel';

/**
 * Per-phase budgets from governance.yaml: past a soft limit the agent is asked to reflect (once per
 * limit), past a hard limit further calls in that phase are blocked.
 */

export type Phase = ToolCall['phase'];

export interface BudgetState {
  calls: Record<Phase, number>;
  tokens: Record<Phase, number>;
  startedAt: number;
  warned: Set<string>;
}

export const newBudgetState = (now: number): BudgetState => ({
  calls: { explore: 0, plan: 0, implement: 0, verify: 0 },
  tokens: { explore: 0, plan: 0, implement: 0, verify: 0 },
  startedAt: now,
  warned: new Set(),
});

export type BudgetVerdict = { level: 'ok' } | { level: 'soft'; message: string } | { level: 'hard'; message: string };

/** Checks one more call in `phase` against the limits (does not record it). */
export function checkBudget(g: GovernanceFile, s: BudgetState, phase: Phase, now: number): BudgetVerdict {
  const lim = g.phases[phase];
  if (!lim) return { level: 'ok' };
  const calls = s.calls[phase] + 1;
  const minutes = (now - s.startedAt) / 60_000;
  if (calls > lim.max_calls) return { level: 'hard', message: `${phase} phase hit its hard limit of ${lim.max_calls} tool calls. Stop exploring: summarise what you know, state the plan, or ask the user.` };
  if (s.tokens[phase] > lim.max_tokens) return { level: 'hard', message: `${phase} phase used more than ${lim.max_tokens} tokens of tool output. Compact or move to the next phase.` };
  if (minutes > lim.max_minutes && !s.warned.has(`${phase}:minutes`)) {
    s.warned.add(`${phase}:minutes`);
    return { level: 'soft', message: `${phase} phase has run ${Math.round(minutes)} minutes (limit ${lim.max_minutes}). Check whether you are still converging.` };
  }
  if (calls > lim.soft_calls && !s.warned.has(`${phase}:calls`)) {
    s.warned.add(`${phase}:calls`);
    return { level: 'soft', message: `${calls} tool calls in the ${phase} phase (soft limit ${lim.soft_calls}). Before the next search: what do you still need, and is it in the RIAF pack's suggested lookups?` };
  }
  if (s.tokens[phase] > lim.soft_tokens && !s.warned.has(`${phase}:tokens`)) {
    s.warned.add(`${phase}:tokens`);
    return { level: 'soft', message: `the ${phase} phase has pulled ${s.tokens[phase]} tokens of tool output (soft limit ${lim.soft_tokens}). Prefer riaf_jump and targeted reads over whole files.` };
  }
  return { level: 'ok' };
}
