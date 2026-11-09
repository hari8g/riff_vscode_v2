import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { handleConsole } from '../src/consoleHost.js';
import { handleChat, handoffPrompt } from '../src/participant.js';
import { invokeTool, TOOL_DEFS } from '../src/tools.js';

const REPO = resolve(__dirname, '../../..');
const root = mkdtempSync(join(tmpdir(), 'riaf-ext-'));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
cpSync(join(REPO, '.riaf/policies.yaml'), join(root, '.riaf/policies.yaml'));
cpSync(join(REPO, '.riaf/governance.yaml'), join(root, '.riaf/governance.yaml'));
let core: DaemonCore;
beforeAll(async () => {
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
});
afterAll(async () => {
  await core.close();
  rmSync(root, { recursive: true, force: true });
});

describe('manifest', () => {
  it('declares exactly the LM tools the extension registers, with the same schemas', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    const declared = pkg.contributes.languageModelTools as { name: string; inputSchema: unknown; modelDescription: string }[];
    expect(declared.map((t) => t.name)).toEqual(TOOL_DEFS.map((t) => t.name));
    for (const t of TOOL_DEFS) {
      const d = declared.find((x) => x.name === t.name)!;
      expect(d.inputSchema).toEqual(t.inputSchema);
      expect(d.modelDescription).toBe(t.modelDescription);
    }
    expect(pkg.main).toBe('./dist/extension.cjs');
    expect(pkg.contributes.chatParticipants[0].name).toBe('riaf');
  });
});

