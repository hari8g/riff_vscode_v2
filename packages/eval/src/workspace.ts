import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyEdits, type Task } from './tasks.js';

/** Paths the harness needs: the monorepo root (for vitest and node_modules) and the fixtures. */
export interface EvalPaths {
  monorepo: string;
  repos: string;
  tasks: string;
  goldenPacks: string;
}

/** Default layout relative to this package (works from src under vitest and from dist). */
export function defaultPaths(fromDir: string): EvalPaths {
  let d = resolve(fromDir);
  while (!existsSync(join(d, 'pnpm-workspace.yaml'))) {
    const up = resolve(d, '..');
    if (up === d) throw new Error(`cannot find the monorepo root above ${fromDir}`);
    d = up;
  }
  return { monorepo: d, repos: join(d, 'fixtures/repos'), tasks: join(d, 'fixtures/tasks'), goldenPacks: join(d, 'fixtures/golden-packs') };
}

export interface Workspace {
  root: string;
  dispose(): void;
}

/**
 * Creates a disposable copy of the task's fixture in its starting state (setup applied), as a git
 * repository with one commit so agents and diff tools see a clean tree. TypeScript fixtures get the
 * monorepo's node_modules linked so vitest runs offline.
 */
export function prepareWorkspace(task: Task, paths: EvalPaths, opts: { git?: boolean } = {}): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `riaf-task-${task.id}-`)));
  cpSync(join(paths.repos, task.repo), root, { recursive: true, filter: (src) => !src.includes(`${task.repo}/.riaf`) });
  applyEdits(root, task.setup);
  if (existsSync(join(root, 'package.json'))) symlinkSync(join(paths.monorepo, 'node_modules'), join(root, 'node_modules'), 'dir');
  if (opts.git ?? true) {
    const env = { ...process.env, GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid' };
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('sh', ['-c', 'printf "node_modules\\n.riaf/\\n__pycache__/\\n.pytest_cache/\\nbuild/\\n" > .git/info/exclude'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    execFileSync('git', ['commit', '-q', '-m', `task ${task.id} start`], { cwd: root, env });
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
