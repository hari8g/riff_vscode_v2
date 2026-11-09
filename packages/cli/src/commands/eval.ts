import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkGolden, ClaudeHeadlessRunner, compileTaskPack, CompilerRunner, defaultPaths, GOLDEN_TASKS, loadTasks, renderMarkdown, runEval, ScriptedBaselineRunner, type Runner } from '@riaf/eval';
import { bool, int, str, type ParsedArgs } from '../args.js';
import type { Io } from '../io.js';

/**
 * `riaf eval [--runner scripted,claude] [--only id,id] [--out dir] [--concurrency N] [--model M]`
 * Runs the task set and writes report.md and report.json. The claude runner calls Claude Code
 * headless and spends API credit; it only runs when named explicitly.
 */
export async function cmdEval(p: ParsedArgs, io: Io): Promise<number> {
  const paths = defaultPaths(str(p, 'monorepo') ?? io.cwd);
  if (str(p, 'tasks')) paths.tasks = resolve(str(p, 'tasks')!);
  const only = str(p, 'only')?.split(',').filter(Boolean);
  const tasks = loadTasks(paths.tasks).filter((t) => !only || only.includes(t.id));
  if (bool(p, 'golden') || bool(p, 'approve-golden')) {
    const approve = bool(p, 'approve-golden');
    let drift = 0;
    for (const id of GOLDEN_TASKS) {
      const task = tasks.find((t) => t.id === id);
      if (!task) continue;
      const d = checkGolden(paths.goldenPacks, id, await compileTaskPack(task, { paths }), approve);
      if (d.status !== 'same') drift++;
      io.out(`${d.status.padEnd(7)} ${id}${d.diff.length ? `\n${d.diff.map((l) => `    ${l}`).join('\n')}` : ''}`);
    }
    return drift && !approve ? 1 : 0;
  }
  const names = (str(p, 'runner') ?? 'scripted').split(',');
  const runners: Runner[] = [];
  for (const n of names) {
    if (n === 'scripted') runners.push(new ScriptedBaselineRunner());
    else if (n === 'compiler') runners.push(new CompilerRunner({ ...(int(p, 'budget') ? { budget: int(p, 'budget')! } : {}) }));
    else if (n === 'claude') runners.push(new ClaudeHeadlessRunner({ label: 'claude-baseline', maxTurns: int(p, 'max-turns', 30)!, ...(str(p, 'model') ? { model: str(p, 'model')! } : {}) }));
    else {
      io.err(`unknown runner ${n} (available: scripted, compiler, claude)`);
      return 2;
    }
  }
  const report = await runEval(tasks, runners, { paths }, {
    concurrency: int(p, 'concurrency', 1)!,
    onResult: (r) => { if (!bool(p, 'quiet')) io.err(`${r.runner} ${r.taskId} files=${r.files.length} tokens=${r.tokens} calls=${r.toolCalls}${r.passed !== undefined ? ` passed=${r.passed}` : ''}${r.error ? ` error=${r.error}` : ''}`); },
  });
  const out = resolve(str(p, 'out') ?? join(paths.monorepo, 'reports/eval'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const md = renderMarkdown(report, tasks, str(p, 'title') ?? 'RIAF eval');
  writeFileSync(join(out, 'report.md'), md);
  if (bool(p, 'json')) io.out(JSON.stringify(report.summaries, null, 2));
  else io.out(md.split('## Per task')[0]!.trim());
  return report.summaries.some((s) => s.errors > 0) ? 1 : 0;
}
