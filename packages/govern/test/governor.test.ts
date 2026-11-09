import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { FixedClock, GovernanceFileSchema, type ToolCall } from '@riaf/kernel';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { checkBudget, newBudgetState } from '../src/budgets.js';
import { Governor } from '../src/governor.js';
import { callKey } from '../src/normalize.js';
import { serveGlob, serveGrep } from '../src/serve.js';

const REPO = resolve(__dirname, '../../..');
const governance = GovernanceFileSchema.parse(parse(readFileSync(join(REPO, '.riaf/governance.yaml'), 'utf8')));
const root = mkdtempSync(join(tmpdir(), 'riaf-govern-'));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function setup() {
  const store = await Store.open();
  scanIntoStore(store, root);
  await runParseStage(store, { root });
  const graph = new Graph(store);
  graph.update();
  const clock = new FixedClock(new Date('2026-11-09T10:00:00Z'));
  return { store, graph, clock, gov: new Governor({ root, store, graph, governance, clock }) };
}
const call = (tool: string, args: Record<string, unknown>, sessionId = 's1'): ToolCall => ({ sessionId, phase: 'explore', tool, args, at: '2026-11-09T10:00:00Z' });

describe('budgets', () => {
  it('reflects once past a soft limit and blocks past the hard limit', () => {
    const s = newBudgetState(0);
    s.calls.explore = governance.phases.explore.soft_calls;
    expect(checkBudget(governance, s, 'explore', 1000).level).toBe('soft');
    expect(checkBudget(governance, s, 'explore', 1000).level).toBe('ok'); // warned once
    s.calls.explore = governance.phases.explore.max_calls;
    expect(checkBudget(governance, s, 'explore', 1000).level).toBe('hard');
  });
  it('keys calls by their semantics, not by absolute paths', () => {
    expect(callKey(root, { tool: 'Read', args: { file_path: join(root, 'src/a.ts') } })).toBe(callKey(root, { tool: 'Read', args: { file_path: 'src/a.ts' } }));
    expect(callKey(root, { tool: 'Read', args: { file_path: 'src/a.ts', offset: 10 } })).not.toBe(callKey(root, { tool: 'Read', args: { file_path: 'src/a.ts' } }));
  });
});

describe('index serving', () => {
  it('answers grep and glob from the index', async () => {
    const { store } = await setup();
    expect(serveGrep(store, 'isEnabled(')).toBeUndefined(); // invalid regex, as ripgrep would say: let the real tool report it
    const g = serveGrep(store, 'isEnabled\\(')!;
    expect(g.text).toContain('src/toll/session.ts:');
    expect(serveGrep(store, 'validate\\w+\\(', { filesOnly: true })!.text.split('\n')).toContain('src/toll/plate.ts');
    expect(serveGlob(store, 'src/**/*.ts')!.matches).toBeGreaterThan(20);
    expect(serveGlob(store, '*.ts', 'src/pricing')!.text.split('\n')).toEqual(['src/pricing/engine.ts', 'src/pricing/peak.ts', 'src/pricing/tariff.ts']);
  });
});

