import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalPaths } from './workspace.js';
import type { Task } from './tasks.js';

/** Runs a task's hidden tests in a prepared workspace with the toolchain for its language. */

export interface TestOutcome {
  passed: boolean;
  /** The toolchain is missing on this machine (the result is unknown, not failed). */
  skipped?: string;
  command: string;
  output: string;
  ms: number;
}

function which(cmd: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
}

/** Toolchains available on this machine, by test kind. */
export function availableToolchains(): Record<NonNullable<Task['test']>['kind'], boolean> {
  return { vitest: true, pytest: which('uv') || spawnSync('python3', ['-c', 'import pytest'], { stdio: 'ignore' }).status === 0, cc: which('cc'), javac: which('javac') && which('java') };
}

function javaSources(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n !== 'test' && n !== 'node_modules' && n !== '.git') walk(p);
      } else if (n.endsWith('.java')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Runs `task.test` in `root`. */
export function runTaskTests(task: Task, root: string, paths: EvalPaths, timeoutMs = 120_000): TestOutcome {
  const spec = task.test;
  if (!spec) return { passed: true, skipped: 'task has no tests', command: '', output: '', ms: 0 };
  const tools = availableToolchains();
  if (!tools[spec.kind]) return { passed: false, skipped: `${spec.kind} toolchain not available`, command: '', output: '', ms: 0 };
  const t0 = performance.now();
  const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: timeoutMs });
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`, cmd: [cmd, ...args].join(' ') };
  };
  let res: { ok: boolean; out: string; cmd: string };
  switch (spec.kind) {
    case 'vitest':
      res = run(process.execPath, [join(paths.monorepo, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root, ...spec.files], { CI: '1' });
      break;
    case 'pytest': {
      const env = { PYTHONPATH: join(root, 'src'), PYTHONDONTWRITEBYTECODE: '1' };
      res = which('uv')
        ? run('uv', ['run', '--no-project', '--quiet', '--with', 'pytest', 'python', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...spec.files], env)
        : run('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...spec.files], env);
      break;
    }
    case 'cc': {
      const out = mkdtempSync(join(tmpdir(), 'riaf-cc-'));
      try {
        res = { ok: true, out: '', cmd: '' };
        for (const f of spec.files) {
          const exe = join(out, f.replace(/[/.]/g, '_'));
          const c = run('cc', ['-std=c11', '-Wall', '-Iinclude', '-o', exe, f, ...(spec.sources ?? [])]);
          if (!c.ok) {
            res = c;
            break;
          }
          const x = run(exe, []);
          res = { ok: x.ok, out: res.out + c.out + x.out, cmd: `${c.cmd} && ${exe}` };
          if (!x.ok) break;
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
      break;
    }
    case 'javac': {
      const out = mkdtempSync(join(tmpdir(), 'riaf-javac-'));
      try {
        const c = run('javac', ['-d', out, ...javaSources(root).filter((p) => !p.includes('/hidden/')), ...spec.files.map((f) => join(root, f))]);
        res = c.ok ? run('java', ['-ea', '-cp', out, spec.main ?? '']) : c;
        if (c.ok) res.cmd = `${c.cmd} && ${res.cmd}`;
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
      break;
    }
  }
  return { passed: res.ok, command: res.cmd, output: res.out.slice(-4000), ms: performance.now() - t0 };
}
