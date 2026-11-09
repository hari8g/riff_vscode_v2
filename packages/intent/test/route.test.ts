import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ComposedPolicySchema } from '@riaf/kernel';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { route, topIntent } from '../src/index.js';

const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const indexes = new Map<string, Promise<{ store: Store; graph: Graph }>>();
function indexed(repo: string) {
  if (!indexes.has(repo)) {
    indexes.set(repo, (async () => {
      const root = mkdtempSync(join(tmpdir(), `riaf-route-${repo}-`));
      dirs.push(root);
      cpSync(join(ROOT, 'fixtures/repos', repo), root, { recursive: true });
      const store = await Store.open();
      scanIntoStore(store, root);
      await runParseStage(store, { root });
      const graph = new Graph(store);
      graph.update();
      return { store, graph };
    })());
  }
  return indexes.get(repo)!;
}

interface TaskYaml { id: string; repo: string; intent: string; request: string; ide?: Record<string, unknown>; gold_files: string[]; setup?: unknown[] }
const tasks: TaskYaml[] = readdirSync(join(ROOT, 'fixtures/tasks')).sort().map((id) => parse(readFileSync(join(ROOT, 'fixtures/tasks', id, 'task.yaml'), 'utf8')) as TaskYaml);

describe('route on the eval task set (calibration)', () => {
  it('produces valid composed policies, classifies ≥ 90% of tasks correctly and grounds a gold file for ≥ 90%', async () => {
    let correct = 0;
    let grounded = 0;
    const rows: string[] = [];
    for (const t of tasks) {
      const { store, graph } = await indexed(t.repo);
      const r = await route({ text: t.request, ide: { ...(t.ide ?? {}), interactive: false } }, { store, graph });
      expect(ComposedPolicySchema.safeParse(r.policy).success, t.id).toBe(true);
      const top = topIntent(r.policy.w);
      if (top === t.intent) correct++;
      const paths = new Set(r.policy.anchors.map((a) => a.slice(0, a.indexOf('#'))));
      const hit = t.gold_files.some((g) => paths.has(g));
      if (hit) grounded++;
      rows.push(`${t.id} gold=${t.intent} top=${top} H=${r.policy.H.toFixed(2)} branch=${r.policy.branch} anchors=${[...paths].slice(0, 3).join(',')} hit=${hit}`);
    }
    if (process.env.RIAF_CALIBRATE) console.log(rows.join('\n')); // RIAF_CALIBRATE=1 prints the per-task table
    expect(correct / tasks.length).toBeGreaterThanOrEqual(0.9);
    expect(grounded / tasks.length).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it('a two-part request routes to a blend with two ordered stages', async () => {
    const { store, graph } = await indexed('toll-ts');
    const r = await route({ text: 'Fix the null check in TollSession.close() and then add a config flag in FeatureFlags so ops can disable it' }, { store, graph });
    expect(r.policy.units).toHaveLength(2);
    expect(r.policy.branch).toBe('blended');
    expect(r.policy.stages).toEqual([['u1'], ['u2']]);
    expect(r.policy.primitives.map((p) => p.intent).sort()).toEqual(['bugfix', 'feature']);
    expect(r.policy.anchors).toEqual(expect.arrayContaining(['src/toll/session.ts#TollSession.close@method', 'src/config/flags.ts#FeatureFlags@class']));
  });

  it('an unanchored vague request asks one question when interactive and goes generic when not', async () => {
    const { store, graph } = await indexed('toll-ts');
    const live = await route({ text: 'the session thing', ide: { interactive: true } }, { store, graph });
    expect(live.policy.branch).toBe('clarify');
    expect(live.policy.question?.options).toHaveLength(2);
    const batch = await route({ text: 'the session thing', ide: { interactive: false } }, { store, graph });
    expect(batch.policy.branch).toBe('generic');
  });
});
