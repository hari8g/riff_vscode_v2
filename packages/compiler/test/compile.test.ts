import { afterAll, describe, expect, it } from 'vitest';
import { PackSchema } from '@riaf/kernel';
import { route } from '@riaf/intent';
import { compile } from '../src/compile.js';
import { render, renderCopilot } from '../src/render/index.js';
import { cleanup, repoView, TASKS } from './helpers.js';

afterAll(cleanup);
const NOW = new Date('2026-11-09T12:00:00Z');
const filesOf = (p: ReturnType<typeof compile>) => [...new Set(p.items.filter((i) => i.tier === 2 || i.tier === 3).map((i) => (i.source as { path?: string }).path).filter(Boolean))] as string[];

describe('compile on toll-ts', () => {
  it('a precise bugfix gives a small pack led by the anchor body and the test that exercises it', async () => {
    const view = await repoView('toll-ts');
    const { policy } = await route({ text: 'Fix ReadingDeduper.accept: it keeps the blurrier read' }, view);
    const pack = compile(policy, view, { now: NOW });
    expect(PackSchema.safeParse(pack).success).toBe(true);
    expect(pack.route.branch).toBe('single');
    const code = pack.items.filter((i) => i.tier === 2);
    expect((code[0]!.source as { path: string }).path).toBe('src/gantry/dedupe.ts');
    expect(code.some((i) => i.kind === 'test' && (i.source as { path: string }).path === 'test/dedupe.test.ts')).toBe(true);
    // no item repeats lines another item already shows
    const ranges = code.map((i) => i.source as { path: string; range?: { startLine: number; endLine: number } }).filter((s) => s.range);
    for (const a of ranges) for (const b of ranges) if (a !== b && a.path === b.path) expect(a.range!.startLine <= b.range!.startLine && a.range!.endLine >= b.range!.endLine && a.range!.startLine !== b.range!.startLine).toBe(false);
    expect(pack.tokensUsed).toBeLessThanOrEqual(pack.budget);
    expect(pack.tokensUsed).toBeLessThan(3000);
    expect(pack.items.some((i) => i.kind === 'runbook')).toBe(false);
    expect(pack.openLookups.some((l) => l.tool === 'riaf_history')).toBe(true); // history requested, not indexed yet
  });

  it('a two-stage blend orders code by stage and renders all targets', async () => {
    const view = await repoView('toll-ts');
    const { policy } = await route({ text: 'Fix the null check in TollSession.close() and then add a config flag in FeatureFlags so ops can disable it' }, view);
    const pack = compile(policy, view, { now: NOW, includeRunbook: true });
    expect(pack.route.stages).toHaveLength(2);
    const stages = pack.items.filter((i) => i.tier === 2).map((i) => i.stage);
    expect(stages).toEqual([...stages].sort());
    expect(pack.items.some((i) => i.kind === 'runbook')).toBe(true);
    const md = render(pack, 'claude');
    expect(md).toContain('### Stage 1');
    expect(md).toContain('## Code');
    expect(JSON.parse(render(pack, 'json')).packId).toBe(pack.packId);
    expect(render(pack, 'fragment')).toMatch(/^<riaf-context pack="pk-/);
    expect(render(pack, 'agentsmd')).toContain('# Run-book');
    const small = renderCopilot(pack, 1500);
    expect(small.length).toBeLessThan(2200);
    expect(small).toMatch(/omitted to fit/);
  });

  it('is deterministic for the same inputs', async () => {
    const view = await repoView('toll-ts');
    const { policy } = await route({ text: 'Rename Ledger.post to Ledger.record everywhere' }, view);
    const a = compile(policy, view, { now: NOW });
    const b = compile(policy, view, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // a rename pulls every reference site
    expect(filesOf(a)).toEqual(expect.arrayContaining(['src/toll/ledger.ts', 'src/toll/session.ts', 'test/settlement.test.ts']));
  });
});

describe('compile over the eval task set (localisation gate)', () => {
  it('reaches ≥ 85% file recall with fewer tokens than the scripted baseline', async () => {
    let recall = 0;
    let tokens = 0;
    const rows: string[] = [];
    for (const t of TASKS) {
      const view = await repoView(t.repo);
      const { policy } = await route({ text: t.request, ide: { ...(t.ide ?? {}), interactive: false } }, view);
      const pack = compile(policy, view, { now: NOW });
      const files = new Set(filesOf(pack));
      const r = t.gold_files.filter((g) => files.has(g)).length / t.gold_files.length;
      recall += r;
      tokens += pack.tokensUsed;
      rows.push(`${t.id} ${t.intent} branch=${pack.route.branch} recall=${r.toFixed(2)} tokens=${pack.tokensUsed} items=${pack.items.length} missing=${t.gold_files.filter((g) => !files.has(g)).join(',')}`);
    }
    if (process.env.RIAF_CALIBRATE) console.log(rows.join('\n'));
    const meanRecall = recall / TASKS.length;
    const meanTokens = tokens / TASKS.length;
    if (process.env.RIAF_CALIBRATE) console.log({ meanRecall, meanTokens });
    expect(meanRecall).toBeGreaterThanOrEqual(0.85);
    expect(meanTokens).toBeLessThan(2941); // scripted baseline mean (docs/eval/baseline.md)
  }, 120_000);
});
