import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger, type Pack } from '@riaf/kernel';
import { applyEdits, writeHidden, type Task } from '../tasks.js';
import { runTaskTests } from '../testrun.js';
import type { EvalPaths } from '../workspace.js';

/**
 * Offline learning-loop simulation for the M5 gate "skills reused": the tasks of each repository run in
 * order through one daemon. Each session compiles its pack, reads the pack's files, applies the gold
 * edits, runs the hidden tests through the governor, and ends; a passing session distils skills. A later
 * task "reuses" a skill when its pack carries one distilled from an earlier session.
 */

export interface SimulatedSession {
  taskId: string;
  passed: boolean | undefined;
  skillsInPack: string[];
  skillsDistilled: number;
  utilisation?: number;
  toolCalls: number;
  served: number;
}

export async function simulateLearning(tasks: readonly Task[], paths: EvalPaths): Promise<SimulatedSession[]> {
  const out: SimulatedSession[] = [];
  const byRepo = new Map<string, Task[]>();
  for (const t of tasks) byRepo.set(t.repo, [...(byRepo.get(t.repo) ?? []), t]);
  for (const [repo, list] of byRepo) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), `riaf-sim-${repo}-`)));
    cpSync(join(paths.repos, repo), root, { recursive: true });
    if (existsSync(join(root, 'package.json'))) symlinkSync(join(paths.monorepo, 'node_modules'), join(root, 'node_modules'), 'dir');
    const core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, repoName: repo, history: false });
    try {
      await core.index('sim');
      for (const t of list) {
        const session = `sim-${t.id}`;
        const { pack } = await core.call('pack.compile', { request: { text: t.request, ide: { ...t.ide, interactive: false } }, target: 'json', sessionId: session });
        const skillsInPack = pack.items.filter((i) => i.kind === 'skill').map((i) => (i.source as { virtual: string }).virtual);
        const call = async (tool: string, args: Record<string, unknown>, result: string) => {
          const d = await core.call('govern.toolCall', { sessionId: session, phase: 'explore', tool, args, at: new Date().toISOString() });
          await core.call('govern.event', { sessionId: session, kind: 'tool.result', payload: { tool, args, result } });
          return d;
        };
        let served = 0;
        // the agent reads what the pack points at, then the gold files, edits them and runs the tests
        const files = [...new Set([...packPaths(pack).slice(0, 3), ...t.gold_files])];
        for (const f of files) if ((await call('Read', { file_path: join(root, f) }, `contents of ${f}`)).kind === 'serve') served++;
        let passed: boolean | undefined;
        if (t.gold.length && t.test) {
          for (const g of t.gold) await call('Edit', { file_path: join(root, g.path), old_string: 'find' in g ? g.find : '', new_string: 'replace' in g ? g.replace : '' }, 'ok');
          // run the real hidden tests on a scratch copy so the shared workspace stays at the fixture state
          const scratch = realpathSync(mkdtempSync(join(tmpdir(), `riaf-sim-run-${t.id}-`)));
          try {
            cpSync(join(paths.repos, repo), scratch, { recursive: true });
            if (existsSync(join(scratch, 'package.json'))) symlinkSync(join(paths.monorepo, 'node_modules'), join(scratch, 'node_modules'), 'dir');
            applyEdits(scratch, t.setup);
            applyEdits(scratch, t.gold);
            writeHidden(scratch, t);
            const r = runTaskTests(t, scratch, paths);
            passed = r.skipped ? undefined : r.passed;
            await call('Bash', { command: testCommand(t) }, r.skipped ? 'skipped' : r.passed ? '1 passed' : `FAILED\n${r.output.slice(0, 500)}`);
          } finally {
            rmSync(scratch, { recursive: true, force: true });
          }
        }
        const before = core.store.govern.skillCount();
        await core.call('govern.event', { sessionId: session, kind: 'session.end', payload: {} });
        out.push({ taskId: t.id, passed, skillsInPack, skillsDistilled: core.store.govern.skillCount() - before, toolCalls: core.store.govern.calls(session).length, served });
      }
    } finally {
      await core.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
  return out;
}

function packPaths(pack: Pack): string[] {
  return [...new Set(pack.items.filter((i) => i.tier === 2).map((i) => (i.source as { path?: string }).path).filter((p): p is string => Boolean(p)))];
}

function testCommand(t: Task): string {
  switch (t.test?.kind) {
    case 'vitest': return `npx vitest run ${t.test.files.join(' ')}`;
    case 'pytest': return `pytest -q ${t.test.files.join(' ')}`;
    case 'cc': return `ctest # ${t.test.files.join(' ')}`;
    case 'javac': return `mvn -q test # ${t.test.files.join(' ')}`;
    default: return 'npm test';
  }
}
