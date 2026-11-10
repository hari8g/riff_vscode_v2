import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import type { LiveEvent, LiveSession } from '../src/claudeLive.js';
import { handleConsole, type ConsoleDeps } from '../src/consoleHost.js';
import { marker } from '../src/runs.js';
import { claudeCommand } from '../src/terminal.js';

const REPO = resolve(__dirname, '../../..');
const root = mkdtempSync(join(tmpdir(), 'riaf-ext-runs-'));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
let core: DaemonCore;
const sessions: LiveSession[] = [];
const events = new Map<string, LiveEvent[]>();
const ran: string[] = [];
const deps = (launch: boolean): ConsoleDeps => ({
  rpc: core, writeRiafFile: async () => undefined, modelSettings: () => ({}),
  launchClaude: async (r: string, text: string) => {
    const command = claudeCommand(r, text, { platform: 'darwin' });
    if (!launch) return { launched: false, command, reason: 'no terminal' };
    ran.push(command);
    return { launched: true, command };
  },
  repo: { current: () => root, recent: () => [root], open: async () => undefined, reloadOnSwitch: false },
  live: () => ({ dir: '', found: true, sessions, events: [] }),
  liveSession: (id: string) => events.get(id) ?? [],
}) as unknown as ConsoleDeps;
beforeAll(async () => {
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger });
  await core.index('test');
});
afterAll(async () => {
  await core.close();
  rmSync(root, { recursive: true, force: true });
});

describe('console: prompt runs keyed to Claude Code sessions', () => {
  it('compiles, exports (launching or offering the command) and follows the run to its code', async () => {
    const task = 'Fix ReadingDeduper.accept: it keeps the blurrier read';
    const c = await handleConsole(deps(true), { type: 'prompt', text: task });
    const id = (c['prompt'] as { promptId: string }).promptId;
    expect((await handleConsole(deps(true), { type: 'runs' }))['runs']).toMatchObject([{ promptId: id, task, status: 'compiled', source: 'console' }]);

    const launched = await handleConsole(deps(true), { type: 'exportPrompt', promptId: id });
    expect(launched).toMatchObject({ type: 'exported', launched: true });
    expect(ran[0]).toMatch(new RegExp(`^cd '${root.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}' && claude '\\[RIAF ${id}\\] Fix ReadingDeduper`));
    const offered = await handleConsole(deps(false), { type: 'exportPrompt', promptId: id });
    expect(offered).toMatchObject({ launched: false, reason: 'no terminal' });
    expect(String(offered['command'])).toContain(marker(id));

    const waiting = await handleConsole(deps(true), { type: 'run', promptId: id });
    expect((waiting['run'] as { status: string }).status).toBe('exported');
    expect(String(waiting['prompt'])).toMatch(/^# RIAF agent prompt/);

    sessions.push({ id: 's1', title: `${marker(id)} ${task}`, updatedAt: new Date().toISOString(), active: false, events: 4 });
    const at = (k: number) => new Date(Date.now() + k * 1000).toISOString();
    events.set('s1', [
      { id: 'a', session: 's1', at: at(0), kind: 'prompt', text: `${marker(id)} ${task}` },
      { id: 'b', session: 's1', at: at(1), kind: 'tool', tool: 'Edit', text: 'src/gantry/dedupe.ts', ref: 't1', edits: [{ path: 'src/gantry/dedupe.ts', before: 'a.confidence < b.confidence', after: 'a.confidence > b.confidence' }] },
      { id: 'c', session: 's1', at: at(2), kind: 'result', text: 'ok', ref: 't1' },
      { id: 'd', session: 's1', at: at(3), kind: 'text', text: 'Kept the sharper read.' },
    ]);
    const done = await handleConsole(deps(true), { type: 'run', promptId: id });
    expect((done['run'] as { status: string; session: { id: string } })).toMatchObject({ status: 'done', session: { id: 's1' } });
    expect(done['response']).toBe('Kept the sharper read.');
    expect(done['files']).toEqual([{ path: 'src/gantry/dedupe.ts', edits: [{ path: 'src/gantry/dedupe.ts', before: 'a.confidence < b.confidence', after: 'a.confidence > b.confidence' }] }]);
    expect(((await handleConsole(deps(true), { type: 'runs' }))['runs'] as { status: string }[])[0]!.status).toBe('done');
    expect((await handleConsole(deps(true), { type: 'exportPrompt', promptId: 'pr_missing' })).type).toBe('error');
  });
});
