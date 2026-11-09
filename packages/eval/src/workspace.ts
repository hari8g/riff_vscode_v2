import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeFixtureHistory } from './fixtureHistory.js';
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

/** Content hash of a fixture directory (keys the history cache). */
function fixtureHash(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n === '.riaf' || n === 'node_modules') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.slice(dir.length)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 16);
}

/** The fixture's synthetic 200-commit history, generated once per fixture content and cached in tmp. */
export function cachedHistoryRepo(repo: string, paths: EvalPaths): string {
  const src = join(paths.repos, repo);
  const dir = join(tmpdir(), 'riaf-history-cache', `${repo}-${fixtureHash(src)}`);
  if (!existsSync(join(dir, '.ready'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    makeFixtureHistory(src, dir);
    writeFileSync(join(dir, '.ready'), 'ok');
  }
  return dir;
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
export function prepareWorkspace(task: Task, paths: EvalPaths, opts: { git?: boolean; history?: boolean } = {}): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `riaf-task-${task.id}-`)));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid', GIT_AUTHOR_DATE: '2026-01-05T09:00:00Z', GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' };
  if (opts.history) {
    // the fixture's synthetic history, with the task's starting state as the newest commit
    cpSync(cachedHistoryRepo(task.repo, paths), root, { recursive: true, filter: (src) => !src.endsWith('.ready') });
    applyEdits(root, task.setup);
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `chore: ${task.id} starting state`], { cwd: root, env });
    if (existsSync(join(root, 'package.json'))) symlinkSync(join(paths.monorepo, 'node_modules'), join(root, 'node_modules'), 'dir');
    return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
  }
  cpSync(join(paths.repos, task.repo), root, { recursive: true, filter: (src) => !src.includes(`${task.repo}/.riaf`) });
  applyEdits(root, task.setup);
  if (existsSync(join(root, 'package.json'))) symlinkSync(join(paths.monorepo, 'node_modules'), join(root, 'node_modules'), 'dir');
  if (opts.git ?? true) {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('sh', ['-c', 'printf "node_modules\\n.riaf/\\n__pycache__/\\n.pytest_cache/\\nbuild/\\n" > .git/info/exclude'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    execFileSync('git', ['commit', '-q', '-m', `task ${task.id} start`], { cwd: root, env });
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
