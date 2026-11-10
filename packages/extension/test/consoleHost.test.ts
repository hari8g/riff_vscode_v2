import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleConsole, normalizeRepoPath, type ConsoleDeps, type RepoHost } from '../src/consoleHost.js';

const home = mkdtempSync(join(tmpdir(), 'riaf-host-'));
mkdirSync(join(home, 'code', 'toll'), { recursive: true });
writeFileSync(join(home, 'notes.txt'), 'x');
afterAll(() => rmSync(home, { recursive: true, force: true }));

const noRpc = { call: () => Promise.reject(new Error('no daemon needed')) } as unknown as ConsoleDeps['rpc'];
const deps = (repo?: Partial<RepoHost>): ConsoleDeps & { opened: string[] } => {
  const opened: string[] = [];
  return {
    opened,
    rpc: noRpc,
    writeRiafFile: async () => undefined,
    modelSettings: () => ({}),
    ...(repo ? { repo: { current: () => '/a', recent: () => ['/a', '/b'], open: async (r: string) => void opened.push(r), reloadOnSwitch: false, ...repo } } : {}),
  };
};

describe('console host: repositories', () => {
  it('resolves typed paths, with ~ and relative to home, and rejects files and missing folders', () => {
    expect(normalizeRepoPath('~/code/toll', home)).toBe(join(home, 'code', 'toll'));
    expect(normalizeRepoPath(` "${join(home, 'code')}" `, home)).toBe(join(home, 'code'));
    expect(normalizeRepoPath('code/toll', home)).toBe(join(home, 'code', 'toll'));
    expect(() => normalizeRepoPath('', home)).toThrow(/type the path/);
    expect(() => normalizeRepoPath('~/notes.txt', home)).toThrow(/is a file/);
    expect(() => normalizeRepoPath('~/nope', home)).toThrow(/no folder/);
  });

  it('lists repositories and opens one without needing a daemon', async () => {
    const d = deps({ browse: async () => join(home, 'code', 'toll') });
    expect(await handleConsole(d, { type: 'repos' })).toEqual({ type: 'repos', current: '/a', recent: ['/a', '/b'], canBrowse: true });
    expect(await handleConsole(d, { type: 'openRepo', browse: true })).toEqual({ type: 'repoOpened', root: join(home, 'code', 'toll'), reload: false });
    expect(await handleConsole(d, { type: 'openRepo', path: join(home, 'code') })).toMatchObject({ root: join(home, 'code') });
    expect(d.opened).toEqual([join(home, 'code', 'toll'), join(home, 'code')]);
  });

  it('reports a cancelled dialog, and a host that cannot switch', async () => {
    expect(await handleConsole(deps({ browse: async () => undefined }), { type: 'openRepo', browse: true })).toEqual({ type: 'repoOpened', cancelled: true });
    expect(await handleConsole(deps(), { type: 'openRepo', path: home })).toMatchObject({ type: 'error' });
    expect(await handleConsole(deps(), { type: 'repos' })).toEqual({ type: 'repos', current: '', recent: [], canBrowse: false });
  });

  it('answers the live feed from the host, or empty without one', async () => {
    expect(await handleConsole(deps(), { type: 'live' })).toEqual({ type: 'live', dir: '', found: false, sessions: [], events: [] });
    const d = { ...deps(), live: () => ({ dir: '/d', found: true, sessions: [], events: [{ id: 'x', session: 's', at: 't', kind: 'prompt' as const, text: 'hi' }] }) };
    expect(await handleConsole(d, { type: 'live' })).toMatchObject({ type: 'live', found: true, events: [{ text: 'hi' }] });
  });
});
