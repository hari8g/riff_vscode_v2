import { describe, expect, it } from 'vitest';
import { hashBlob } from '@riaf/kernel';
import { Store } from '../src/index.js';
import { readFixture } from './helpers.js';

describe('MerkleIndex', () => {
  it('stage bitmaps: changedSince returns unprocessed blobs, markDone clears them, an edit re-queues one file', async () => {
    const store = await Store.open();
    const files = readFixture();
    store.merkle.upsertBlobs(files.map((f) => f.blob));

    const pending = store.merkle.changedSince('parse');
    expect(pending.length).toBe(files.length);
    store.merkle.markDone('parse', pending.map((b) => b.path));
    expect(store.merkle.changedSince('parse')).toEqual([]);

    // A second, independent stage still sees everything.
    expect(store.merkle.changedSince('graph').length).toBe(files.length);
    store.merkle.markDone('graph', files.map((f) => f.path));

    // Editing one file resets both stages for that file only.
    const session = files.find((f) => f.path.endsWith('session.ts'))!;
    store.merkle.upsertBlobs([{ ...session.blob, hash: hashBlob(session.content + '\n// edit') }]);
    expect(store.merkle.changedSince('parse').map((b) => b.path)).toEqual([session.path]);
    expect(store.merkle.changedSince('graph').map((b) => b.path)).toEqual([session.path]);

    expect(store.merkle.stages().sort()).toEqual(['graph', 'parse']);
    await store.close();
  });

  it('stage bits are persisted and stable', async () => {
    const store = await Store.open();
    const p = store.merkle.registerStage('parse');
    const g = store.merkle.registerStage('graph');
    expect(p).not.toBe(g);
    expect(store.merkle.registerStage('parse')).toBe(p);
    await store.close();
  });

  it('tree hashes: second recompute changes nothing, an edit changes the file\'s ancestors only', async () => {
    const store = await Store.open();
    const files = readFixture();
    store.merkle.upsertBlobs(files.map((f) => f.blob));
    const first = store.merkle.recomputeTrees();
    expect(first).toContain('');
    expect(first).toContain('src/toll');
    expect(store.merkle.recomputeTrees()).toEqual([]);

    const plate = files.find((f) => f.path === 'src/toll/plate.ts')!;
    store.merkle.upsertBlobs([{ ...plate.blob, hash: hashBlob('new plate') }]);
    const changed = store.merkle.recomputeTrees().sort();
    expect(changed).toEqual(['', 'src', 'src/toll']);
    expect(store.merkle.getTree('src/config')).toBeDefined();
    await store.close();
  });
});
