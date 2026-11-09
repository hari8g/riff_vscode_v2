import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ComposedPolicySchema, PoliciesFileSchema } from '@riaf/kernel';
import { classify, compose, decompose, DEFAULT_POLICIES, extractMentions, gate, normalizedEntropy, parseStackTrace, primitives, softmax, stagesOf, topIntent } from '../src/index.js';

describe('classifier and entropy', () => {
  it('reads clear requests as one intent with low entropy', () => {
    for (const [text, intent] of [
      ['fix the crash when closing a session', 'bugfix'],
      ['add a GET endpoint for disputes', 'feature'],
      ['rename Ledger.post to Ledger.record everywhere', 'refactor'],
      ['explain how pricing works', 'onboarding'],
      ['review this diff before I merge it', 'review'],
      ['resolve the merge conflict in session.ts', 'merge'],
    ] as const) {
      const w = classify({ text });
      expect(topIntent(w), text).toBe(intent);
    }
    const w = classify({ text: 'fix the crash, it is a bug' });
    expect(gate(w, normalizedEntropy(w), DEFAULT_POLICIES.router)).toBe('single');
  });

  it('treats IDE evidence and hints as strong signals and stays a distribution', () => {
    expect(topIntent(classify({ text: 'look at this', ide: { stackTrace: 'Error: x\n at f (a.ts:1:1)' } }))).toBe('bugfix');
    expect(topIntent(classify({ text: 'look at this', hint: 'review' }))).toBe('review');
    const w = classify({ text: 'hello' });
    expect(Object.values(w).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 9);
    expect(topIntent(w)).toBe('unknown');
    expect(gate(w, normalizedEntropy(w), DEFAULT_POLICIES.router)).toBe('probe');
  });

  it('normalised entropy is 0 for certainty and 1 for uniform', () => {
    expect(normalizedEntropy({ bugfix: 1 })).toBe(0);
    expect(normalizedEntropy(softmax({ bugfix: 0, feature: 0, merge: 0, review: 0, refactor: 0, onboarding: 0, unknown: 0 }))).toBeCloseTo(1, 6);
  });
});

describe('decompose', () => {
  it('splits clauses with their own strong cue and records order', () => {
    const u = decompose('Fix the null check in TollSession.close() and add a config flag so ops can disable it');
    expect(u.map((x) => x.text)).toEqual(['Fix the null check in TollSession.close()', 'add a config flag so ops can disable it']);
    const o = decompose('Rename Ledger.post to Ledger.record. Then add a test for record.');
    expect(o).toHaveLength(2);
    expect(o[1]!.dependsOn).toEqual(['u1']);
  });
  it('keeps context sentences with the clause they explain', () => {
    expect(decompose('Drivers passing at exactly 11:00 are charged the peak surcharge. The morning peak should end at 11.')).toHaveLength(1);
    expect(decompose('The receiver rejects our frames. The frame CRC must be sent big-endian.')).toHaveLength(1);
  });
});

describe('mentions and stack traces', () => {
  it('extracts identifiers, dotted names, calls and paths', () => {
    const m = extractMentions('decode() crashes; see `RingBuffer.push` and src/telemetry/codec.py, TELEMETRY_BUFFER, crc16_update');
    expect(m.paths).toEqual(['src/telemetry/codec.py']);
    expect(m.identifiers).toEqual(expect.arrayContaining(['decode', 'RingBuffer.push', 'TELEMETRY_BUFFER', 'crc16_update']));
  });
  it('parses JS and Python frames', () => {
    expect(parseStackTrace('Error: x\n    at Gantry.lane (src/gantry/gantry.ts:14:22)')).toEqual([{ path: 'src/gantry/gantry.ts', line: 14, fn: 'Gantry.lane' }]);
    expect(parseStackTrace('  File "src/telemetry/codec.py", line 33, in decode')).toEqual([{ path: 'src/telemetry/codec.py', line: 33, fn: 'decode' }]);
  });
});

describe('composer', () => {
  it('blends with p-floor, cap-before-blend, renormalised budget and stages', () => {
    const w = { bugfix: 0.5, feature: 0.4, refactor: 0.05, merge: 0.01, review: 0.01, onboarding: 0.01, unknown: 0.02 };
    expect(primitives(w, 'blended', 0.15)).toEqual([{ intent: 'bugfix', weight: 0.555556 }, { intent: 'feature', weight: 0.444444 }]);
    const units = [
      { id: 'u1', text: 'fix the null check', anchors: [], ungrounded: [], w, H: 0.5, dependsOn: [] },
      { id: 'u2', text: 'add a flag', anchors: [], ungrounded: [], w, H: 0.5, dependsOn: ['u1'] },
    ];
    const p = compose({ units, w, H: 0.5, branch: 'blended', anchors: [], question: null, policies: DEFAULT_POLICIES, policyVersion: 'test@1' });
    expect(ComposedPolicySchema.safeParse(p).success).toBe(true);
    expect(p.stages).toEqual([['u1'], ['u2']]);
    const exercising = p.expansion.find((r) => r.rule === 'exercising_test')!;
    expect(exercising.cap).toBeCloseTo(1, 4); // both primitives contribute: 0.5556 + 0.4444
    expect(p.expansion.find((r) => r.rule === 'callers')!.cap).toBeCloseTo(0.5556, 3);
    expect(Object.values(p.budget.variable).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(p.historyScope).toEqual(expect.arrayContaining(['blame_on_anchors', 'origin_commits_of_sibling']));
    expect(stagesOf([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toEqual([['a'], ['b']]);
  });

  it('built-in defaults equal the repository policies file', () => {
    const file = PoliciesFileSchema.parse(parse(readFileSync(resolve(__dirname, '../../../.riaf/policies.yaml'), 'utf8')));
    expect(DEFAULT_POLICIES).toEqual(file);
  });
});
