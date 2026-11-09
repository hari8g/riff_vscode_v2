import type { SymbolId } from '@riaf/kernel';
import type { EdgeRecord, Store } from '@riaf/store';

/**
 * Co-change from blame: two symbols co-change when the same (non-noise, focused) commit owns current
 * lines of both. Because blame maps commits onto today's code, the matrix needs no line tracking
 * across renames and moves. Pairs inside one file are skipped (trivially co-located); file-level
 * co-change comes from commit file lists over a sliding window.
 */

export interface CoChangeOptions {
  /** Commits touching more files than this are not "a change", they are a sweep. */
  maxFilesPerCommit?: number;
  minSupport?: number;
  minConfidence?: number;
  /** Most recent commits considered for file-level co-change. */
  window?: number;
}

export function recomputeCoChange(store: Store, opts: CoChangeOptions = {}): { symbolEdges: number; filePairs: number } {
  const maxFiles = opts.maxFilesPerCommit ?? 20;
  const minSupport = opts.minSupport ?? 2;
  const minConf = opts.minConfidence ?? 0.3;
  const focused = new Set(store.history.recent(opts.window ?? 500).filter((c) => c.files <= maxFiles && c.files > 0).map((c) => c.sha));

  // symbol level
  const index = store.history.blameIndex();
  const bySha = new Map<string, SymbolId[]>();
  const commitsOf = new Map<SymbolId, number>();
  for (const [sym, shas] of index) {
    let n = 0;
    for (const sha of shas) {
      if (!focused.has(sha)) continue;
      n++;
      const list = bySha.get(sha) ?? [];
      list.push(sym);
      bySha.set(sha, list);
    }
    if (n) commitsOf.set(sym, n);
  }
  const support = new Map<string, number>();
  const fileOf = (s: SymbolId) => s.slice(0, s.indexOf('#'));
  for (const syms of bySha.values()) {
    // only the innermost symbols: a class and its method owning the same lines would double count
    const leaves = syms.filter((s) => !syms.some((o) => o !== s && fileOf(o) === fileOf(s) && o.includes(`#${s.slice(s.indexOf('#') + 1, s.lastIndexOf('@'))}.`)));
    if (leaves.length > 40) continue;
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i]!;
        const b = leaves[j]!;
        if (fileOf(a) === fileOf(b)) continue;
        const k = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        support.set(k, (support.get(k) ?? 0) + 1);
      }
    }
  }
  const edges: EdgeRecord[] = [];
  for (const [k, n] of support) {
    if (n < minSupport) continue;
    const [a, b] = k.split('\u0000') as [SymbolId, SymbolId];
    const ca = n / (commitsOf.get(a) ?? n);
    const cb = n / (commitsOf.get(b) ?? n);
    if (ca >= minConf) edges.push({ src: a, dst: b, kind: 'co_changes', source: 'history', weight: n, confidence: Math.min(1, ca) });
    if (cb >= minConf) edges.push({ src: b, dst: a, kind: 'co_changes', source: 'history', weight: n, confidence: Math.min(1, cb) });
  }
  store.driver.transaction(() => {
    store.driver.run("DELETE FROM edge WHERE kind = 'co_changes' AND source = 'history'");
    store.edges.upsertMany(edges.filter((e) => store.symbols.get(e.src) && store.symbols.get(e.dst)));
  });

  // file level
  const fileSupport = new Map<string, number>();
  const fileCommits = new Map<string, number>();
  const known = new Set(store.merkle.paths());
  for (const sha of focused) {
    const files = store.history.filesOf(sha).map((f) => f.path).filter((p) => known.has(p));
    for (const f of files) fileCommits.set(f, (fileCommits.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
      const k = files[i]! < files[j]! ? `${files[i]}\u0000${files[j]}` : `${files[j]}\u0000${files[i]}`;
      fileSupport.set(k, (fileSupport.get(k) ?? 0) + 1);
    }
  }
  const rows: { a: string; b: string; support: number; confidence: number }[] = [];
  for (const [k, n] of fileSupport) {
    if (n < minSupport) continue;
    const [a, b] = k.split('\u0000') as [string, string];
    const ca = n / (fileCommits.get(a) ?? n);
    const cb = n / (fileCommits.get(b) ?? n);
    if (ca >= minConf) rows.push({ a, b, support: n, confidence: ca });
    if (cb >= minConf) rows.push({ a: b, b: a, support: n, confidence: cb });
  }
  store.history.replaceFileCoChange(rows);
  return { symbolEdges: edges.length, filePairs: rows.length };
}
