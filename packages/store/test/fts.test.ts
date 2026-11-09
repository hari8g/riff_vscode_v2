import { describe, expect, it } from 'vitest';
import { Store } from '../src/index.js';
import { buildFtsQuery, splitIdentifier, tokenizeForFts } from '../src/identifiers.js';
import { lineChunks, readFixture } from './helpers.js';

describe('identifier splitting', () => {
  it('splits camelCase, PascalCase, snake_case and digits, keeping the whole identifier', () => {
    expect(splitIdentifier('TollSession')).toEqual(['tollsession', 'toll', 'session']);
    expect(splitIdentifier('validate_plate')).toEqual(['validate_plate', 'validate', 'plate']);
    expect(splitIdentifier('HTTPServer2')).toEqual(['httpserver2', 'http', 'server', '2']);
    expect(splitIdentifier('x')).toEqual([]);
  });

  it('tokenises code lines and builds AND / OR match expressions', () => {
    expect(tokenizeForFts('this.ledger.post(this.id, amountPaise)')).toEqual(
      expect.arrayContaining(['ledger', 'post', 'amountpaise', 'amount', 'paise']),
    );
    expect(buildFtsQuery('retry logic for ledger')).toBe('"retry" AND "logic" AND "for" AND "ledger"');
    expect(buildFtsQuery('retry ledger', 'or')).toBe('"retry" OR "ledger"');
    expect(buildFtsQuery('')).toBeUndefined();
  });
});

describe('FtsIndex on the toll-ts fixture', () => {
  it('indexes chunks and answers identifier-aware queries under 20 ms', async () => {
    const store = await Store.open();
    const files = readFixture();
    for (const f of files) store.replaceChunksForPath(f.path, lineChunks(f));
    expect(store.fts.count()).toBeGreaterThan(0);

    // Gate on warm latency (median of 5 after one warm-up), so a cold statement prepare or a busy
    // CI worker running other test files in parallel does not make the gate flaky.
    store.fts.search('warm up');
    const times: number[] = [];
    let hits = store.fts.search('validate plate checksum');
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      hits = store.fts.search('validate plate checksum');
      times.push(performance.now() - t0);
    }
    const ms = times.sort((a, b) => a - b)[2]!;
    expect(ms).toBeLessThan(20);
    expect(hits[0]?.path).toBe('src/toll/plate.ts');

    // Identifier query written in a different case convention still finds the symbol.
    expect(store.fts.search('toll_session').some((h) => h.path === 'src/toll/session.ts')).toBe(true);
    expect(store.fts.search('ledger retry').some((h) => h.path === 'src/toll/ledger.ts')).toBe(true);
    // OR fallback: a query with one absent word still returns results.
    expect(store.fts.search('zzzzunknown featureflags').some((h) => h.path === 'src/config/flags.ts')).toBe(true);
    expect(store.fts.search('qqq zzz')).toEqual([]);
    await store.close();
  });

  it('replacing a file\'s chunks removes stale hits', async () => {
    const store = await Store.open();
    const files = readFixture();
    const plate = files.find((f) => f.path === 'src/toll/plate.ts')!;
    store.replaceChunksForPath(plate.path, lineChunks(plate));
    expect(store.fts.search('checksum').length).toBeGreaterThan(0);
    store.replaceChunksForPath(plate.path, [{ id: 'src/toll/plate.ts:1', path: plate.path, startLine: 1, endLine: 1, blobHash: plate.blob.hash, tokens: 2, content: 'export {};' }]);
    expect(store.fts.search('checksum')).toEqual([]);
    await store.close();
  });
});
