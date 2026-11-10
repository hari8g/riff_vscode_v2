import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { handleConsole, type ConsoleDeps } from '../src/consoleHost.js';

const REPO = resolve(__dirname, '../../..');
const root = mkdtempSync(join(tmpdir(), 'riaf-ext-prompt-'));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
let core: DaemonCore;
const writes = new Map<string, string>();
let deps: ConsoleDeps;
beforeAll(async () => {
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
  deps = { rpc: core, writeRiafFile: async (n: string, t: string) => void writes.set(n, t), modelSettings: () => ({}) } as unknown as ConsoleDeps;
});
afterAll(async () => {
  await core.close();
  rmSync(root, { recursive: true, force: true });
});

describe('console: AI prompt, token settings and code health', () => {
  it('builds the agent prompt for the chosen host', async () => {
    const r = await handleConsole(deps, { type: 'prompt', text: 'Fix ReadingDeduper.accept: it keeps the blurrier read', host: 'copilot' });
    expect(r.type).toBe('prompt');
    const p = r['prompt'] as { host: string; text: string; plan: { prompt: number } };
    expect(p.host).toBe('copilot');
    expect(p.text).toContain('#riafJump');
    expect(p.plan.prompt).toBeGreaterThan(0);
  });

  it('loads settings with presets, validates and saves only valid settings', async () => {
    const t = await handleConsole(deps, { type: 'tokens' });
    expect(t['source']).toBe('builtin');
    const presets = t['presets'] as Record<string, { intents: { bugfix: { pack: number } } }>;
    expect(presets['economy']!.intents.bugfix.pack).toBeLessThan(presets['thorough']!.intents.bugfix.pack);
    const bad = await handleConsole(deps, { type: 'saveTokens', text: 'version: 1\n' });
    expect(bad.type).toBe('tokenValidation');
    expect(bad['ok']).toBe(false);
    expect(writes.has('tokens.yaml')).toBe(false);
    const good = await handleConsole(deps, { type: 'saveTokens', settings: presets['economy'] });
    expect(good.type).toBe('tokensSaved');
    expect(writes.get('tokens.yaml')).toMatch(/^# RIAF v2 token settings/);
  });

  it('loads code health from the graph, history and glossary', async () => {
    const h = await handleConsole(deps, { type: 'load', page: 'health' });
    expect(h.type).toBe('health');
    expect((h['insights'] as { hubs: unknown[] }).hubs.length).toBeGreaterThan(0);
    expect(Array.isArray(h['hotspots'])).toBe(true);
    expect((h['glossary'] as { term: string }[]).map((t) => t.term)).toContain('plate');
  });
});
