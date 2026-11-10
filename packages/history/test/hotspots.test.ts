import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { busFactor } from '../src/hotspots.js';
import { History } from '../src/history.js';

const REPO = resolve(__dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'riaf-hotspots-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('hotspots and ownership on the synthetic toll-ts history', () => {
  const root = join(tmp, 'toll-ts');
  let history: History;
  beforeAll(async () => {
    await promisify(execFile)(process.execPath, [join(REPO, 'tooling/scripts/make-fixture-history.mjs'), 'toll-ts', root]);
    const store = await Store.open();
    scanIntoStore(store, root);
    await runParseStage(store, { root });
    new Graph(store).update();
    history = new History(store);
    await history.update({ root });
  }, 120_000);

  it('ranks files by recency-weighted churn with owners and a bus factor', () => {
    const h = history.hotspots({ top: 8 });
    expect(h.length).toBe(8);
    for (let i = 1; i < h.length; i++) expect(h[i - 1]!.heat).toBeGreaterThanOrEqual(h[i]!.heat);
    for (const x of h) {
      expect(x.commits).toBeGreaterThan(0);
      expect(x.owners.reduce((a, o) => a + o.share, 0)).toBeLessThanOrEqual(1.0001);
      expect(x.busFactor).toBeGreaterThanOrEqual(1);
      expect(x.busFactor).toBeLessThanOrEqual(x.authors);
      expect(x.fixShare).toBeGreaterThanOrEqual(0);
      expect(x.lastAt >= x.firstAt).toBe(true);
    }
  });

  it('groups by directory, filters by prefix and answers ownership for a path', () => {
    expect(history.hotspots({ top: 50 }).some((h) => /readme|\.md$/i.test(h.path))).toBe(false);
    expect(history.hotspots({ top: 50, includeDocs: true }).some((h) => /readme/i.test(h.path))).toBe(true);
    const dirs = history.hotspots({ byDirectory: true });
    expect(dirs.every((d) => d.path.endsWith('/'))).toBe(true);
    expect(history.hotspots({ under: 'src/toll/' }).every((h) => h.path.startsWith('src/toll/'))).toBe(true);
    const o = history.ownership('src/toll');
    expect(o.commits).toBeGreaterThan(0);
    expect(o.owners[0]!.commits).toBeGreaterThanOrEqual(o.owners.at(-1)!.commits);
  });

  it('computes the bus factor as the fewest owners covering more than half', () => {
    const o = (share: number) => ({ author: String(share), commits: 1, share, lastAt: '' });
    expect(busFactor([o(0.6), o(0.4)])).toBe(1);
    expect(busFactor([o(0.3), o(0.3), o(0.2), o(0.2)])).toBe(2);
    expect(busFactor([])).toBe(0);
  });
});
