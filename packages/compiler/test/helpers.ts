import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Semantic } from '@riaf/semantic';
import { Store } from '@riaf/store';
import type { RepoView } from '../src/view.js';

export const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
export const cleanup = () => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
const cache = new Map<string, Promise<RepoView>>();

/** Indexed fixture (scan → parse → graph → summaries) as a RepoView, cached per repo. */
export function repoView(repo: string): Promise<RepoView> {
  if (!cache.has(repo)) {
    cache.set(repo, (async () => {
      const root = mkdtempSync(join(tmpdir(), `riaf-comp-${repo}-`));
      dirs.push(root);
      cpSync(join(ROOT, 'fixtures/repos', repo), root, { recursive: true });
      const store = await Store.open();
      scanIntoStore(store, root);
      await runParseStage(store, { root });
      const graph = new Graph(store);
      graph.update();
      const semantic = new Semantic(store, graph, repo);
      semantic.update();
      return { repoName: repo, store, graph, semantic };
    })());
  }
  return cache.get(repo)!;
}

export interface TaskYaml { id: string; repo: string; intent: string; request: string; ide?: Record<string, unknown>; gold_files: string[] }
export const TASKS: TaskYaml[] = readdirSync(join(ROOT, 'fixtures/tasks')).sort().map((id) => parse(readFileSync(join(ROOT, 'fixtures/tasks', id, 'task.yaml'), 'utf8')) as TaskYaml);
