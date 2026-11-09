import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { createMcpServer, serveHttp, TOOL_NAMES } from '../src/index.js';

const root = mkdtempSync(join(tmpdir(), 'riaf-mcp-'));
cpSync(resolve(__dirname, '../../../fixtures/repos/toll-ts'), root, { recursive: true });
let core: DaemonCore;
let client: Client;
beforeAll(async () => {
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(core, { sessionId: 'sess-1' }).connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await core.close();
  rmSync(root, { recursive: true, force: true });
});
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe('RIAF MCP server', () => {
  it('lists the five tools and three resources', async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect((await client.listResources()).resources.map((r) => r.uri).sort()).toEqual(['riaf://architecture', 'riaf://pack/current', 'riaf://runbook']);
  });

  it('riaf_pack compiles a pack and riaf://pack/current returns it', async () => {
    const r = await client.callTool({ name: 'riaf_pack', arguments: { request: 'Fix ReadingDeduper.accept: it keeps the blurrier read' } });
    const md = textOf(r);
    expect(md).toMatch(/^# RIAF context pack pk-/);
    expect(md).toContain('src/gantry/dedupe.ts');
    const cur = await client.readResource({ uri: 'riaf://pack/current' });
    expect((cur.contents[0] as { text: string }).text).toBe(md);
  });

  it('riaf_jump, riaf_impact, riaf_wiki and riaf_history answer from the index', async () => {
    expect(textOf(await client.callTool({ name: 'riaf_jump', arguments: { symbol: 'validatePlate' } }))).toMatch(/\*\*validatePlate\*\* \(function\) — `src\/toll\/plate\.ts:/);
    const imp = textOf(await client.callTool({ name: 'riaf_impact', arguments: { symbols: ['validatePlate'] } }));
    expect(imp).toContain('TollSession.close');
    expect(imp).toMatch(/Tests to run \(\d+\)/);
    expect(textOf(await client.callTool({ name: 'riaf_wiki', arguments: {} }))).toContain('`src/`');
    expect(textOf(await client.callTool({ name: 'riaf_wiki', arguments: { node: 'src/pricing/engine.ts' } }))).toContain('quote(r: GantryReading, plazaId: string): number');
    expect(textOf(await client.callTool({ name: 'riaf_history', arguments: { symbol: 'validatePlate' } }))).toMatch(/History is not indexed|commit/);
    const runbook = await client.readResource({ uri: 'riaf://runbook' });
    expect((runbook.contents[0] as { text: string }).text).toContain('## Commands');
  });

  it('reports errors as tool errors instead of failing the call', async () => {
    const r = await client.callTool({ name: 'riaf_impact', arguments: { symbols: ['NoSuchSymbolAnywhere'] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/no symbol matched/);
  });

  it('serves the same tools over streamable HTTP', async () => {
    const http = await serveHttp(core, 0);
    const port = (http.address() as { port: number }).port;
    const c = new Client({ name: 'http-test', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    expect((await c.listTools()).tools).toHaveLength(5);
    expect(textOf(await c.callTool({ name: 'riaf_jump', arguments: { symbol: 'Ledger.post' } }))).toContain('src/toll/ledger.ts');
    await c.close();
    await new Promise((r) => http.close(r));
  });
});