describe('LM tools', () => {
  it('riaf_pack renders a Copilot-sized pack; jump, impact, history and wiki answer from the index', async () => {
    const pack = await invokeTool(core, 'riaf_pack', { request: 'Fix ReadingDeduper.accept keeping the blurrier read' });
    expect(pack).toMatch(/^RIAF context \(intent bugfix/);
    expect(pack).toContain('src/gantry/dedupe.ts');
    expect(await invokeTool(core, 'riaf_jump', { symbol: 'validatePlate' })).toMatch(/^validatePlate \(function\) at src\/toll\/plate\.ts:/);
    expect(await invokeTool(core, 'riaf_impact', { symbols: ['validatePlate'] })).toContain('TollSession.close');
    expect(await invokeTool(core, 'riaf_history', { symbol: 'validatePlate' })).toMatch(/Why `validatePlate`/);
    expect(await invokeTool(core, 'riaf_wiki', {})).toContain('- src/');
  });
});

describe('@riaf participant', () => {
  it('asks the one clarifying question when an interactive request is too vague', async () => {
    const out: string[] = [];
    const r = await handleChat(core, 'Settlement batch totals are larger than the sum of the entries', { markdown: (t) => out.push(t), progress: () => undefined, button: () => undefined });
    expect(r.branch).toBe('clarify');
    expect(out.join('')).toMatch(/^\*\*One question first:\*\* Should I /);
  });

  it('streams the pack and offers both hand-offs', async () => {
    const out: string[] = [];
    const buttons: string[] = [];
    const r = await handleChat(core, 'Fix makeBatches: settlement batch totals are larger than the sum of their entries', { markdown: (t) => out.push(t), progress: () => undefined, button: (b) => buttons.push(b.command) });
    expect(r.packId).toMatch(/^pk-/);
    expect(out.join('')).toContain('src/settlement/batch.ts');
    expect(buttons).toEqual(['riaf.handoffCopilot', 'riaf.handoffClaude']);
    expect(handoffPrompt('do x', '.riaf/handoff/pk-1.md')).toContain('Read it first');
  });
});

describe('console host', () => {
  it('serves every page and saves policies only when they validate', async () => {
    const writes: string[] = [];
    const deps = { rpc: core, writeRiafFile: async (n: string) => void writes.push(n), modelSettings: () => ({ summarize: { provider: 'ollama', model: 'qwen' } }) };
    for (const page of ['overview', 'repository', 'policies', 'sessions', 'adapters'] as const) {
      const r = await handleConsole(deps, { type: 'load', page });
      expect(r.type).toBe(page);
    }
    const pol = await core.call('policies.get', {});
    expect((await handleConsole(deps, { type: 'savePolicies', policies: 'version: 9\n', governance: pol.governance })).type).toBe('validation');
    expect(writes).toEqual([]);
    expect(await handleConsole(deps, { type: 'savePolicies', policies: pol.policies, governance: pol.governance })).toEqual({ type: 'saved', ok: true });
    expect(writes).toEqual(['policies.yaml', 'governance.yaml']);
  });

  it('routes live, compiles and re-renders packs, explores symbols and hands off', async () => {
    const ran: unknown[][] = [];
    const deps = { rpc: core, writeRiafFile: async () => undefined, modelSettings: () => ({}), runCommand: async (...a: unknown[]) => void ran.push(a) };
    const route = await handleConsole(deps, { type: 'route', text: 'Fix the null check in TollSession.close() and then add a config flag in FeatureFlags' });
    expect((route['policy'] as { stages: string[][] }).stages).toHaveLength(2);
    const compiled = await handleConsole(deps, { type: 'compile', text: 'Fix ReadingDeduper.accept keeping the blurrier read', budget: 8000 });
    const pack = compiled['pack'] as { packId: string; budget: number };
    expect(pack.budget).toBe(8000);
    expect(String(compiled['rendered'])).toMatch(/^# RIAF context pack/);
    expect(String((await handleConsole(deps, { type: 'render', packId: pack.packId, target: 'fragment' }))['text'])).toMatch(/^<riaf-context/);
    const impact = await handleConsole(deps, { type: 'impact', query: 'validatePlate' });
    expect((impact['definition'] as { path: string }).path).toBe('src/toll/plate.ts');
    expect((await handleConsole(deps, { type: 'impact', query: 'NoSuchThing' }))['definition']).toBeNull();
    expect((await handleConsole(deps, { type: 'jump', query: 'Ledger.post' }))['result']).toBeDefined();
    expect((await handleConsole(deps, { type: 'history', query: 'validatePlate' })).type).toBe('history');
    expect((await handleConsole(deps, { type: 'handoff', to: 'claude', text: 't', packId: pack.packId })).type).toBe('handedOff');
    expect(ran).toEqual([['riaf.handoffClaude', 't', pack.packId]]);
    expect((await handleConsole({ ...deps, runCommand: undefined } as never, { type: 'handoff', to: 'copilot', text: 't', packId: 'x' })).type).toBe('error');
  });
});

describe('activate (with a mocked vscode API)', () => {
  it('registers the status bar, five LM tools, the participant and the commands', async () => {
    const registered = { tools: [] as string[], commands: [] as string[], participants: [] as string[] };
    vi.doMock('vscode', () => ({
      StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 }, ViewColumn: { Active: -1 },
      ThemeIcon: class { constructor(readonly id: string) {} },
      LanguageModelToolResult: class { constructor(readonly content: unknown[]) {} },
      LanguageModelTextPart: class { constructor(readonly value: string) {} },
      window: { createStatusBarItem: () => ({ show: () => undefined, dispose: () => undefined }), activeTextEditor: undefined },
      workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined }) },
      env: { sessionId: 'test' },
      lm: { registerTool: (name: string) => (registered.tools.push(name), { dispose: () => undefined }) },
      chat: { createChatParticipant: (id: string) => (registered.participants.push(id), { dispose: () => undefined }) },
      commands: { registerCommand: (id: string) => (registered.commands.push(id), { dispose: () => undefined }) },
    }));
    const ext = await import('../src/extension.js');
    const context = { subscriptions: [] as { dispose(): void }[], extensionPath: '/nowhere', extensionUri: {} };
    await ext.activate(context as never);
    expect(registered.tools).toEqual(TOOL_DEFS.map((t) => t.name));
    expect(registered.participants).toEqual(['riaf.participant']);
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(registered.commands.sort()).toEqual((pkg.contributes.commands as { command: string }[]).map((c) => c.command).sort());
    for (const s of context.subscriptions) s.dispose();
    await ext.deactivate();
  });
});
