import { DaemonCore } from '@riaf/daemon';
import { silentLogger, type Pack } from '@riaf/kernel';
import type { Task } from '../tasks.js';
import { prepareWorkspace } from '../workspace.js';
import type { Runner, RunnerContext, TaskResult } from './types.js';

/**
 * Localisation-only runner: indexes the task workspace in-process, routes and compiles a pack, and
 * scores the files the pack puts in front of the model (code, history and conventions tiers). One
 * tool call — riaf_pack — replaces the exploration the baseline does with grep and reads.
 */

/** Files a pack shows in its code and history tiers. */
export function packFiles(pack: Pack): string[] {
  return [...new Set(pack.items.filter((i) => i.tier === 2 || i.tier === 3).map((i) => (i.source as { path?: string }).path).filter((p): p is string => Boolean(p)))].sort();
}

/** Compiles the pack a task would get (shared by the runner and the golden-pack check). */
export async function compileTaskPack(task: Task, ctx: RunnerContext, opts: { budget?: number } = {}): Promise<Pack> {
  const ws = prepareWorkspace(task, ctx.paths, { git: false });
  const core = await DaemonCore.open({ root: ws.root, storePath: ':memory:', logger: silentLogger, repoName: task.repo });
  try {
    await core.index('eval');
    const r = await core.call('pack.compile', { request: { text: task.request, ide: { ...task.ide, interactive: false } }, target: 'json', ...(opts.budget ? { budget: opts.budget } : {}) });
    return r.pack;
  } finally {
    await core.close();
    ws.dispose();
  }
}

export class CompilerRunner implements Runner {
  readonly name = 'riaf-compiler';
  constructor(private readonly opts: { budget?: number } = {}) {}

  async run(task: Task, ctx: RunnerContext): Promise<TaskResult> {
    const t0 = performance.now();
    const pack = await compileTaskPack(task, ctx, this.opts);
    return {
      taskId: task.id, repo: task.repo, intent: task.intent, runner: this.name, files: packFiles(pack),
      tokens: pack.tokensUsed, toolCalls: 1, branch: pack.route.branch, clarified: pack.route.branch === 'clarify', ms: performance.now() - t0,
    };
  }
}

/** The (repo, task) pairs whose packs are pinned as golden packs. */
export const GOLDEN_TASKS = ['toll-001', 'toll-006', 'toll-010', 'toll-012', 'tel-001', 'tel-004', 'tel-007', 'emb-002', 'emb-004', 'emb-006', 'fleet-001', 'fleet-004'] as const;
