import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { memoryIo } from '../src/io.js';
import { runCli } from '../src/run.js';
import { GOVERNANCE_YAML, POLICIES_YAML } from '../src/templates.js';

const REPO = resolve(__dirname, '../../..');
const dirs: string[] = [];
const copy = (name: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `riaf-cli3-${name}-`)));
  dirs.push(d);
  cpSync(join(REPO, 'fixtures/repos', name), d, { recursive: true });
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('init templates', () => {
  it('are this repository’s own .riaf files', () => {
    expect(POLICIES_YAML).toBe(readFileSync(join(REPO, '.riaf/policies.yaml'), 'utf8'));
    expect(GOVERNANCE_YAML).toBe(readFileSync(join(REPO, '.riaf/governance.yaml'), 'utf8'));
  });
});

describe('riaf init, pack, wiki, runbook (in-process)', () => {
  it('initialises a repository for Claude Code and Copilot and compiles packs', async () => {
    const root = copy('telemetry-py');
    const io = memoryIo(root);
    expect(await runCli(['init', '--host', 'both', '--in-process', '--command', 'riaf'], io)).toBe(0);
    for (const f of ['.riaf/policies.yaml', '.riaf/governance.yaml', '.riaf/constraints.md', '.riaf/runbook.md', '.claude/commands/riaf-pack.md', 'CLAUDE.md', 'AGENTS.md']) expect(existsSync(join(root, f)), f).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')).mcpServers.riaf).toEqual({ type: 'stdio', command: 'riaf', args: ['mcp'] });
    expect(JSON.parse(readFileSync(join(root, '.vscode/mcp.json'), 'utf8')).servers.riaf.command).toBe('riaf');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toMatch(/^@\.riaf\/runbook\.md/);
    const rb = readFileSync(join(root, '.riaf/runbook.md'), 'utf8');
    expect(rb.trimEnd().split('\n').length).toBeLessThanOrEqual(60);
    expect(rb).toContain('- test: `pytest -q`');
    // idempotent: a second init keeps files and does not duplicate the import line
    expect(await runCli(['init', '--host', 'claude', '--in-process', '--command', 'riaf'], memoryIo(root))).toBe(0);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8').match(/@\.riaf\/runbook\.md/g)).toHaveLength(1);

    const pack = memoryIo(root);
    expect(await runCli(['pack', 'RingBuffer returns stale frames after overflow; drop the oldest frame', '--in-process', '--quiet'], pack)).toBe(0);
    expect(pack.stdout.join('\n')).toContain('src/telemetry/buffer.py');
    const json = memoryIo(root);
    expect(await runCli(['pack', 'explain the pipeline', '--in-process', '--render', 'json'], json)).toBe(0);
    expect(JSON.parse(json.stdout.join('\n')).policyVersion).toMatch(/^policies\.yaml@/);
    const wiki = memoryIo(root);
    expect(await runCli(['wiki', 'src/telemetry/', '--in-process'], wiki)).toBe(0);
    expect(wiki.stdout.join('\n')).toContain('`src/telemetry/codec.py`');
    expect(await runCli(['pack', 'x', '--render', 'html', '--in-process'], memoryIo(root))).toBe(2);
  });
});

describe('riaf mcp over stdio (the way Claude Code launches it)', () => {
  it('serves the five tools and compiles a pack', async () => {
    const root = copy('toll-ts');
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(__dirname, '../dist/main.js'), 'mcp', '--root', root, '--in-process'], stderr: 'ignore' });
    const client = new Client({ name: 'stdio-test', version: '1' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('riaf_pack');
    const r = await client.callTool({ name: 'riaf_pack', arguments: { request: 'Settlement batch totals are larger than the sum of their entries' } });
    expect((r.content as { text: string }[])[0]!.text).toContain('src/settlement/batch.ts');
    await client.close();
  }, 60_000);
});
