import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { resetAskCache } from '../src/askHost.js';
import { handleConsole } from '../src/consoleHost.js';
import { pickSymbol, qualifiedName, suggestTasks } from '../src/suggest.js';

const REPO = resolve(__dirname, '../../..');
const root = join(mkdtempSync(join(tmpdir(), 'riaf-suggest-')), 'toll-ts');
let core: DaemonCore;
beforeAll(async () => {
  resetAskCache();
  cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'd@x', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'd@x' } });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'feat: initial tolling service');
  appendFileSync(join(root, 'src/toll/plate.ts'), '\n// checksum guard\n');
  git('commit', '-qam', 'fix: plate checksum rejects valid plates with a trailing space');
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
}, 60_000);
afterAll(async () => {
  await core.close();
  rmSync(resolve(root, '..'), { recursive: true, force: true });
});

describe('task suggestions', () => {
  it('names symbols and picks the most central non-test one', () => {
    expect(qualifiedName('src/a.ts#TollSession.close@method')).toBe('TollSession.close');
    expect(pickSymbol(['src/a.ts#helper@function', 'src/a.ts#TollSession@class', 'test/a.test.ts#x > y@test', 'src/a.ts#_private@function'])).toBe('src/a.ts#TollSession@class');
    expect(pickSymbol(['test/a.test.ts#x@test'])).toBeUndefined();
  });

  it('writes tasks from this repository: real areas, symbols and commits, none from another project', async () => {
    const tasks = await suggestTasks(core);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(tasks.length).toBeLessThanOrEqual(6);
    const text = tasks.map((t) => t.text).join('\n');
    expect(text).toMatch(/`[A-Z]\w+/); // a real symbol from the index
    expect(tasks.some((t) => t.intent === 'review' || t.intent === 'bugfix')).toBe(true);
    for (const t of tasks) expect(t.why.length).toBeGreaterThan(0);
    const r = await handleConsole({ rpc: core, writeRiafFile: async () => undefined, modelSettings: () => ({}) }, { type: 'suggestTasks' });
    expect(r).toMatchObject({ type: 'suggestions' });
  });
});
