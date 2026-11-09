import { describe, expect, it } from 'vitest';
import { Store } from '../src/index.js';
import { longestLiteral, trigramsOf } from '../src/trigram.js';
import { lineChunks, readFixture } from './helpers.js';

describe('trigram helpers', () => {
  it('extracts lower-case trigrams without whitespace-spanning grams', () => {
    expect([...trigramsOf('Abc de')].sort()).toEqual(['abc']);
    expect(trigramsOf('ab').size).toBe(0);
  });

  it('finds the longest guaranteed literal in a regex', () => {
    expect(longestLiteral('validate\\w+Plate')).toBe('validate');
    expect(longestLiteral('isEnabled\\(')).toBe('isEnabled(');
    expect(longestLiteral('charge-on-close|strict')).toBe('charge-on-close');
    expect(longestLiteral('ab?cdef')).toBe('cdef');
  });
});

describe('TrigramIndex on the toll-ts fixture', () => {
  it('literal search returns exact lines with 1-based numbers', async () => {
    const store = await Store.open();
    for (const f of readFixture()) store.replaceChunksForPath(f.path, lineChunks(f));
    const hits = store.trigram.search('isEnabled(');
    expect(hits.map((h) => h.path).sort()).toEqual(['src/config/flags.ts', 'src/disputes/queue.ts', 'src/toll/session.ts']);
    const sessionHit = hits.find((h) => h.path === 'src/toll/session.ts')!;
    expect(sessionHit.text).toContain("this.flags.isEnabled('charge-on-close')");
    expect(sessionHit.line).toBeGreaterThan(20);
    expect(store.trigram.search('no-such-literal-xyz')).toEqual([]);
    await store.close();
  });

  it('regex search uses the literal prefilter and confirms with a real regex', async () => {
    const store = await Store.open();
    for (const f of readFixture()) store.replaceChunksForPath(f.path, lineChunks(f));
    const hits = store.trigram.searchRegex('export (function|class) \\w+Plate');
    expect(hits.map((h) => h.text)).toEqual(expect.arrayContaining([expect.stringContaining('validatePlate'), expect.stringContaining('normalizePlate')]));
    expect(hits.every((h) => h.path === 'src/toll/plate.ts')).toBe(true);
    await store.close();
  });
});
