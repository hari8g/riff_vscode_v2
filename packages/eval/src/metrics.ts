import type { Task } from './tasks.js';
import type { TaskResult } from './runners/types.js';

/** Metrics over task results: recall, tokens, tool calls, pass rate, branches, clarification. */

/** Share of gold files the run looked at. */
export function fileRecall(task: Task, files: readonly string[]): number {
  const got = new Set(files);
  return task.gold_files.filter((g) => got.has(g)).length / task.gold_files.length;
}

/** Share of the files the run looked at that are gold files. */
export function filePrecision(task: Task, files: readonly string[]): number {
  if (files.length === 0) return 0;
  const gold = new Set(task.gold_files);
  return files.filter((f) => gold.has(f)).length / files.length;
}

export interface Summary {
  runner: string;
  tasks: number;
  recall: number;
  precision: number;
  /** Tasks whose every gold file was found. */
  fullRecall: number;
  meanTokens: number;
  totalTokens: number;
  meanToolCalls: number;
  /** Over tasks with tests that ran (skips excluded). */
  passRate?: number;
  passCounted: number;
  branches: Record<string, number>;
  clarificationRate?: number;
  meanUtilisation?: number;
  costUsd?: number;
  errors: number;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Aggregates results of one runner. */
export function summarize(runner: string, tasks: readonly Task[], results: readonly TaskResult[]): Summary {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = results.filter((r) => byId.has(r.taskId));
  const recalls = rows.map((r) => fileRecall(byId.get(r.taskId)!, r.files));
  const passRows = rows.filter((r) => r.passed !== undefined);
  const branches: Record<string, number> = {};
  for (const r of rows) if (r.branch) branches[r.branch] = (branches[r.branch] ?? 0) + 1;
  const clar = rows.filter((r) => r.clarified !== undefined);
  const util = rows.filter((r) => r.utilisation !== undefined).map((r) => r.utilisation!);
  const cost = rows.filter((r) => r.costUsd !== undefined).map((r) => r.costUsd!);
  return {
    runner, tasks: rows.length,
    recall: mean(recalls),
    precision: mean(rows.map((r) => filePrecision(byId.get(r.taskId)!, r.files))),
    fullRecall: recalls.filter((x) => x === 1).length,
    meanTokens: mean(rows.map((r) => r.tokens)),
    totalTokens: rows.reduce((a, r) => a + r.tokens, 0),
    meanToolCalls: mean(rows.map((r) => r.toolCalls)),
    ...(passRows.length ? { passRate: passRows.filter((r) => r.passed).length / passRows.length } : {}),
    passCounted: passRows.length,
    branches,
    ...(clar.length ? { clarificationRate: clar.filter((r) => r.clarified).length / clar.length } : {}),
    ...(util.length ? { meanUtilisation: mean(util) } : {}),
    ...(cost.length ? { costUsd: cost.reduce((a, b) => a + b, 0) } : {}),
    errors: rows.filter((r) => r.error).length,
  };
}

export interface Comparison {
  recallDelta: number;
  /** Relative token reduction of `candidate` vs `baseline` (0.3 = 30% fewer). */
  tokenReduction: number;
  toolCallReduction: number;
  passRateDelta?: number;
}

/** Compares a candidate summary against a baseline. */
export function compare(baseline: Summary, candidate: Summary): Comparison {
  return {
    recallDelta: candidate.recall - baseline.recall,
    tokenReduction: baseline.meanTokens ? 1 - candidate.meanTokens / baseline.meanTokens : 0,
    toolCallReduction: baseline.meanToolCalls ? 1 - candidate.meanToolCalls / baseline.meanToolCalls : 0,
    ...(baseline.passRate !== undefined && candidate.passRate !== undefined ? { passRateDelta: candidate.passRate - baseline.passRate } : {}),
  };
}
