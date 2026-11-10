import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_TOKEN_SETTINGS, estimateTokens, GovernanceFileSchema, TOKEN_PRESETS, TokenSettingsSchema, type TokenSettings } from '@riaf/kernel';
import { route } from '@riaf/intent';
import { compile } from '../src/compile.js';
import { blendTokens, buildAgentPrompt } from '../src/prompt.js';
import { cleanup, repoView, ROOT } from './helpers.js';

afterAll(cleanup);
const NOW = new Date('2026-11-09T12:00:00Z');
const RUNBOOK = readFileSync(join(ROOT, '.riaf/runbook.md'), 'utf8');
const GOV = GovernanceFileSchema.parse(parse(readFileSync(join(ROOT, '.riaf/governance.yaml'), 'utf8')));

async function prompt(text: string, settings: TokenSettings = DEFAULT_TOKEN_SETTINGS, host: 'claude' | 'copilot' | 'generic' = 'claude') {
  const view = await repoView('toll-ts');
  const { policy } = await route({ text }, view);
  const blend = blendTokens(policy, settings);
  const pack = compile(policy, view, { now: NOW, budget: blend.pack });
  return { policy, pack, blend, p: buildAgentPrompt({ text, policy, pack, settings, host, governance: GOV, runbook: RUNBOOK, notes: ['Toll session is a hub: 5 parts depend on it.'] }) };
}

describe('token settings', () => {
  it('validates the defaults and every preset, and rejects settings that do not fit the window', () => {
    expect(TokenSettingsSchema.safeParse(DEFAULT_TOKEN_SETTINGS).success).toBe(true);
    for (const p of Object.values(TOKEN_PRESETS)) expect(TokenSettingsSchema.safeParse(p(DEFAULT_TOKEN_SETTINGS)).success).toBe(true);
    expect(TOKEN_PRESETS.economy(DEFAULT_TOKEN_SETTINGS).intents.bugfix.pack).toBeLessThan(DEFAULT_TOKEN_SETTINGS.intents.bugfix.pack);
    const tooBig = { ...DEFAULT_TOKEN_SETTINGS, model: { ...DEFAULT_TOKEN_SETTINGS.model, context_window: 20_000 } };
    expect(TokenSettingsSchema.safeParse(tooBig).success).toBe(false);
  });

  it('blends pack, reply reserve and plan gate by intent weight', () => {
    const s = DEFAULT_TOKEN_SETTINGS;
    const single = blendTokens({ primitives: [{ intent: 'bugfix', weight: 1 }] }, s);
    expect(single).toMatchObject({ pack: 16_000, output: 8_192, planGate: false });
    const mixed = blendTokens({ primitives: [{ intent: 'bugfix', weight: 0.6 }, { intent: 'refactor', weight: 0.4 }] }, s);
    expect(mixed.pack).toBe(Math.round((0.6 * 16_000 + 0.4 * 20_000) / 500) * 500);
    expect(mixed.planGate).toBe(true);
    expect(blendTokens({ primitives: [{ intent: 'bugfix', weight: 0.8 }, { intent: 'feature', weight: 0.2 }] }, s).planGate).toBe(false);
    expect(mixed.mix.map((m) => m.intent)).toEqual(['bugfix', 'refactor']);
  });
});

describe('agent prompt', () => {
  it('puts stable sections first and lays out task, plan, budget, notes, context and checks', async () => {
    const { p, pack } = await prompt('Fix ReadingDeduper.accept: it keeps the blurrier read');
    expect(p.sections.map((s) => s.id)).toEqual(['protocol', 'repository', 'reply', 'task', 'plan', 'budget', 'notes', 'context', 'finish']);
    expect(p.sections.filter((s) => s.cacheable).map((s) => s.id)).toEqual(['protocol', 'repository', 'reply']);
    expect(p.text).toMatch(/^# RIAF agent prompt · pack pk-/);
    expect(p.text).toContain('> Fix ReadingDeduper.accept: it keeps the blurrier read');
    expect(p.text).toContain('How RIAF read it: **Bug fix');
    expect(p.text).toContain('Reproduce: find or write a test that fails');
    expect(p.text).toContain('`riaf_jump`');
    expect(p.text).toContain('- test: `pnpm test`');
    expect(p.text).toContain('Hard constraints (never break these):');
    expect(p.text).toContain('| explore | 40 / 80 | 120,000 / 250,000 | 30 |');
    expect(p.text).toContain(`## Context pack ${pack.packId}`);
    expect(p.text).toContain('Toll session is a hub');
    expect(p.text).toContain('- [ ] The test that reproduced the bug now passes');
    expect(p.promptId).toMatch(/^pr_/);
  });

  it('reports a consistent token plan from the settings', async () => {
    const { p, pack, blend } = await prompt('Fix ReadingDeduper.accept: it keeps the blurrier read');
    const t = p.plan;
    expect(t.usable).toBe(170_000);
    expect(t.packBudget).toBe(blend.pack);
    expect(t.packUsed).toBe(pack.tokensUsed);
    expect(t.output).toBe(8_192);
    expect(t.prompt).toBeGreaterThan(t.packUsed);
    expect(t.headroom).toBe(t.usable - t.prompt - t.output - t.reasoning);
    expect(t.cacheable).toBe(p.sections.filter((s) => s.cacheable).reduce((a, s) => a + s.tokens, 0));
    expect(Math.abs(t.prompt - estimateTokens(p.text)) / estimateTokens(p.text)).toBeLessThan(0.1);
    expect(t.summarizeAt).toBe(Math.round((170_000 - 8_192) * 0.6));
  });

  it('keeps the stable hash across tasks, gates plans for features and adapts tool hints to the host', async () => {
    const a = (await prompt('Fix ReadingDeduper.accept: it keeps the blurrier read')).p;
    const b = await prompt('Add a GET /disputes/next endpoint that returns the oldest open dispute', DEFAULT_TOKEN_SETTINGS, 'claude');
    expect(b.p.stableHash).toBe(a.stableHash);
    expect(b.p.plan.planGate).toBe(true);
    expect(b.p.text).toContain('**Plan gate:**');
    const c = await prompt('Fix ReadingDeduper.accept: it keeps the blurrier read', DEFAULT_TOKEN_SETTINGS, 'copilot');
    expect(c.p.text).toContain('#riafJump');
    expect(c.p.stableHash).not.toBe(a.stableHash);
  });

  it('splits multi-part tasks into stages and honours section caps and cache ordering', async () => {
    const multi = await prompt('Fix the null check in TollSession.close() and then add a config flag so ops can disable it');
    expect(multi.p.text).toMatch(/\*\*Stage 1 — /);
    const tight = { ...DEFAULT_TOKEN_SETTINGS, sections: { protocol: 120, plan: 120, notes: 0 }, cache: { stable_prefix: false, ttl: '5m' as const } };
    const t = await prompt('Fix ReadingDeduper.accept: it keeps the blurrier read', tight);
    expect(t.p.sections[0]!.id).toBe('task');
    expect(t.p.plan.cacheable).toBe(0);
    expect(t.p.sections.find((s) => s.id === 'protocol')!.tokens).toBeLessThanOrEqual(140);
    expect(t.p.text).toContain('trimmed to the 120-token section cap');
  });
});
