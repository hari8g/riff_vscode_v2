import { fileId, type IdeState, type SymbolId } from '@riaf/kernel';
import type { Store, SymbolRecord } from '@riaf/store';

/**
 * Anchors: the symbols a request is about. Extracted from the text (identifiers, dotted names, calls,
 * paths, back-ticked code) and from IDE state (stack-trace frames, failing tests, selection, active
 * file, diff), then grounded against the symbol table. When too little grounds, a full-text search
 * over the unit supplies `issue_terms` anchors.
 */

export type AnchorSource = 'stack_trace' | 'failing_test' | 'selection' | 'identifier' | 'path' | 'active_file' | 'diff' | 'issue_terms';

export interface GroundedAnchor {
  symbol: SymbolId;
  source: AnchorSource;
  /** Confidence that the request is about this symbol, in (0, 1]. */
  confidence: number;
  mention?: string;
}

export interface Mentions {
  identifiers: string[];
  paths: string[];
}

const SOURCE_CONFIDENCE: Record<AnchorSource, number> = {
  stack_trace: 1, failing_test: 0.9, identifier: 0.9, selection: 0.85, path: 0.8, diff: 0.7, active_file: 0.5, issue_terms: 0.5,
};
const PATH_RE = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]{1,5}|[\w-]+\.(?:ts|tsx|js|py|java|go|c|h|cpp|hpp|cs))(?=[\s`'"),:;]|$)/g;
const IDENT_RE = /`([^`]+)`|\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b|\b([A-Za-z_][A-Za-z0-9_]*)\s*\(|\b([a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z0-9]+_[a-z0-9_]+|[A-Z][A-Z0-9_]{3,})\b/g;
const NOT_CODE = new Set(['e.g', 'i.e', 'etc']);

/** Pulls identifier-like and path-like mentions out of free text. */
export function extractMentions(text: string): Mentions {
  const paths = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) paths.add(m[1]!);
  const identifiers = new Set<string>();
  for (const m of text.matchAll(IDENT_RE)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/\(\)$/, '');
    if (!raw || NOT_CODE.has(raw) || paths.has(raw) || /\.(ts|py|java|c|h|go|js|cs)$/.test(raw)) continue;
    if (/^\d/.test(raw)) continue;
    identifiers.add(raw);
  }
  return { identifiers: [...identifiers], paths: [...paths] };
}

const RANK: Record<string, number> = { method: 0, function: 0, constructor: 1, class: 1, interface: 2, struct: 1, enum: 2, type: 3, property: 4, field: 4, constant: 4, variable: 5, test: 6, file: 7 };

function bestOf(list: readonly SymbolRecord[], max: number): SymbolRecord[] {
  return [...list].sort((a, b) => (RANK[a.kind] ?? 8) - (RANK[b.kind] ?? 8) || a.path.length - b.path.length).slice(0, max);
}

/** Grounds one identifier mention: exact qualified name, then dotted suffix, then bare name. */
export function groundIdentifier(store: Store, mention: string): SymbolRecord[] {
  const q = store.symbols.byQualifiedName(mention, 10);
  if (q.length) return bestOf(q.filter((s) => s.kind !== 'file'), 3);
  if (mention.includes('.')) {
    const last = mention.slice(mention.lastIndexOf('.') + 1);
    const byLast = store.symbols.byName(last, 100).filter((s) => s.qualifiedName.endsWith(mention) || s.qualifiedName.endsWith(`.${last}`) && mention.split('.').slice(-2, -1)[0] === s.qualifiedName.split('.').slice(-2, -1)[0]);
    if (byLast.length) return bestOf(byLast, 3);
    // `Ledger.post`: first segment may be the owner
    const owner = mention.split('.')[0]!;
    const own = store.symbols.byName(owner, 20).filter((s) => s.kind !== 'file');
    if (own.length) return bestOf(own, 2);
    return [];
  }
  const exact = store.symbols.byName(mention, 50).filter((s) => s.kind !== 'file');
  return exact.length > 6 ? [] : bestOf(exact, 3); // a name defined everywhere is not an anchor
}

/** Stack-trace frames as (path, line) for JS/TS, Python, Java, C# and Go traces. */
export function parseStackTrace(trace: string): { path: string; line: number; fn?: string }[] {
  const out: { path: string; line: number; fn?: string }[] = [];
  for (const m of trace.matchAll(/at (?:([\w.$<>]+) )?\(?((?:[\w.-]+\/)*[\w.-]+\.\w+):(\d+)(?::\d+)?\)?/g)) out.push({ path: m[2]!, line: Number(m[3]), ...(m[1] ? { fn: m[1] } : {}) });
  for (const m of trace.matchAll(/File "([^"]+)", line (\d+)(?:, in (\w+))?/g)) out.push({ path: m[1]!, line: Number(m[2]), ...(m[3] ? { fn: m[3] } : {}) });
  for (const m of trace.matchAll(/\s((?:[\w.-]+\/)+[\w.-]+\.go):(\d+)/g)) out.push({ path: m[1]!, line: Number(m[2]) });
  return out;
}

const WORD_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'should', 'instead', 'being', 'into', 'than', 'then', 'have', 'there', 'they', 'them', 'every', 'which', 'would', 'about', 'after', 'before', 'fix', 'add', 'make', 'must', 'only', 'also', 'more', 'some', 'what', 'where']);

/** Splits an identifier into lower-case words (camelCase, snake_case, digits). */
export function identifierWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 2);
}

/**
 * Symbols whose every name word is mentioned in the text (compared on 5-letter prefixes, so
 * `plate normalisation` covers `normalizePlate`). A cheap, exact signal for symptom-style reports.
 */
