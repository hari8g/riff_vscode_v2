import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { silentLogger, symbolId } from '@riaf/kernel';
import { DaemonCore } from '../src/core.js';

const REPO = resolve(__dirname, '../../..');
const dirs: string[] = [];
const copy = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `riaf-core-${name}-`));
  dirs.push(d);
  cpSync(join(REPO, 'fixtures/repos', name), d, { recursive: true });
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('DaemonCore in-process', () => {
  it('indexes and serves status, jump, impact and policies through validated RPC', async () => {
    const root = copy('toll-ts');
    cpSync(join(REPO, '.riaf/policies.yaml'), join(root, '.riaf/policies.yaml'));
    cpSync(join(REPO, '.riaf/governance.yaml'), join(root, '.riaf/governance.yaml'));
    const core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
    const run = await core.index('test');
    expect(run.stages.map((s) => s.stage)).toEqual(['scan', 'parse', 'graph', 'summaries']);

    const status = await core.call('index.status', {});
    expect(status.symbols).toBeGreaterThan(10);
    expect(status.stages.every((s) => s.pending === 0)).toBe(true);

    const jump = await core.call('graph.jump', { query: 'validatePlate' });
    expect(jump.definition?.path).toBe('src/toll/plate.ts');
    expect(jump.references.map((r) => r.symbol)).toContain(symbolId('src/toll/session.ts', 'TollSession.close', 'method'));

    const imp = await core.call('graph.impact', { symbols: [symbolId('src/toll/plate.ts', 'validatePlate', 'function')] });
    expect(imp.closure.length).toBeGreaterThan(0);
    expect(imp.tests.length).toBeGreaterThan(0);

    const pol = await core.call('policies.get', {});
    expect(pol.version).toMatch(/^policies\.yaml@[0-9a-f]{8}$/);
    expect((await core.call('policies.validate', { policies: pol.policies, governance: pol.governance })).ok).toBe(true);
    const bad = await core.call('policies.validate', { policies: 'version: 2\n' });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]?.file).toBe('policies.yaml');

    await expect(core.call('graph.jump', {} as never)).rejects.toThrow(/invalid params/);
    await expect(core.call('history.timeline' as never, {} as never)).rejects.toThrow(/unknown method|not available/);

    const info = await core.call('daemon.info', {});
    expect(info.methods).toContain('graph.jump');
    await core.close();
  });

  it('rebuild --full re-parses everything', async () => {
    const root = copy('telemetry-py');
    const core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger });
    await core.index('first');
    await core.call('index.rebuild', { full: true });
    const r = await core.index('after-rebuild');
    expect(r.stages.find((s) => s.stage === 'parse')?.changed).toBe(0); // the scheduled rebuild already ran
    const status = await core.call('index.status', {});
    expect(status.stages.find((s) => s.stage === 'parse')!.done).toBeGreaterThan(10);
    await core.close();
  });
});

describe('DaemonCore M3 surface', () => {
  it('routes, compiles, logs and re-serves packs; serves wiki and run-book', async () => {
    const root = copy('toll-ts');
    const core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
    await core.index('test');
    const policy = await core.call('route', { text: 'Fix ReadingDeduper.accept: it keeps the blurrier read' });
    expect(policy.branch).toBe('single');
    expect(policy.policyVersion).toBe('builtin@1'); // the copied fixture has no .riaf/policies.yaml
    const { pack, rendered } = await core.call('pack.compile', { request: { text: 'Fix ReadingDeduper.accept: it keeps the blurrier read' }, target: 'claude', sessionId: 's1' });
    expect(rendered).toContain('# RIAF context pack');
    expect(pack.items.some((i) => (i.source as { path?: string }).path === 'src/gantry/dedupe.ts')).toBe(true);
    expect(pack.items.some((i) => i.kind === 'runbook')).toBe(false);
    const again = await core.call('pack.get', { sessionId: 's1', target: 'json' });
    expect(again.pack?.packId).toBe(pack.packId);
    const copilot = await core.call('pack.compile', { route: policy, target: 'copilot' });
    expect(copilot.pack.items.some((i) => i.kind === 'runbook')).toBe(true);
    expect(core.store.compileLog.branchCounts()).toEqual({ single: 2 });
    const wiki = await core.call('wiki.structure', { depth: 2 });
    expect(wiki.tree.children.map((c) => c.id)).toContain('src/');
    expect((await core.call('wiki.page', { node: 'src/pricing/' })).children.length).toBeGreaterThan(1);
    const rb = await core.call('runbook.get', {});
    expect(rb.lines).toBeLessThanOrEqual(60);
    await core.close();
  });
});
