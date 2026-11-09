import { describe, expect, it } from 'vitest';
import { bench, BENCHMARKS, contextCost, DEFAULT_ASSUMPTIONS, live, MEASURED_REPLACED, project, reduction } from '../src/savings.js';

describe('savings model', () => {
  it('carries the frozen benchmark figures', () => {
    expect(BENCHMARKS.map((b) => b.id)).toEqual(['scripted', 'claude', 'riaf']);
    expect(bench('claude').usdPerTask).toBeCloseTo(0.233, 3);
    expect(reduction(bench('scripted').tokens, bench('riaf').tokens)).toBeCloseTo(0.494, 2);
    expect(MEASURED_REPLACED).toBeCloseTo(0.913, 2);
  });

  it('projects no saving when the pack replaces nothing beyond its own cost', () => {
    const p = project({ ...DEFAULT_ASSUMPTIONS, replaced: 0 });
    expect(p.riafTokens).toBeCloseTo(p.baselineTokens + bench('riaf').tokens, 0);
    expect(p.monthlySavedUsd).toBeLessThan(0);
  });

  it('saves more as more exploration calls are replaced, and scales with the team', () => {
    const half = project(DEFAULT_ASSUMPTIONS);
    const most = project({ ...DEFAULT_ASSUMPTIONS, replaced: 0.9 });
    expect(half.riafUsd).toBeLessThan(half.baselineUsd);
    expect(most.riafUsd).toBeLessThan(half.riafUsd);
    expect(half.tasksPerMonth).toBe(10 * 6 * 21);
    expect(project({ ...DEFAULT_ASSUMPTIONS, developers: 20 }).monthlySavedUsd).toBeCloseTo(half.monthlySavedUsd * 2, 6);
    expect(project({ ...DEFAULT_ASSUMPTIONS, replaced: 7 }).riafCalls).toBeCloseTo(1, 6);
  });

  it('prices context per model and reads live telemetry', () => {
    expect(contextCost(1_000_000)[0]).toEqual({ model: 'Claude Opus', usd: 15 });
    expect(live({ packs: 2, toolCalls: { total: 10, byDecision: { 'serve:index': 3, 'serve:cache': 1, block: 1 } } }))
      .toEqual({ packs: 2, governed: 10, served: 4, blocked: 1, callsAvoidedEst: 21 });
  });
});
