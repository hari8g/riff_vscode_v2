import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { leadingDoc, renderRunbook, RUNBOOK_MAX_LINES, Semantic } from '../src/index.js';

const FIX = resolve(__dirname, '../../../fixtures/repos');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
async function indexed(name: string) {
  const root = mkdtempSync(join(tmpdir(), `riaf-sem-${name}-`));
  dirs.push(root);
  cpSync(join(FIX, name), root, { recursive: true });
  const store = await Store.open();
  scanIntoStore(store, root);
  await runParseStage(store, { root });
  const graph = new Graph(store);
  graph.update();
  const sem = new Semantic(store, graph, name);
  sem.update();
  return { root, store, graph, sem };
}

describe('leadingDoc', () => {
  it('reads block, line and docstring comments but not includes or shebangs', () => {
    expect(leadingDoc('/** Run it. */\nexport const a = 1;')).toBe('Run it.');
    expect(leadingDoc('// One.\n// Two.\nx')).toBe('One. Two.');
    expect(leadingDoc('"""Vehicle telemetry."""\n')).toBe('Vehicle telemetry.');
    expect(leadingDoc('#include "a.h"\nint x;')).toBeUndefined();
  });
});

describe('Semantic on toll-ts', () => {
  it('builds file, directory and repo summaries and regenerates only the changed path', async () => {
    const { root, store, sem } = await indexed('toll-ts');
    expect(sem.summary('src/toll/session.ts')?.text).toMatch(/class TollSession — One vehicle passage/);
    expect(sem.summary('src/pricing/')?.text).toMatch(/engine\.ts — /);
    expect(sem.summary('')?.level).toBe('repo');
    const repoHash = sem.summary('')!.hash;
    const gantryHash = sem.summary('src/gantry/')!.hash;
    expect(sem.update().files).toBe(0);
    appendFileSync(join(root, 'src/pricing/peak.ts'), '\n// tweak\n');
    scanIntoStore(store, root);
    await runParseStage(store, { root });
    const r = sem.update();
    expect(r.files).toBe(1);
    expect(r.directories).toBe(3); // src/pricing, src, repo
    expect(sem.summary('')!.hash).not.toBe(repoHash);
    expect(sem.summary('src/gantry/')!.hash).toBe(gantryHash);
  });

  it('derives architecture, conventions, a ≤60-line run-book and wiki pages', async () => {
    const { sem } = await indexed('toll-ts');
    const a = sem.architecture();
    expect(a.commands.test).toBe('npm test');
    expect(a.frameworks).toContain('vitest');
    expect(a.languages['typescript']).toBeGreaterThan(20);
    const conv = sem.conventions();
    expect(conv.map((c) => c.text)).toEqual(expect.arrayContaining([expect.stringMatching(/typescript tests are `\*\.test\.ts` files under `test\/`/)]));
    const rb = sem.runbook('## Hard constraints\n- amounts are integer paise');
    expect(rb.split('\n').length).toBeLessThanOrEqual(RUNBOOK_MAX_LINES);
    expect(rb).toContain('- test: `npm test`');
    expect(rb).toContain('amounts are integer paise');
    const tree = sem.wikiStructure(2);
    expect(tree.children.map((c) => c.id)).toContain('src/');
    const page = sem.wikiPage('src/toll/session.ts');
    expect(page.symbols.map((s) => s.signature)).toContain('close(amountPaise: number): void');
    expect(sem.wikiPage('src/pricing').children.map((c) => c.id)).toContain('src/pricing/engine.ts');
  });

  it('per-language architecture: maven, pytest, cmake', async () => {
    expect((await indexed('fleet-java')).sem.architecture()).toMatchObject({ commands: { test: 'mvn -q test' }, frameworks: expect.arrayContaining(['maven', 'junit']) });
    expect((await indexed('telemetry-py')).sem.architecture().commands.test).toBe('pytest -q');
    expect((await indexed('embedded-c')).sem.architecture().frameworks).toEqual(expect.arrayContaining(['cmake', 'ctest']));
  });

  it('refuses a run-book whose fixed part exceeds 60 lines', () => {
    const arch = { packages: [], languages: {}, frameworks: [], commands: {}, entryPoints: [], generated: [], clusters: [], testLayout: [] };
    expect(() => renderRunbook({ repoName: 'x', architecture: arch, conventions: [], constraints: Array.from({ length: 70 }, (_, i) => `- rule ${i}`).join('\n') })).toThrow(/max 60/);
  });
});
