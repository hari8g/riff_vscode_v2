import type { CommitRecord, Store } from '@riaf/store';

/**
 * Change hotspots and ownership from the mined git history (noise commits excluded):
 * recency-weighted churn per file and per directory, fix share, the authors behind each, and a
 * bus factor (how few people account for more than half of the changes).
 */

export interface Owner {
  author: string;
  commits: number;
  /** Share of the non-noise commits touching the target. */
  share: number;
  lastAt: string;
}

export interface Hotspot {
  path: string;
  commits: number;
  /** Lines added plus deleted. */
  churn: number;
  /** Churn weighted by recency (half-life `halfLifeDays`), the ranking score. */
  heat: number;
  /** Share of the commits that were fixes or incidents. */
  fixShare: number;
  authors: number;
  /** Fewest authors whose commits exceed half of the total. 1 means knowledge sits with one person. */
  busFactor: number;
  owners: Owner[];
  firstAt: string;
  lastAt: string;
}

export interface HotspotOptions {
  /** Most recent commits to consider (default 2000). */
  window?: number;
  /** Recency half-life in days, measured back from the newest commit (default 90). */
  halfLifeDays?: number;
  /** Limit the result to paths under this prefix. */
  under?: string;
  /** Group by directory instead of file. */
  byDirectory?: boolean;
  top?: number;
  /** Include documentation and lock files (default false: they churn without carrying risk). */
  includeDocs?: boolean;
}

interface Acc { commits: Set<string>; churn: number; heat: number; fixes: number; by: Map<string, { n: number; last: string }>; first: string; last: string }

const FIX_KINDS = new Set(['fix', 'incident', 'revert']);
/** Documentation, lock and changelog files: high churn, no code risk. */
const DOC_FILE = /(^|\/)(readme|changelog|changes|license|notice|authors|contributing)(\.[a-z]+)?$|\.(md|mdx|txt|rst|adoc|lock|log)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|cargo\.lock|go\.sum|poetry\.lock)$/i;
const dirOf = (p: string) => (p.includes('/') ? `${p.slice(0, p.lastIndexOf('/'))}/` : './');

/** Ranks files (or directories) by recency-weighted churn, with ownership. */
export function hotspots(store: Store, opts: HotspotOptions = {}): Hotspot[] {
  const commits = store.history.recent(opts.window ?? 2000);
  if (!commits.length) return [];
  const newest = Date.parse(commits[0]!.at);
  const halfLife = (opts.halfLifeDays ?? 90) * 86_400_000;
  const acc = new Map<string, Acc>();
  for (const c of commits) {
    const decay = Math.pow(0.5, Math.max(0, newest - Date.parse(c.at)) / halfLife);
    const seen = new Set<string>();
    for (const f of store.history.filesOf(c.sha)) {
      if (!opts.includeDocs && DOC_FILE.test(f.path)) continue;
      const key = opts.byDirectory ? dirOf(f.path) : f.path;
      if (opts.under && !key.startsWith(opts.under)) continue;
      const a = acc.get(key) ?? { commits: new Set(), churn: 0, heat: 0, fixes: 0, by: new Map(), first: c.at, last: c.at };
      const lines = f.added + f.deleted;
      a.churn += lines;
      a.heat += decay * (1 + Math.log2(1 + lines));
      if (!seen.has(key)) {
        seen.add(key);
        a.commits.add(c.sha);
        if (FIX_KINDS.has(c.kind)) a.fixes++;
        bump(a.by, c);
        if (c.at < a.first) a.first = c.at;
        if (c.at > a.last) a.last = c.at;
      }
      acc.set(key, a);
    }
  }
  return [...acc.entries()].map(([path, a]) => toHotspot(path, a)).sort((x, y) => y.heat - x.heat || y.commits - x.commits || x.path.localeCompare(y.path)).slice(0, opts.top ?? 20);
}

/** Who has changed a file or directory, by share of commits, with the bus factor. */
export function ownership(store: Store, path: string, window = 2000): { owners: Owner[]; busFactor: number; commits: number } {
  const by = new Map<string, { n: number; last: string }>();
  let n = 0;
  for (const c of store.history.recent(window)) {
    if (!store.history.filesOf(c.sha).some((f) => f.path === path || f.path.startsWith(path.endsWith('/') ? path : `${path}/`))) continue;
    n++;
    bump(by, c);
  }
  const owners = ownersOf(by, n);
  return { owners, busFactor: busFactor(owners), commits: n };
}

function bump(by: Map<string, { n: number; last: string }>, c: CommitRecord) {
  const o = by.get(c.author) ?? { n: 0, last: c.at };
  o.n++;
  if (c.at > o.last) o.last = c.at;
  by.set(c.author, o);
}

function ownersOf(by: Map<string, { n: number; last: string }>, total: number): Owner[] {
  return [...by.entries()].map(([author, o]) => ({ author, commits: o.n, share: total ? o.n / total : 0, lastAt: o.last }))
    .sort((a, b) => b.commits - a.commits || b.lastAt.localeCompare(a.lastAt));
}

/** Fewest owners whose combined share is more than half. */
export function busFactor(owners: readonly Owner[]): number {
  let sum = 0;
  for (const [i, o] of owners.entries()) {
    sum += o.share;
    if (sum > 0.5) return i + 1;
  }
  return owners.length;
}

function toHotspot(path: string, a: Acc): Hotspot {
  const owners = ownersOf(a.by, a.commits.size);
  return {
    path, commits: a.commits.size, churn: a.churn, heat: Math.round(a.heat * 100) / 100, fixShare: a.commits.size ? a.fixes / a.commits.size : 0,
    authors: owners.length, busFactor: busFactor(owners), owners: owners.slice(0, 5), firstAt: a.first, lastAt: a.last,
  };
}
