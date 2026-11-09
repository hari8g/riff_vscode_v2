import { hashBlob, type SymbolId } from '@riaf/kernel';
import type { Store } from '@riaf/store';

/** ADRs and post-mortems, linked to the symbols and files they mention. */

export const ADR_PATH = /(^|\/)(docs\/)?(adr|adrs|decisions|architecture\/decisions)\/[^/]+\.md$|(^|\/)(postmortems?|incidents)\/[^/]+\.md$|postmortem[^/]*\.md$/i;

/** Title and status of an ADR document. */
export function parseAdr(text: string): { title: string; status: string } {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? 'Untitled decision';
  const status = /\*\*Status:\*\*\s*([A-Za-z-]+)|^Status:\s*([A-Za-z-]+)/im.exec(text);
  return { title, status: (status?.[1] ?? status?.[2] ?? 'unknown').toLowerCase() };
}

/** Symbols an ADR mentions: back-ticked or identifier-shaped names and file paths that exist. */
export function adrMentions(store: Store, text: string): SymbolId[] {
  const out = new Set<SymbolId>();
  const known = new Set(store.merkle.paths());
  for (const m of text.matchAll(/`([^`]+)`|\b([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*(?:\.[A-Za-z_]\w*)?|[a-z]+[A-Z][A-Za-z0-9]*|[a-z0-9]+_[a-z0-9_]+)\b|((?:[\w.-]+\/)+[\w.-]+\.\w+)/g)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\(\)$/, '');
    if (!raw) continue;
    if (known.has(raw)) {
      out.add(`${raw}#@file` as SymbolId);
      continue;
    }
    const q = store.symbols.byQualifiedName(raw, 3);
    const hits = q.length ? q : raw.includes('.') ? [] : store.symbols.byName(raw, 6);
    if (hits.length && hits.length <= 3) for (const h of hits) if (h.kind !== 'file') out.add(h.id);
  }
  return [...out];
}

/** Ingests changed ADR files (by content hash) and drops removed ones. */
export function ingestAdrs(store: Store, readText: (path: string) => string | undefined): number {
  let n = 0;
  const paths = store.merkle.paths().filter((p) => ADR_PATH.test(p));
  for (const p of paths) {
    const text = readText(p);
    if (text === undefined) continue;
    const hash = hashBlob(text);
    if (store.history.adrHash(p) === hash) continue;
    const { title, status } = parseAdr(text);
    store.history.upsertAdr({ path: p, title, status, hash, text: text.slice(0, 4000) }, adrMentions(store, text));
    n++;
  }
  const keep = new Set(paths);
  for (const p of store.history.adrPaths()) if (!keep.has(p)) store.history.deleteAdr(p);
  return n;
}
