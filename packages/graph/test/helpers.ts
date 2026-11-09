import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanIntoStore, runParseStage } from '@riaf/parse';
import { Store } from '@riaf/store';
import { Graph } from '../src/graph.js';

export const FIXTURES = resolve(__dirname, '../../../fixtures/repos');
const made: string[] = [];

/** Copies a fixture repo to a temp dir (so tests may edit it). */
export function copyFixture(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `riaf-graph-${name}-`));
  made.push(d);
  cpSync(join(FIXTURES, name), d, { recursive: true });
  return d;
}

export function cleanup(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Scans, parses and builds the graph for `root` into a fresh in-memory store. */
export async function indexRepo(root: string): Promise<{ store: Store; graph: Graph }> {
  const store = await Store.open();
  scanIntoStore(store, root);
  await runParseStage(store, { root });
  const graph = new Graph(store);
  graph.update();
  return { store, graph };
}

/** Re-runs scan → parse → graph after edits. */
export async function reindex(store: Store, graph: Graph, root: string) {
  const scan = scanIntoStore(store, root);
  const parse = await runParseStage(store, { root });
  const g = graph.update();
  return { scan, parse, graph: g };
}
