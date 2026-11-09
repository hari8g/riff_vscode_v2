import type { Task } from './tasks.js';
import { summarize, type Summary } from './metrics.js';
import type { Report } from './report.js';
import type { Runner, RunnerContext, TaskResult } from './runners/types.js';

/** Runs every task through every runner (sequentially per runner, `concurrency` tasks at a time). */
export async function runEval(tasks: readonly Task[], runners: readonly Runner[], ctx: RunnerContext, opts: { concurrency?: number; onResult?: (r: TaskResult) => void } = {}): Promise<Report> {
  const results: TaskResult[] = [];
  const summaries: Summary[] = [];
  for (const runner of runners) {
    const mine: TaskResult[] = [];
    const queue = [...tasks];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        let r: TaskResult;
        try {
          r = await runner.run(t, ctx);
        } catch (e) {
          r = { taskId: t.id, repo: t.repo, intent: t.intent, runner: runner.name, files: [], tokens: 0, toolCalls: 0, ms: 0, error: e instanceof Error ? e.message : String(e) };
        }
        mine.push(r);
        opts.onResult?.(r);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, worker));
    results.push(...mine);
    summaries.push(summarize(runner.name, tasks, mine));
  }
  return { generatedAt: new Date().toISOString(), summaries, results };
}
