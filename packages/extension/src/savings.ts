/**
 * Cost-savings model for the console. Pure: no VS Code, no I/O, so the webview imports it too.
 *
 * Two kinds of number live here and are never mixed:
 *  - measured: frozen 30-task benchmark results from docs/eval/*.json (reproduce with `riaf eval`);
 *  - projected: arithmetic on top of those, driven by assumptions the user can see and change.
 */

/** One benchmarked way of getting an agent the context it needs for a task. */
export interface Condition {
  id: 'scripted' | 'claude' | 'riaf';
  label: string;
  /** What the condition is, in one line. */
  what: string;
  /** Mean tokens per task (context delivered, or the whole agent session for Claude Code). */
  tokens: number;
  /** Mean tool calls per task. */
  toolCalls: number;
  /** Share of gold files reached. */
  recall: number;
  /** Measured USD per task, when the run was paid. */
  usdPerTask?: number;
  source: string;
}

/** Frozen benchmark results (docs/eval/reference.json and claude-baseline.json, 2026-11-09, 30 tasks). */
export const BENCHMARKS: readonly Condition[] = [
  { id: 'scripted', label: 'Scripted explorer', what: 'grep, glob and read until the gold files are found, no RIAF', tokens: 2941, toolCalls: 11.47, recall: 0.868, source: 'docs/eval/reference.json' },
  { id: 'claude', label: 'Claude Code alone', what: 'headless Claude Code session per task, no RIAF attached', tokens: 245_956, toolCalls: 8.23, recall: 0.967, usdPerTask: 6.9922 / 30, source: 'docs/eval/claude-baseline.json' },
  { id: 'riaf', label: 'RIAF pack', what: 'one compiled context pack, one call', tokens: 1488, toolCalls: 1, recall: 0.971, source: 'docs/eval/reference.json' },
];

/** USD per million input tokens, for pricing the context itself (mirrors @riaf/models PRICES). */
export const INPUT_PRICES: readonly { model: string; usdPerM: number }[] = [
  { model: 'Claude Opus', usdPerM: 15 },
  { model: 'Claude Sonnet', usdPerM: 3 },
  { model: 'Claude Haiku', usdPerM: 1 },
  { model: 'GPT-4o', usdPerM: 2.5 },
];

export const bench = (id: Condition['id']): Condition => BENCHMARKS.find((b) => b.id === id)!;

/** Relative reduction from `base` to `next` (0.5 = halved); 0 when base is 0. */
export const reduction = (base: number, next: number): number => (base > 0 ? (base - next) / base : 0);

/** Share of exploration calls the pack replaced in the benchmark (scripted → RIAF): the upper bound for `replaced`. */
export const MEASURED_REPLACED = reduction(bench('scripted').toolCalls, bench('riaf').toolCalls);

export interface Assumptions {
  /** Share of the agent's exploration tool calls a pack replaces (0–1). */
  replaced: number;
  developers: number;
  tasksPerDay: number;
  workdays: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = { developers: 10, tasksPerDay: 6, workdays: 21, replaced: 0.5 };

export interface Projection {
  baselineTokens: number;
  riafTokens: number;
  baselineCalls: number;
  riafCalls: number;
  baselineUsd: number;
  riafUsd: number;
  tasksPerMonth: number;
  monthlyBaselineUsd: number;
  monthlyRiafUsd: number;
  monthlySavedUsd: number;
  monthlySavedTokens: number;
}

/**
 * Projects a Claude Code task with a RIAF pack attached. Each agent turn replays the session context,
 * so tokens scale with turns (1 + tool calls); replacing a share of the calls removes that share of turns,
 * and the pack's own tokens are added once.
 */
export function project(a: Assumptions, base: Condition = bench('claude'), pack: Condition = bench('riaf')): Projection {
  const replaced = Math.min(1, Math.max(0, a.replaced));
  const turns = 1 + base.toolCalls;
  const riafCalls = base.toolCalls * (1 - replaced) + pack.toolCalls;
  const riafTurns = 1 + base.toolCalls * (1 - replaced);
  const perTurn = base.tokens / turns;
  const riafTokens = perTurn * riafTurns + pack.tokens;
  const usdPerToken = (base.usdPerTask ?? 0) / base.tokens;
  const tasksPerMonth = Math.max(0, a.developers) * Math.max(0, a.tasksPerDay) * Math.max(0, a.workdays);
  const baselineUsd = base.usdPerTask ?? 0;
  const riafUsd = riafTokens * usdPerToken;
  return {
    baselineTokens: base.tokens, riafTokens, baselineCalls: base.toolCalls, riafCalls, baselineUsd, riafUsd, tasksPerMonth,
    monthlyBaselineUsd: baselineUsd * tasksPerMonth,
    monthlyRiafUsd: riafUsd * tasksPerMonth,
    monthlySavedUsd: (baselineUsd - riafUsd) * tasksPerMonth,
    monthlySavedTokens: (base.tokens - riafTokens) * tasksPerMonth,
  };
}

/** Cost of `tokens` of input context at each listed price. */
export const contextCost = (tokens: number) => INPUT_PRICES.map((p) => ({ model: p.model, usd: (tokens * p.usdPerM) / 1_000_000 }));

export interface LiveSavings {
  packs: number;
  governed: number;
  served: number;
  blocked: number;
  /** Exploration calls the packs stood in for, at the benchmark rate (estimate). */
  callsAvoidedEst: number;
}

/** Live counters from this repository's telemetry; only `callsAvoidedEst` is an estimate. */
export function live(t: { packs: number; toolCalls: { total: number; byDecision: Record<string, number> } }): LiveSavings {
  const by = t.toolCalls.byDecision;
  const served = (by['serve:index'] ?? 0) + (by['serve:cache'] ?? 0);
  const perPack = bench('scripted').toolCalls - bench('riaf').toolCalls;
  return { packs: t.packs, governed: t.toolCalls.total, served, blocked: by['block'] ?? 0, callsAvoidedEst: Math.round(t.packs * perPack) };
}
