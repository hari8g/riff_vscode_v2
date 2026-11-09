import type { GraphView } from './view.js';

/**
 * Architectural clusters by weighted label propagation over the file graph (files linked by the
 * symbol edges between them and by imports). Deterministic: nodes are visited in path order and
 * ties go to the lexicographically smallest label. Each cluster is named after its members' common
 * directory, or their dominant directory when they share none.
 */

export interface Cluster {
  id: number;
  name: string;
  files: string[];
}

function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0]!;
  let n = 0;
  while (n < first.length && split.every((s) => s[n] === first[n])) n++;
  return first.slice(0, n).join('/');
}

function dominantDir(paths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const d = p.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '.';
}

/** Runs label propagation on the file graph and returns clusters, largest first. */
export function clusters(view: GraphView, iterations = 20): Cluster[] {
  const files = new Map<string, number>();
  const names: string[] = [];
  for (const s of view.symbols) {
    if (s.kind === 'file' && !files.has(s.path)) {
      files.set(s.path, names.length);
      names.push(s.path);
    }
  }
  const n = names.length;
  const w: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let a = 0; a < view.size; a++) {
    const fa = files.get(view.symbols[a]!.path);
    if (fa === undefined) continue;
    for (const e of view.out[a]!) {
      if (e.kind === 'tests') continue; // tests should not glue clusters together
      const fb = files.get(view.symbols[e.to]!.path);
      if (fb === undefined || fb === fa) continue;
      const add = e.kind === 'imports' ? 2 : 1;
      w[fa]!.set(fb, (w[fa]!.get(fb) ?? 0) + add);
      w[fb]!.set(fa, (w[fb]!.get(fa) ?? 0) + add);
    }
  }
  // seed labels by directory so isolated files stay with their neighbours on disk
  const dirLabel = new Map<string, number>();
  const label = names.map((p, i) => {
    const d = p.split('/').slice(0, -1).join('/');
    if (!dirLabel.has(d)) dirLabel.set(d, i);
    return w[i]!.size ? i : dirLabel.get(d)!;
  });
  const order = names.map((_, i) => i).sort((a, b) => (names[a]! < names[b]! ? -1 : 1));
  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (const i of order) {
      if (w[i]!.size === 0) continue;
      const score = new Map<number, number>();
      for (const [j, wt] of w[i]!) score.set(label[j]!, (score.get(label[j]!) ?? 0) + wt);
      let best = label[i]!;
      let bestScore = score.get(best) ?? 0;
      for (const [l, sc] of score) {
        if (sc > bestScore || (sc === bestScore && l < best)) {
          best = l;
          bestScore = sc;
        }
      }
      if (best !== label[i]) {
        label[i] = best;
        changed++;
      }
    }
    if (changed === 0) break;
  }
  const groups = new Map<number, string[]>();
  names.forEach((p, i) => {
    const g = groups.get(label[i]!) ?? [];
    g.push(p);
    groups.set(label[i]!, g);
  });
  const out = [...groups.values()]
    .map((fs) => fs.sort())
    .sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1))
    .map((fs, id) => ({ id, name: commonDir(fs) || dominantDir(fs), files: fs }));
  return out;
}
