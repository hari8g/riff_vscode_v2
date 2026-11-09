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
    expect(run.stages.map((s) => s.stage)).toEqual(['scan', 'parse', 'graph']);

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
    await expect(core.call('route', { text: 'x' } as never)).rejects.toThrow(/not available/);

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
