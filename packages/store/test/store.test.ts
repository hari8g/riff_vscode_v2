import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashBlob, symbolId } from '@riaf/kernel';
import { Store, CURRENT_SCHEMA_VERSION, MIGRATIONS, migrate } from '../src/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'riaf-store-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('Store (wasm driver)', () => {
  it('opens in memory, applies all migrations once, and is idempotent', async () => {
    const store = await Store.open();
    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(store.isCurrent).toBe(true);
    expect(migrate(store.driver)).toEqual([]); // nothing pending
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6]);
    await store.close();
  });

  it('round-trips 10,000 blobs quickly and reports changes correctly', async () => {
    const store = await Store.open();
    const blobs = Array.from({ length: 10_000 }, (_, i) => ({
      path: `src/mod${i % 50}/file${i}.ts`,
      hash: hashBlob(`content ${i}`),
      size: 100 + i,
      mtimeMs: 1_700_000_000_000 + i,
      lang: 'typescript',
    }));
    const t0 = performance.now();
    const first = store.merkle.upsertBlobs(blobs);
    const ms = performance.now() - t0;
    expect(first.added.length).toBe(10_000);
    expect(store.merkle.countBlobs()).toBe(10_000);
    expect(ms).toBeLessThan(15_000);

    const again = store.merkle.upsertBlobs(blobs);
    expect(again.added).toEqual([]);
    expect(again.changed).toEqual([]);
    expect(again.unchanged).toBe(10_000);

    const edited = { ...blobs[7]!, hash: hashBlob('changed') };
    const third = store.merkle.upsertBlobs([edited]);
    expect(third.changed).toEqual([edited.path]);
    expect(store.merkle.getBlob(edited.path)?.hash).toBe(edited.hash);
    await store.close();
  });

  it('persists to disk and reloads with the same data', async () => {
    const path = join(tmp, 'index.sqlite');
    const a = await Store.open({ path });
    a.kv.set('hello', 'world');
    a.symbols.upsertMany([{ id: symbolId('src/a.ts', 'A.run', 'method'), kind: 'method', name: 'run', qualifiedName: 'A.run', path: 'src/a.ts', blobHash: hashBlob('x') }]);
    await a.persist();
    await a.close();
    expect(existsSync(path)).toBe(true);

    const b = await Store.open({ path });
    expect(b.kv.get('hello')).toBe('world');
    expect(b.symbols.byPath('src/a.ts').map((s) => s.qualifiedName)).toEqual(['A.run']);
    expect(b.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    await b.close();
  });

  it('transactions roll back on error', async () => {
    const store = await Store.open();
    expect(() =>
      store.driver.transaction(() => {
        store.kv.set('k', 'v');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.kv.get('k')).toBeUndefined();
    await store.close();
  });

  it('symbol and edge repositories upsert, query and delete by path', async () => {
    const store = await Store.open();
    const a = symbolId('src/a.ts', 'A.run', 'method');
    const b = symbolId('src/b.ts', 'helper', 'function');
    store.symbols.upsertMany([
      { id: a, kind: 'method', name: 'run', qualifiedName: 'A.run', path: 'src/a.ts', startLine: 3, endLine: 9, blobHash: hashBlob('a'), signature: 'run(): void' },
      { id: b, kind: 'function', name: 'helper', qualifiedName: 'helper', path: 'src/b.ts', blobHash: hashBlob('b') },
    ]);
    store.edges.upsertMany([{ src: a, dst: b, kind: 'invokes', confidence: 0.9 }]);
    expect(store.edges.outgoing(a, 'invokes').map((e) => e.dst)).toEqual([b]);
    expect(store.edges.incoming(b)[0]?.confidence).toBe(0.9);
    expect(store.symbols.searchName('help').map((s) => s.name)).toEqual(['helper']);
    expect(store.symbols.get(a)?.signature).toBe('run(): void');

    store.removePath('src/a.ts');
    expect(store.symbols.get(a)).toBeUndefined();
    expect(store.edges.incoming(b)).toEqual([]);
    expect(store.stats().symbols).toBe(1);
    await store.close();
  });
});

describe('Store refs, imports and path-scoped edges (migration 0004)', () => {
  it('replaces refs and imports per path and deletes only outgoing edges of a path', async () => {
    const { Store } = await import('../src/store.js');
    const { symbolId } = await import('@riaf/kernel');
    const store = await Store.open();
    const a = symbolId('src/a.ts', 'run', 'function');
    const b = symbolId('src/b.ts', 'helper', 'function');
    store.symbols.upsertMany([
      { id: a, kind: 'function', name: 'run', qualifiedName: 'run', path: 'src/a.ts', startLine: 1, endLine: 3, blobHash: 'h1' },
      { id: b, kind: 'function', name: 'helper', qualifiedName: 'helper', path: 'src/b.ts', startLine: 1, endLine: 9, blobHash: 'h2' },
    ]);
    store.refs.replaceForPath('src/a.ts', [{ path: 'src/a.ts', scopeId: a, name: 'helper', kind: 'call', line: 2 }]);
    store.refs.replaceForPath('src/a.ts', [{ path: 'src/a.ts', scopeId: a, name: 'helper', kind: 'call', line: 3 }]);
    expect(store.refs.byName('helper').map((r) => r.line)).toEqual([3]);
    store.imports.replaceForPath('src/a.ts', [{ path: 'src/a.ts', spec: './b', line: 1, lang: 'typescript', resolved: 'src/b.ts' }, { path: 'src/a.ts', spec: 'zod', line: 2, lang: 'typescript' }]);
    expect(store.imports.importersOf('src/b.ts')).toEqual(['src/a.ts']);
    expect(store.imports.pathsNeedingResolution(new Set(['src/a.ts', 'src/b.ts']))).toEqual(['src/a.ts']);
    store.edges.upsertMany([{ src: a, dst: b, kind: 'invokes' }, { src: b, dst: a, kind: 'invokes' }]);
    expect(store.edges.deleteOutgoingFromPath('src/b.ts')).toBe(1);
    expect(store.edges.incomingToPath('src/b.ts').map((e) => e.src)).toEqual([a]);
    expect(store.symbols.atLine('src/b.ts', 4)?.id).toBe(b);
    store.removePath('src/a.ts');
    expect(store.refs.count()).toBe(0);
    expect(store.imports.count()).toBe(0);
    await store.close();
  });
});

describe('summaries and compile log (migration 0005)', () => {
  it('caches summaries by node and logs routes and packs', async () => {
    const { Store } = await import('../src/store.js');
    const store = await Store.open();
    store.summaries.upsert({ nodeId: 'src/a.ts', level: 'file', hash: 'h1', text: 'A.', model: 'extractive' });
    store.summaries.upsert({ nodeId: 'src/a.ts', level: 'file', hash: 'h2', text: 'A2.', model: 'extractive' });
    expect(store.summaries.get('src/a.ts')?.hash).toBe('h2');
    store.summaries.upsert({ nodeId: 'src/', level: 'directory', hash: 't', text: 'dir', model: 'extractive' });
    expect(store.summaries.prune(new Set(['src/']))).toBe(1);
    store.compileLog.recordRoute({ routeId: 'r1', text: 'fix x', branch: 'single', H: 0.2, w: { bugfix: 1 }, json: '{}', createdAt: '2026-01-01T00:00:00Z' });
    store.compileLog.recordPack({ packId: 'p1', routeId: 'r1', createdAt: '2026-01-01T00:00:01Z', budget: 100, tokensUsed: 10, policyVersion: 'v', json: '{"packId":"p1"}', items: [{ itemId: 'i1', tier: 2, kind: 'body', path: 'src/a.ts', intent: 'bugfix', rule: 'anchor', score: 1, tokens: 10 }] });
    store.compileLog.recordPack({ packId: 'p2', createdAt: '2026-01-01T00:00:02Z', budget: 100, tokensUsed: 5, policyVersion: 'v', json: '{"packId":"p2"}', items: [] });
    expect(store.compileLog.pack()).toBe('{"packId":"p2"}');
    expect(store.compileLog.pack('p1')).toBe('{"packId":"p1"}');
    expect(store.compileLog.branchCounts()).toEqual({ single: 1 });
    await store.close();
  });
});

describe('wasm persistence', () => {
  it('serialises concurrent persists to the same file', async () => {
    const { Store } = await import('../src/store.js');
    const { mkdtempSync, rmSync, existsSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'riaf-persist-'));
    try {
      const store = await Store.open({ path: join(dir, 'index.sqlite') });
      store.kv.set('k', 'v');
      await Promise.all([store.persist(), store.persist(), store.persist()]);
      expect(existsSync(join(dir, 'index.sqlite'))).toBe(true);
      expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
      await store.close();
      const again = await Store.open({ path: join(dir, 'index.sqlite') });
      expect(again.kv.get('k')).toBe('v');
      await again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
