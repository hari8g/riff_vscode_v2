import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TOKEN_SETTINGS, RPC_PROTOCOL_VERSION, silentLogger } from '@riaf/kernel';
import { DaemonCore } from '../src/core.js';
import { defaultTokensYaml, validateTokensText } from '../src/tokens.js';

const REPO = resolve(__dirname, '../../..');
const root = mkdtempSync(join(tmpdir(), 'riaf-core-prompt-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let core: DaemonCore;
beforeAll(async () => {
  cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
  cpSync(join(REPO, '.riaf/policies.yaml'), join(root, '.riaf/policies.yaml'));
  cpSync(join(REPO, '.riaf/governance.yaml'), join(root, '.riaf/governance.yaml'));
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
});
afterAll(async () => core?.close());

describe('protocol 1.5: agent prompt and token settings', () => {
  it('advertises the new methods', async () => {
    const info = await core.call('daemon.info', {});
    expect(info.protocol).toBe(RPC_PROTOCOL_VERSION);
    for (const m of ['prompt.build', 'tokens.get', 'tokens.validate', 'graph.insights', 'history.hotspots', 'semantic.glossary']) expect(info.methods).toContain(m);
  });

  it('builds the detailed prompt after routing and compiling, with notes from graph, history and glossary', async () => {
    const r = await core.call('prompt.build', { request: { text: 'Fix the null check in TollSession.close() so an invalid plate is never charged' }, sessionId: 's1' });
    expect(r.pack.budget).toBe(16_000);
    expect(r.prompt.sections.map((s) => s.id)).toContain('notes');
    expect(r.prompt.text).toContain('## What to watch');
    expect(r.prompt.text).toMatch(/load-bearing|No test reaches/);
    expect(r.prompt.plan.packUsed).toBe(r.pack.tokensUsed);
    const telemetry = await core.call('telemetry.query', {});
    expect(telemetry.packs).toBeGreaterThan(0);
  });

  it('takes a precomputed route (the prompt hook) and honours .riaf/tokens.yaml', async () => {
    const policy = await core.call('route', { text: 'Rename Ledger.post to Ledger.record everywhere' });
    const yaml = defaultTokensYaml().replace('name: claude-sonnet', 'name: claude-opus').replace(/refactor:\n(\s+)pack: 20000/, 'refactor:\n$1pack: 24000');
    expect(validateTokensText(yaml).ok).toBe(true);
    writeFileSync(join(root, '.riaf/tokens.yaml'), yaml);
    const r = await core.call('prompt.build', { route: policy, text: 'Rename Ledger.post to Ledger.record everywhere', host: 'copilot' });
    expect(r.prompt.plan.model).toBe('claude-opus');
    expect(r.prompt.host).toBe('copilot');
    expect(r.pack.budget).toBeGreaterThan(16_000);
    const t = await core.call('tokens.get', {});
    expect(t.source).toBe('file');
    writeFileSync(join(root, '.riaf/tokens.yaml'), 'version: 1\nmodel: {}\n');
    const bad = await core.call('tokens.get', {});
    expect(bad.source).toBe('builtin');
    expect(bad.settings).toEqual(DEFAULT_TOKEN_SETTINGS);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect((await core.call('tokens.validate', { text: 'not: [valid' })).ok).toBe(false);
  });

  it('serves graph insights, hotspots and the glossary', async () => {
    const g = await core.call('graph.insights', { top: 5 });
    expect(g.hubs).toHaveLength(5);
    // no git history in this copy: hotspots are empty rather than failing (covered with history in @riaf/history)
    expect((await core.call('history.hotspots', { top: 5, byDirectory: true })).hotspots).toEqual([]);
    const terms = await core.call('semantic.glossary', { top: 20 });
    expect(terms.terms.map((t) => t.term)).toContain('plate');
    const phrase = await core.call('semantic.glossary', { phrase: 'open disputes' });
    expect(phrase.terms.map((t) => t.term)).toContain('dispute');
  });
});
