import { describe, expect, it } from 'vitest';
import { areaName, composeAnswer, effortOf, findSubjects, humanize, parseQuestion, riskOf, stem, suggestFollowUps, type Evidence } from '../src/ask.js';

const AREAS = ['src/disputes/', 'src/pricing/', 'src/toll/'];

describe('parseQuestion', () => {
  it.each([
    ['How does a dispute get resolved?', 'explain'],
    ['What would be affected if we change TollSession?', 'impact'],
    ['What changed in pricing recently and why?', 'history'],
    ['Who knows the most about the ledger?', 'people'],
    ['We want to add a monthly pass discount. How big is that?', 'scope'],
    ['How well tested is plate validation?', 'quality'],
    ['What are the main areas of this product?', 'overview'],
  ] as const)('reads “%s” as %s', (q, lens) => {
    expect(parseQuestion(q, AREAS).primary).toBe(lens);
  });

  it('reports a distribution, entropy, spans and a blended reading', () => {
    const p = parseQuestion('What would be affected if we change TollSession in the last month?', AREAS);
    expect(Object.values(p.p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(p.H).toBeGreaterThan(0);
    expect(p.H).toBeLessThan(1);
    expect(p.reading).toBe('blended');
    expect(p.secondary).toBe('history');
    expect(p.spans.map((s) => p.text.slice(s.start, s.end))).toContain('affected');
    expect(p.timeframe).toEqual({ label: 'last month', days: 30 });
    expect(p.subjects).toEqual([{ text: 'TollSession', kind: 'code' }]);
  });

  it('marks a cue-less question unclear and lets a forced lens win', () => {
    const vague = parseQuestion('the session thing', AREAS);
    expect(vague.reading).toBe('unclear');
    const forced = parseQuestion('the session thing', AREAS, 'people');
    expect(forced.primary).toBe('people');
    expect(forced.reading).toBe('single');
  });
});

describe('subjects and wording', () => {
  it('finds code names, quoted phrases, areas and noun phrases', () => {
    const s = findSubjects('Can we add a "fleet account" to Ledger.post for the disputes team and frequent drivers?', AREAS);
    expect(s).toEqual(expect.arrayContaining([
      { text: 'fleet account', kind: 'quoted' },
      { text: 'Ledger.post', kind: 'code' },
      { text: 'Disputes', kind: 'area', area: 'src/disputes/' },
      { text: 'frequent drivers', kind: 'term', words: ['frequent', 'drivers'] },
    ]));
    expect(s.some((x) => x.text === 'Can' || x.text === 'add')).toBe(false);
  });

  it('stems, names areas and humanizes symbols', () => {
    expect(stem('disputes')).toBe(stem('dispute'));
    expect(stem('pricing')).toBe(stem('price'));
    expect('validateplate'.includes(stem('validation'))).toBe(true);
    expect(stem('pass')).toBe('pass');
    expect(areaName('src/fleet-accounts/')).toBe('Fleet accounts');
    expect(humanize('src/gantry/dedupe.ts#ReadingDeduper.accept@method')).toBe('Reading deduper › accept');
    expect(humanize('test/a.test.ts#TollSession > charges on close@test')).toBe('TollSession > charges on close');
  });
});

const EV: Evidence = {
  repo: { title: 'toll-ts', summary: 'Tolling.', areas: [{ id: 'src/toll/', name: 'Toll', files: 5 }, { id: 'src/api/', name: 'Api', files: 1 }] },
  subjects: [{ symbol: 'src/toll/session.ts#TollSession@class', path: 'src/toll/session.ts', line: 8, kind: 'class', doc: 'One vehicle passage through a gantry.', area: 'src/toll/', from: 'named' }],
  missing: [],
  areas: [],
  usedBy: [{ symbol: 'src/api/handlers.ts#ApiHandlers.close@method', path: 'src/api/handlers.ts', line: 3 }],
  impact: {
    closure: [
      { symbol: 'src/api/handlers.ts#ApiHandlers.close@method', distance: 1, via: '<-invokes' },
      { symbol: 'src/toll/store.ts#SessionStore.put@method', distance: 2, via: '<-defines_type' },
    ],
    tests: ['test/session.test.ts#@file', 'test/session.test.ts#TollSession > charges@test'],
    coChange: [],
  },
  history: {
    commits: [
      { commit: 'a'.repeat(40), at: '2025-01-23T21:00:00Z', author: 'Ben Okafor', summary: 'extend session', kind: 'feat', lines: 18 },
      { commit: 'b'.repeat(40), at: '2025-01-20T21:00:00Z', author: 'Asha Rao', summary: 'fix close', kind: 'fix', lines: 4 },
      { commit: 'c'.repeat(40), at: '2025-01-10T21:00:00Z', author: 'Ben Okafor', summary: 'session', kind: 'feat', lines: 30 },
    ],
    reverts: [{ commit: 'd'.repeat(40), reverted: 'b'.repeat(40), summary: 'Revert fix close' }],
    incidents: [],
    adrs: [{ path: 'docs/adr/0001.md', title: 'Charge on close', status: 'accepted', excerpt: 'We charge when the session closes.' }],
  },
};

describe('composeAnswer', () => {
  it('explains a component in plain words with its users and sources', () => {
    const a = composeAnswer(parseQuestion('How does TollSession work?', []), EV);
    expect(a.headline).toBe('Toll session is a component in the Toll area: one vehicle passage through a gantry.');
    expect(a.paragraphs[0]).toContain('used by Api handlers › close');
    expect(a.blocks.map((b) => b.kind)).toEqual(['flow', 'pieces']);
    expect(a.sources[0]).toMatchObject({ path: 'src/toll/session.ts', line: 8 });
    expect(a.confidence).toBe('high');
    expect(a.markdown).toContain('# How does TollSession work?');
  });

  it('shows reach, risk, history, people and follow-ups', () => {
    const impact = composeAnswer(parseQuestion('What breaks if we change TollSession?', []), EV);
    expect(impact.headline).toMatch(/^Changing Toll session would touch 2 other parts; the change risk is (low|medium|high)\.$/);
    const rings = impact.blocks.find((b) => b.kind === 'rings');
    expect(rings && rings.kind === 'rings' && rings.rings.map((r) => r.items.length)).toEqual([1, 1]);
    const history = composeAnswer(parseQuestion('Why was TollSession changed?', []), EV);
    const tl = history.blocks.find((b) => b.kind === 'timeline');
    expect(tl && tl.kind === 'timeline' && tl.items.map((i) => i.flag)).toEqual([undefined, 'reverted', undefined]);
    expect(tl && tl.kind === 'timeline' && tl.decisions[0]?.title).toBe('Charge on close');
    const people = composeAnswer(parseQuestion('Who owns TollSession?', []), EV);
    expect(people.headline).toBe('Ben Okafor knows Toll session best, with 2 changes (67% of the history).');
    expect(suggestFollowUps(['impact'], 'X').map((f) => f.lens)).toEqual(['explain', 'history', 'people', 'scope']);
  });

  it('scores risk and sizes a request, with a ticket brief', () => {
    const r = riskOf(EV);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
    expect(r.factors.map((f) => f.label)).toEqual(['Reach', 'Spread', 'Test gap', 'Instability']);
    const e = effortOf({ ...EV, unmatched: ['fleet account'] }, 'Add fleet accounts');
    expect(['S', 'M', 'L', 'XL']).toContain(e.size);
    expect(e.questions[0]).toContain('“fleet account” does not exist');
    expect(e.brief).toContain('## Acceptance criteria');
    expect(effortOf({ ...EV, unmatched: ['a', 'b', 'c', 'd', 'e'], impact: { ...EV.impact!, closure: [...Array(12)].map((_, i) => ({ symbol: `src/x${i}/a.ts#A${i}@class`, distance: 1, via: '' })) } }, 'x').size).not.toBe('S');
  });

  it('is honest when nothing matches', () => {
    const a = composeAnswer(parseQuestion('How does the FleetAccount work?', []), { ...EV, subjects: [], missing: ['FleetAccount'], usedBy: [] });
    expect(a.confidence).toBe('low');
    expect(a.paragraphs.join(' ')).toContain('I could not find “FleetAccount” in the code');
  });
});
