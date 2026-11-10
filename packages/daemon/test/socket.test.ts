import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { daemonInfoPath, socketPathFor } from '../src/paths.js';
import { DaemonClient, readDaemonInfo, stopDaemon } from '../src/rpc/client.js';
import { startDaemon } from '../src/main.js';

const REPO = resolve(__dirname, '../../..');
const dirs: string[] = [];
const copy = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-sock-')));
  dirs.push(d);
  cpSync(join(REPO, 'fixtures/repos/toll-ts'), d, { recursive: true });
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const until = async (pred: () => Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

describe('daemon over the socket', () => {
  it('serves clients, re-indexes on file changes, persists, and cleans up on shutdown', async () => {
    const root = copy();
    const h = await startDaemon({ root, poll: false, persistDebounceMs: 50 });
    await h.ready;
    expect(readDaemonInfo(root)?.socket).toBe(h.socket);
    await expect(startDaemon({ root })).rejects.toThrow(/already running/);

    const client = await DaemonClient.connect(root, { autoStart: false });
    expect(client.supports('graph.jump')).toBe(true);
    expect((await client.call('index.status', {})).symbols).toBeGreaterThan(10);

    writeFileSync(join(root, 'src/toll/refund.ts'), "import { Ledger } from './ledger.js';\nexport function refund(l: Ledger, id: string) { l.post(id, 1); }\n");
    expect(await until(async () => (await client.call('graph.jump', { query: 'refund' })).definition?.path === 'src/toll/refund.ts')).toBe(true);
    expect(await until(async () => existsSync(join(root, '.riaf/index.sqlite')))).toBe(true);

    await client.call('daemon.shutdown', {});
    expect(await until(async () => !existsSync(daemonInfoPath(root)))).toBe(true);
    await client.close().catch(() => undefined);
  });

  it('auto-starts a detached daemon from the client SDK', async () => {
    const root = copy();
    const bin = resolve(__dirname, '../dist/bin.js');
    const client = await DaemonClient.connect(root, { spawn: { command: process.execPath, args: [bin, '--root', root, '--no-watch'] }, startTimeoutMs: 20_000 });
    expect(client.info.pid).not.toBe(process.pid);
    expect(await until(async () => (await client.call('index.status', {})).symbols > 10)).toBe(true);
    await client.call('daemon.shutdown', {});
    expect(await until(async () => !existsSync(daemonInfoPath(root)))).toBe(true);
    await client.close().catch(() => undefined);
  });

  it('ignores a daemon.json written by another tool instead of waiting on its pid', () => {
    const root = copy();
    mkdirSync(join(root, '.riaf'), { recursive: true });
    writeFileSync(daemonInfoPath(root), JSON.stringify({ port: 7421, token: 't', pid: process.pid, root, url: 'http://127.0.0.1:7421/' }));
    expect(readDaemonInfo(root)).toBeUndefined();
  });

  it('fresh: stops the running daemon and starts a new one', async () => {
    const root = copy();
    const h = await startDaemon({ root, poll: false, watch: false });
    await h.ready;
    const bin = resolve(__dirname, '../dist/bin.js');
    const client = await DaemonClient.connect(root, { fresh: true, spawn: { command: process.execPath, args: [bin, '--root', root, '--no-watch'] }, startTimeoutMs: 20_000 });
    expect(client.info.pid).not.toBe(process.pid);
    expect(readDaemonInfo(root)?.pid).toBe(client.info.pid);
    expect(await stopDaemon(root)).toBe(true);
    expect(await until(async () => !existsSync(daemonInfoPath(root)))).toBe(true);
    expect(await stopDaemon(root)).toBe(false);
    await client.close().catch(() => undefined);
  });

  it('falls back to a temp-dir socket for deep paths and a named pipe on Windows', () => {
    expect(socketPathFor('/a/b')).toBe('/a/b/.riaf/daemon.sock');
    expect(socketPathFor(`/${'x'.repeat(120)}`)).toMatch(/riaf-[0-9a-f]{16}\.sock$/);
    expect(socketPathFor('C:\\repo', 'win32')).toMatch(/^\\\\\.\\pipe\\riaf-/);
  });
});
