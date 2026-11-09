import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The shippable bundle must run with no node_modules anywhere: wasm runtimes and grammars travel with it.
const REPO = resolve(__dirname, '../../..');
const iso = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-bundle-')));
const cli = join(iso, 'riaf', 'riaf.mjs');
const repo = join(iso, 'repo');
beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, 'tooling/esbuild/build.mjs'), 'cli', join(iso, 'riaf')], { encoding: 'utf8' });
  cpSync(join(REPO, 'fixtures/repos/telemetry-py'), repo, { recursive: true });
}, 120_000);
afterAll(async () => {
  try {
    const info = JSON.parse(readFileSync(join(repo, '.riaf/daemon.json'), 'utf8')) as { pid: number };
    process.kill(info.pid, 'SIGTERM');
    // let the daemon finish persisting before its directory goes
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(info.pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // no daemon left running
  }
  rmSync(iso, { recursive: true, force: true });
});

describe('self-contained CLI bundle', () => {
  it('ships its wasm runtimes and grammars and nothing from node_modules', () => {
    for (const f of ['riaf.mjs', 'sqlite3.wasm', 'tree-sitter.wasm', 'grammars/tree-sitter-python.wasm', 'grammars/tree-sitter-c_sharp.wasm']) expect(existsSync(join(iso, 'riaf', f)), f).toBe(true);
    expect(existsSync(join(iso, 'node_modules'))).toBe(false);
    expect(readFileSync(cli, 'utf8')).not.toMatch(/require\(["']better-sqlite3["']\)\s*;?\s*$/m);
  });

  it('indexes, jumps and packs in process; auto-starts its own daemon; serves MCP over stdio', async () => {
    const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args, '--root', repo], { encoding: 'utf8', cwd: iso, timeout: 60_000 });
    expect(run('index', '--in-process')).toMatch(/indexed \d+ files/);
    expect(run('jump', 'Pipeline.flush')).toMatch(/^Pipeline\.flush\s+method/); // daemon mode: the bundle spawns itself
    expect(existsSync(join(repo, '.riaf/daemon.json'))).toBe(true);
    const client = new Client({ name: 'bundle', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--root', repo], stderr: 'ignore' }));
    const r = await client.callTool({ name: 'riaf_pack', arguments: { request: 'RingBuffer drops the newest frame instead of the oldest' } });
    expect((r.content as { text: string }[])[0]!.text).toContain('src/telemetry/buffer.py');
    await client.close();
  }, 120_000);
});
