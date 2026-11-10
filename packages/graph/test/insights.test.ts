import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, copyFixture, indexRepo } from './helpers.js';

afterAll(cleanup);

describe('graph insights', () => {
  it('ranks hubs and tangled code, and finds untested hubs and unreferenced definitions on toll-ts', async () => {
    const { graph } = await indexRepo(copyFixture('toll-ts'));
    const r = graph.insights({ top: 5 });
    expect(r.totals.definitions).toBeGreaterThan(20);
    expect(r.totals.testedDefinitions).toBeGreaterThan(0);
    expect(r.hubs.length).toBe(5);
    expect(r.hubs[0]!.fanIn).toBeGreaterThanOrEqual(r.hubs[4]!.fanIn);
    expect(r.tangled[0]!.fanOut).toBeGreaterThanOrEqual(r.tangled.at(-1)!.fanOut);
    expect(r.hubs.every((h) => !/test/.test(h.path))).toBe(true);
    expect(r.untestedHubs.every((h) => h.fanIn >= 2 && h.tests === 0)).toBe(true);
    expect(r.unreferenced.every((u) => u.fanIn === 0 && u.tests === 0)).toBe(true);
    expect(r.cycles).toEqual([]);
  });

  it('detects an import cycle between files', async () => {
    const root = copyFixture('toll-ts');
    writeFileSync(join(root, 'src/util/a.ts'), "import { b } from './b';\nexport function a(): number { return b() + 1; }\n");
    writeFileSync(join(root, 'src/util/b.ts'), "import { a } from './a';\nexport function b(): number { return a() - 1; }\n");
    const { graph } = await indexRepo(root);
    expect(graph.insights().cycles).toContainEqual(['src/util/a.ts', 'src/util/b.ts']);
  });
});
