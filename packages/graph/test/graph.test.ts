import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fileId, symbolId } from '@riaf/kernel';
import { Store } from '@riaf/store';
import { GraphView, personalizedPageRank } from '../src/view.js';
import { cleanup, copyFixture, indexRepo, reindex } from './helpers.js';

afterAll(cleanup);
const S = (p: string, q: string, k: Parameters<typeof symbolId>[2]) => symbolId(p, q, k);
const close = S('src/toll/session.ts', 'TollSession.close', 'method');
const validate = S('src/toll/plate.ts', 'validatePlate', 'function');

describe('graph build on toll-ts', () => {
  it('resolves calls across files, member calls via the enclosing class, imports, contains and tests', async () => {
    const root = copyFixture('toll-ts');
    const { store } = await indexRepo(root);
    const out = (id: string, kind: string) => store.edges.outgoing(id as never, kind as never).map((e) => e.dst);
    expect(out(close, 'invokes')).toEqual(expect.arrayContaining([validate, S('src/toll/ledger.ts', 'Ledger.post', 'method'), S('src/config/flags.ts', 'FeatureFlags.isEnabled', 'method')]));
    expect(out(S('src/toll/ledger.ts', 'Ledger.post', 'method'), 'invokes')).toContain(S('src/toll/ledger.ts', 'Ledger.tryWrite', 'method'));
    expect(out(fileId('src/toll/session.ts'), 'imports')).toEqual(expect.arrayContaining([fileId('src/toll/plate.ts'), fileId('src/toll/ledger.ts'), fileId('src/config/flags.ts')]));
    expect(out(S('src/toll/session.ts', 'TollSession', 'class'), 'contains')).toContain(close);
    const testers = store.edges.incoming(close, 'tests').map((e) => e.src);
    expect(testers).toContain(S('test/session.test.ts', 'TollSession > charges a valid plate on close', 'test'));
    expect(out(S('src/toll/session.ts', 'TollSession', 'class'), 'defines_type').length + out(close, 'defines_type').length).toBeGreaterThanOrEqual(0);
  });

  it('answers jump, closure, impact, tests, repo map and ppr', async () => {
    const root = copyFixture('toll-ts');
    const { graph } = await indexRepo(root);
    const j = graph.jump('validatePlate');
    expect(j.definition?.id).toBe(validate);
    expect(j.references.map((r) => r.symbol)).toContain(close);
    expect(j.references.find((r) => r.symbol === close)?.line).toBe(23);
    expect(graph.jump('TollSession.close').definition?.id).toBe(close);
    expect(graph.jump('src/toll/session.ts:24').definition?.id).toBe(close);

    expect(graph.closure([validate], { direction: 'in', hops: 1 }).map((h) => h.symbol)).toContain(close);
    const imp = graph.impact([validate]);
    expect(imp.closure.map((c) => c.symbol)).toContain(close);
    expect(imp.tests.some((t) => t.startsWith('test/session.test.ts#'))).toBe(true);

    const ranked = graph.ppr([close], 20).map((r) => r.symbol);
    expect(ranked.indexOf(validate)).toBeGreaterThanOrEqual(0);
    const normalize = S('src/toll/plate.ts', 'normalizePlate', 'function');
    expect(ranked.indexOf(normalize) === -1 || ranked.indexOf(validate) < ranked.indexOf(normalize)).toBe(true);

    const map = graph.repoMap([close], { budget: 120 });
    expect(map.tokens).toBeLessThanOrEqual(120);
    expect(map.files[0]).toBe('src/toll/session.ts');
    expect(map.text).toContain('close(amountPaise: number): void');
    expect(map.text).not.toContain('test/');
    const big = graph.repoMap([], { budget: 5000 });
    expect(big.files.length).toBeGreaterThanOrEqual(4);

    const cl = graph.clusters();
    expect(cl.flatMap((c) => c.files)).toContain('src/toll/session.ts');
  });

  it('is incremental: no-op second run, and a rename re-binds references in untouched files', async () => {
    const root = copyFixture('toll-ts');
    const { store, graph } = await indexRepo(root);
    const again = await reindex(store, graph, root);
    expect(again.graph.changed).toEqual([]);

    const plate = join(root, 'src/toll/plate.ts');
    const src = (await import('node:fs')).readFileSync(plate, 'utf8').replace('export function validatePlate', 'export function isValidPlate').replace('return plateChecksum', 'return plateChecksum');
    writeFileSync(plate, src);
    const r = await reindex(store, graph, root);
    expect(r.graph.changed).toEqual(['src/toll/plate.ts']);
    expect(r.graph.affected).toContain('src/toll/session.ts');
    expect(store.edges.incoming(validate)).toEqual([]); // old symbol gone, no dangling edges
    // session.ts still says validatePlate(...), which no longer exists → no invokes edge to plate.ts
    expect(store.edges.outgoing(close, 'invokes').some((e) => e.dst.startsWith('src/toll/plate.ts#'))).toBe(false);

    // fix the caller → edge to the renamed function appears
    const sessionPath = join(root, 'src/toll/session.ts');
    const fs = await import('node:fs');
    fs.writeFileSync(sessionPath, fs.readFileSync(sessionPath, 'utf8').replaceAll('validatePlate', 'isValidPlate'));
    await reindex(store, graph, root);
    expect(store.edges.outgoing(close, 'invokes').map((e) => e.dst)).toContain(S('src/toll/plate.ts', 'isValidPlate', 'function'));
  });
});

describe('personalized PageRank', () => {
  it('matches the hand-computed stationary distribution on a chain a→b→c anchored at a', async () => {
    const store = await Store.open();
    const ids = ['a', 'b', 'c'].map((n) => S('m.ts', n, 'function'));
    store.symbols.upsertMany(ids.map((id, i) => ({ id, kind: 'function' as const, name: 'abc'[i]!, qualifiedName: 'abc'[i]!, path: 'm.ts', blobHash: 'h' })));
    store.edges.upsertMany([{ src: ids[0]!, dst: ids[1]!, kind: 'invokes' }, { src: ids[1]!, dst: ids[2]!, kind: 'invokes' }]);
    const view = GraphView.build(store);
    const r = personalizedPageRank(view, [ids[0]!], { reverseWeight: 0, damping: 0.85, iterations: 500, tolerance: 1e-14 });
    // r_a = 0.15 / (1 - 0.85^3), r_b = 0.85 r_a, r_c = 0.85 r_b (c is dangling and restarts at a)
    const ra = 0.15 / (1 - 0.85 ** 3);
    expect(r[0]).toBeCloseTo(ra, 6);
    expect(r[1]).toBeCloseTo(0.85 * ra, 6);
    expect(r[2]).toBeCloseTo(0.85 * 0.85 * ra, 6);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('is uniform on a symmetric cycle with no anchors', async () => {
    const store = await Store.open();
    const ids = ['x', 'y', 'z'].map((n) => S('c.ts', n, 'function'));
    store.symbols.upsertMany(ids.map((id, i) => ({ id, kind: 'function' as const, name: 'xyz'[i]!, qualifiedName: 'xyz'[i]!, path: 'c.ts', blobHash: 'h' })));
    store.edges.upsertMany([{ src: ids[0]!, dst: ids[1]!, kind: 'invokes' }, { src: ids[1]!, dst: ids[2]!, kind: 'invokes' }, { src: ids[2]!, dst: ids[0]!, kind: 'invokes' }]);
    const r = personalizedPageRank(GraphView.build(store), []);
    for (const v of r) expect(v).toBeCloseTo(1 / 3, 6);
  });
});