export function nameCoverage(store: Store, text: string, max = 3): SymbolRecord[] {
  const words = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !WORD_STOP.has(w)) words.add(w.slice(0, 5));
  if (words.size === 0) return [];
  const scored: { s: SymbolRecord; score: number }[] = [];
  for (const s of store.symbols.all(['function', 'method', 'class', 'interface', 'struct', 'enum', 'type'])) {
    const parts = identifierWords(s.name).filter((w) => w.length >= 3);
    if (parts.length === 0) continue;
    const covered = parts.filter((w) => words.has(w.slice(0, 5))).length;
    if (covered === parts.length && (parts.length >= 2 || parts[0]!.length >= 6)) scored.push({ s, score: parts.length + (s.kind === 'function' || s.kind === 'method' ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.s.path.length - b.s.path.length).slice(0, max).map((x) => x.s);
}

export interface GroundResult {
  anchors: GroundedAnchor[];
  ungrounded: string[];
}

/** Grounds the mentions of `text` plus IDE state against the store. */
export function groundAnchors(store: Store, text: string, ide: Partial<IdeState> = {}, opts: { minAnchors?: number } = {}): GroundResult {
  const found = new Map<SymbolId, GroundedAnchor>();
  const add = (symbol: SymbolId, source: AnchorSource, mention?: string, conf = SOURCE_CONFIDENCE[source]) => {
    const prev = found.get(symbol);
    if (!prev || prev.confidence < conf) found.set(symbol, { symbol, source, confidence: conf, ...(mention ? { mention } : {}) });
  };
  const known = (p: string) => store.merkle.getBlob(p) !== undefined;
  const ungrounded: string[] = [];
  for (const f of parseStackTrace(ide.stackTrace ?? '')) {
    const path = known(f.path) ? f.path : store.merkle.paths().find((p) => p.endsWith(`/${f.path}`) || p.endsWith(f.path));
    if (!path) continue;
    const s = store.symbols.atLine(path, f.line);
    if (s) add(s.id, 'stack_trace', `${path}:${f.line}`);
    else add(fileId(path), 'stack_trace', path, 0.8);
  }
  for (const t of ide.failingTests ?? []) {
    const [path, name] = t.split('::');
    if (path && known(path)) {
      const sym = name ? store.symbols.byPath(path).find((s) => s.name === name || s.qualifiedName.endsWith(name)) : undefined;
      add(sym?.id ?? fileId(path), 'failing_test', t);
    }
  }
  if (ide.selection && known(ide.selection.path)) {
    const s = store.symbols.atLine(ide.selection.path, ide.selection.startLine + 1);
    if (s) add(s.id, 'selection');
  }
  for (const p of ide.diffFiles ?? []) if (known(p)) add(fileId(p), 'diff', p);
  const m = extractMentions(text);
  for (const p of m.paths) {
    const path = known(p) ? p : store.merkle.paths().find((x) => x.endsWith(`/${p}`));
    if (path) add(fileId(path), 'path', p);
    else ungrounded.push(p);
  }
  for (const id of m.identifiers) {
    const hits = groundIdentifier(store, id);
    // a bare field or property name (`sessionId`) is weak evidence of what the request is about
    const weak = (h: SymbolRecord) => !id.includes('.') && ['property', 'field', 'variable', 'constant'].includes(h.kind);
    if (hits.length) for (const h of hits) add(h.id, 'identifier', id, (weak(h) ? 0.45 : SOURCE_CONFIDENCE.identifier) / Math.max(1, hits.length - 0.5));
    else ungrounded.push(id);
  }
  if (ide.activeFile && known(ide.activeFile)) add(fileId(ide.activeFile), 'active_file', ide.activeFile);
  // a fully covered multi-word name is strong evidence; a single covered word is only a hint
  for (const s of nameCoverage(store, text)) add(s.id, 'issue_terms', s.name, identifierWords(s.name).length >= 2 ? 0.75 : 0.45);
  // too little grounded: full-text search over the unit supplies issue-term anchors
  // too little grounded, or the request names things that do not exist yet (where would they go?):
  // a full-text search over the unit supplies issue-term anchors
  const strong = [...found.values()].filter((a) => a.confidence >= 0.6).length;
  const newNames = ungrounded.some((u) => /^[A-Za-z_]\w*$/.test(u));
  if (strong < (opts.minAnchors ?? 1) || newNames) {
    const seen = new Set<string>();
    const query = text.replace(/"[^"]*"|'[^']*'/g, ' ');
    for (const hit of store.fts.search(query, 12, { prefix: 6, mode: 'or' })) {
      if (seen.size >= 4) break;
      const chunk = store.chunks.get(hit.chunkId);
      if (!chunk || seen.has(chunk.path) || /(^|\/)(test|tests)\/|README|\.md$/i.test(chunk.path)) continue;
      seen.add(chunk.path);
      const inChunk = store.symbols.byPath(chunk.path).filter((s) => s.kind !== 'file' && (s.startLine ?? 0) >= chunk.startLine && (s.startLine ?? 0) <= chunk.endLine);
      const pick = inChunk.find((s) => s.kind === 'function' || s.kind === 'method') ?? inChunk[0];
      add(pick?.id ?? fileId(chunk.path), 'issue_terms', chunk.path, SOURCE_CONFIDENCE.issue_terms * (1 - seen.size * 0.08));
    }
  }
  const anchors = [...found.values()].sort((a, b) => b.confidence - a.confidence || (a.symbol < b.symbol ? -1 : 1));
  return { anchors, ungrounded };
}
