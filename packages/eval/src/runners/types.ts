import type { RouteBranch } from '@riaf/kernel';
import type { Task } from '../tasks.js';
import type { EvalPaths } from '../workspace.js';

/** What one runner produced for one task. */
export interface TaskResult {
  taskId: string;
  repo: string;
  intent: string;
  runner: string;
  /** Files the run looked at (read, retrieved into a pack, or edited). */
  files: string[];
  /** Tokens the model consumed (input + output) or the context delivered, per runner semantics. */
  tokens: number;
  toolCalls: number;
  /** Hidden-test outcome; undefined when the runner does not edit code or the task has no tests. */
  passed?: boolean;
  testsSkipped?: string;
  branch?: RouteBranch;
  clarified?: boolean;
  /** Share of pack items the agent actually read (M5). */
  utilisation?: number;
  costUsd?: number;
  ms: number;
  error?: string;
}

export interface RunnerContext {
  paths: EvalPaths;
  /** Per-task timeout. */
  timeoutMs?: number;
}

export interface Runner {
  readonly name: string;
  run(task: Task, ctx: RunnerContext): Promise<TaskResult>;
}