describe('Governor', () => {
  it('serves grep/glob from the index, repeat reads from the cache, and blocks loops', async () => {
    const { gov } = await setup();
    expect(gov.onToolCall(call('Grep', { pattern: 'charge-on-close' }))).toMatchObject({ kind: 'serve', from: 'index' });
    expect(gov.onToolCall(call('Glob', { pattern: 'src/gantry/*.ts' }))).toMatchObject({ kind: 'serve', from: 'index' });
    expect(gov.onToolCall(call('Grep', { pattern: 'zzzz_not_there' }))).toEqual({ kind: 'allow' }); // nothing to serve: run the real tool
    const read = call('Read', { file_path: join(root, 'src/toll/ledger.ts') });
    expect(gov.onToolCall(read)).toEqual({ kind: 'allow' });
    gov.onToolResult('s1', 'Read', read.args, 'export class Ledger { … }');
    const again = gov.onToolCall(read);
    expect(again).toMatchObject({ kind: 'serve', from: 'cache' });
    expect((again as { result: string }).result).toContain('has not changed');
    const bash = call('Bash', { command: 'ls src' });
    gov.onToolCall(bash);
    gov.onToolCall(bash);
    expect(gov.onToolCall(bash).kind).toBe('block');
  });

  it('advises compaction once near the context window', async () => {
    const { gov } = await setup();
    gov.onToolResult('s2', 'Read', { file_path: 'x' }, 'x'.repeat(1000));
    const g = new Governor({ root, store: (gov as unknown as { opts: { store: Store } }).opts.store, graph: (gov as unknown as { opts: { graph: Graph } }).opts.graph, governance, contextWindow: 200 });
    g.onToolResult('s3', 'Bash', { command: 'cat big' }, 'y'.repeat(2000));
    const d = g.onToolCall(call('Bash', { command: 'ls' }, 's3'));
    expect(d.kind).toBe('reflect');
    expect((d as { message: string }).message).toMatch(/compacting; keep: plan, anchors/);
  });

  it('a successful session yields utilisation, priors and a skill grounded on the edited symbol', async () => {
    const { gov, store, graph } = await setup();
    // a pack for the session (logged the way the daemon logs it)
    const pack = {
      packId: 'pk-1', repo: 'toll-ts', route: { w: { bugfix: 1 }, H: 0, branch: 'single', stages: [['u1']] }, budget: 1000, tokensUsed: 2, openLookups: [], policyVersion: 'v', schemaVersion: 1, createdAt: '2026-11-09T10:00:00Z',
      items: [
        { id: 'i1', tier: 2, kind: 'body', source: { path: 'src/gantry/dedupe.ts', range: { startLine: 10, endLine: 25 } }, hash: 'a'.repeat(64), why: { intent: 'bugfix', rule: 'anchor', weight: 1, score: 1 }, tokens: 1, stage: 0, content: 'x' },
        { id: 'i2', tier: 2, kind: 'body', source: { path: 'src/util/money.ts', range: { startLine: 1, endLine: 5 } }, hash: 'b'.repeat(64), why: { intent: 'bugfix', rule: 'callers', weight: 1, score: 0.5 }, tokens: 1, stage: 0, content: 'y' },
      ],
    };
    store.compileLog.recordRoute({ routeId: 'r1', sessionId: 's9', text: 'fix dedupe', branch: 'single', H: 0, w: { bugfix: 1 }, json: '{}', createdAt: '2026-11-09T10:00:00Z' });
    store.compileLog.recordPack({ packId: 'pk-1', sessionId: 's9', createdAt: '2026-11-09T10:00:00Z', budget: 1000, tokensUsed: 2, policyVersion: 'v', json: JSON.stringify(pack), items: pack.items.map((i) => ({ itemId: i.id, tier: i.tier, kind: i.kind, path: i.source.path, intent: 'bugfix', rule: i.why.rule, score: i.why.score, tokens: 1 })) });
    gov.onPackCompiled('s9', pack as never, 'Fix ReadingDeduper keeping the blurrier read.');
    gov.onToolCall(call('Read', { file_path: join(root, 'src/gantry/dedupe.ts'), offset: 1, limit: 40 }, 's9'));
    gov.onToolCall(call('Edit', { file_path: join(root, 'src/gantry/dedupe.ts'), old_string: '<', new_string: '>' }, 's9'));
    gov.onToolCall(call('Bash', { command: 'npx vitest run test/dedupe.test.ts' }, 's9'));
    const sum = gov.onSessionEnd('s9', 'success');
    expect(sum.utilisation).toBe(0.5);
    expect(sum.skills).toHaveLength(1);
    expect(Object.values(sum.priors).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(sum.priors['bugfix']).toBeGreaterThan(sum.priors['feature']!);
    const skills = store.govern.skillsFor(['src/gantry/dedupe.ts#ReadingDeduper@class']);
    expect(skills[0]).toMatchObject({ purpose: 'Fix ReadingDeduper keeping the blurrier read.', entityId: 'src/gantry/dedupe.ts#ReadingDeduper@class' });
    expect(skills[0]!.playbook).toBe('read src/gantry/dedupe.ts → edit src/gantry/dedupe.ts → run `npx vitest run test/dedupe.test.ts`');
    expect(store.govern.utilisationByRule()).toEqual(expect.arrayContaining([{ rule: 'anchor', intent: 'bugfix', delivered: 1, read: 1 }, { rule: 'callers', intent: 'bugfix', delivered: 1, read: 0 }]));
    void graph;
  });
});
