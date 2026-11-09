import type { Store } from '@riaf/store';
import { compatible, edgeKindFor, GENERIC_MEMBER_NAMES } from './resolve.js';

/**
 * Reference-resolution rate, the M1 gate metric behind `riaf jump`: among references whose name is
 * defined somewhere in the repository with a compatible kind (i.e. resolvable in principle), the share
 * that the graph bound to a definition of that name. Generic member names (`get`, `push`…) are left
 * out: a name match on them is no evidence the call targets repository code.
 */

export interface ResolutionStats {
  /** References whose name has a compatible definition in the repo. */
  resolvable: number;
  resolved: number;
  rate: number;
  /** Up to 20 unresolved examples for diagnostics. */
  misses: { path: string; line: number; name: string; kind: string }[];
}

/** Computes the resolution rate over every stored reference. */
export function resolutionStats(store: Store): ResolutionStats {
  const defsByName = new Map<string, string[]>();
  for (const s of store.symbols.all()) {
    if (s.kind === 'file') continue;
    const list = defsByName.get(s.name) ?? [];
    list.push(s.kind);
    defsByName.set(s.name, list);
  }
  let resolvable = 0;
  let resolved = 0;
  const misses: ResolutionStats['misses'] = [];
  const paths = store.merkle.paths();
  for (const p of paths) {
    for (const r of store.refs.byPath(p)) {
      const kinds = defsByName.get(r.name);
      if (!kinds || !kinds.some((k) => compatible(r.kind, k as never)) || GENERIC_MEMBER_NAMES.has(r.name)) continue;
      resolvable++;
      const kind = edgeKindFor(r.kind);
      const hit = store.edges.outgoing(r.scopeId, kind).some((e) => {
        const at = e.dst.lastIndexOf('#');
        const q = e.dst.slice(at + 1, e.dst.lastIndexOf('@'));
        const name = q.slice(q.lastIndexOf('.') + 1).replace(/~\d+$/, '');
        return name === r.name;
      });
      if (hit) resolved++;
      else if (misses.length < 20) misses.push({ path: r.path, line: r.line, name: r.name, kind: r.kind });
    }
  }
  return { resolvable, resolved, rate: resolvable ? resolved / resolvable : 1, misses };
}
