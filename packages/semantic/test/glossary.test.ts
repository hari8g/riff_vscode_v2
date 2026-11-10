import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { lookupTerms, Semantic, splitIdentifier, stemWord } from '../src/index.js';

const FIX = resolve(__dirname, '../../../fixtures/repos');
const root = mkdtempSync(join(tmpdir(), 'riaf-glossary-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let sem: Semantic;
beforeAll(async () => {
  cpSync(join(FIX, 'toll-ts'), root, { recursive: true });
  const store = await Store.open();
  scanIntoStore(store, root);
  await runParseStage(store, { root });
  const graph = new Graph(store);
  graph.update();
  sem = new Semantic(store, graph, 'toll-ts');
  sem.update();
});

describe('domain glossary', () => {
  it('splits identifiers and stems words', () => {
    expect(splitIdentifier('validatePlate')).toEqual(['validate', 'plate']);
    expect(splitIdentifier('MIN_CONFIDENCE')).toEqual(['min', 'confidence']);
    expect(splitIdentifier('HTTPResponse')).toEqual(['http', 'response']);
    expect(stemWord('disputes')).toBe(stemWord('dispute'));
  });

  it('mines domain terms with definitions, areas and meanings, without generic words', () => {
    const g = sem.glossary(80);
    const terms = g.map((t) => t.term);
    for (const t of ['plate', 'dispute', 'ledger', 'gantry', 'session']) expect(terms).toContain(t);
    for (const t of ['get', 'value', 'test', 'data']) expect(terms).not.toContain(t);
    const plate = g.find((t) => t.term === 'plate')!;
    expect(plate.defines.some((d) => d.includes('#Plate@') || d.includes('#plateChecksum@'))).toBe(true);
    expect(plate.areas.length).toBeGreaterThanOrEqual(1);
    const session = g.find((t) => t.term === 'session')!;
    expect(session.meaning).toMatch(/passage/i);
    for (let i = 1; i < g.length; i++) expect(g[i - 1]!.score).toBeGreaterThanOrEqual(g[i]!.score);
  });

  it('maps plain-language phrases onto terms', () => {
    expect(sem.terms('plate validation').map((t) => t.term)).toEqual(expect.arrayContaining(['plate', 'validate']));
    expect(sem.terms('open disputes').map((t) => t.term)).toContain('dispute');
    expect(lookupTerms([], 'anything')).toEqual([]);
  });
});
