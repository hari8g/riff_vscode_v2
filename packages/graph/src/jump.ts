import { parseSymbolId, type SymbolId } from '@riaf/kernel';
import type { Store, SymbolRecord } from '@riaf/store';

/**
 * Symbol lookup for riaf jump: accepts a full symbol id, `path:line`, a qualified name
 * (`TollSession.close`) or a bare name, and returns the definition with its references.
 */

export interface JumpReference {
  symbol: SymbolId;
  path: string;
  line: number;
  kind: string;
  confidence: number;
}

export interface JumpResult {
  definition?: SymbolRecord;
  /** Other definitions matching an ambiguous query, best first. */
  alternatives: SymbolRecord[];
  references: JumpReference[];
}

const RANK: Record<string, number> = { class: 0, interface: 0, struct: 0, enum: 1, type: 1, function: 2, method: 2, constructor: 3, property: 4, field: 4, constant: 4, variable: 5, test: 6 };

/** Finds symbols matching `query` (id, path:line, qualified name, or name), best first. */
export function findSymbols(store: Store, query: string, limit = 10): SymbolRecord[] {
  const q = query.trim();
  if (!q) return [];
  if (parseSymbolId(q)) {
    const s = store.symbols.get(q as SymbolId);
    if (s) return [s];
  }
  const pl = /^(.+?):(\d+)$/.exec(q);
  if (pl) {
    const s = store.symbols.atLine(pl[1]!, Number(pl[2]));
    if (s) return [s];
    const f = store.symbols.byPath(pl[1]!).find((x) => x.kind === 'file');
    return f ? [f] : [];
  }
  const byQ = store.symbols.byQualifiedName(q, limit);
  const name = q.includes('.') ? q.slice(q.lastIndexOf('.') + 1) : q;
  const byN = byQ.length ? [] : store.symbols.byName(name, 200).filter((s) => !q.includes('.') || s.qualifiedName.endsWith(q));
  const list = [...byQ, ...byN];
  if (list.length === 0) return store.symbols.searchName(q, limit).filter((s) => s.kind !== 'file');
  return list
    .sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.path.length - b.path.length || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

/** Resolves `query` and lists every reference into the definition (incoming non-structural edges). */
export function jump(store: Store, query: string): JumpResult {
  const found = findSymbols(store, query);
  const definition = found[0];
  if (!definition) return { alternatives: [], references: [] };
  const refs: JumpReference[] = [];
  const seen = new Set<string>();
  for (const e of store.edges.incoming(definition.id)) {
    if (e.kind === 'contains' || e.kind === 'co_changes') continue;
    const site = store.symbols.get(e.src);
    if (!site) continue;
    // the line of the reference: the matching tag_ref in the source scope, else the scope start
    const tag = store.refs.byScope(e.src).find((r) => r.name === definition.name);
    const line = tag?.line ?? site.startLine ?? 1;
    const key = `${e.src}:${line}:${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ symbol: e.src, path: site.path, line, kind: e.source === 'lsp' ? `${e.kind}(lsp)` : e.kind, confidence: e.confidence });
  }
  refs.sort((a, b) => b.confidence - a.confidence || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  return { definition, alternatives: found.slice(1), references: refs };
}
