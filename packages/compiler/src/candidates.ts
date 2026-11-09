import { estimateTokens, hashBlob, type Intent, type PackItem, type SymbolId } from '@riaf/kernel';
import type { SymbolRecord } from '@riaf/store';
import { fileLines, sliceLines, type RepoView } from './view.js';

/** A pack item before selection: content in two fidelities (body and signature) and a score. */
export interface Candidate {
  key: string;
  tier: PackItem['tier'];
  kind: PackItem['kind'];
  path?: string;
  symbol?: SymbolId;
  startLine?: number;
  endLine?: number;
  commit?: string;
  virtual?: string;
  content: string;
  /** Cheaper fallback when the full content does not fit (a signature for a body). */
  fallback?: { kind: PackItem['kind']; content: string; endLine?: number };
  intent: Intent;
  rule: string;
  /** Weight of the selecting primitive in the composed policy. */
  weight: number;
  score: number;
  stage: number;
  bucket: string;
}

const LANG_BY_EXT: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', py: 'python', java: 'java', go: 'go', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml' };

/** Fenced-code language for a path. */
export function langOf(path: string | undefined): string {
  if (!path) return '';
  return LANG_BY_EXT[path.slice(path.lastIndexOf('.') + 1)] ?? '';
}

export const tokensOf = (text: string) => estimateTokens(text);
export const hashOf = (text: string) => hashBlob(text);

const BODY_KINDS = new Set(['function', 'method', 'constructor', 'test']);
const CONTAINER_KINDS = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'namespace']);

/** Caches file lines per compile. */
export class SourceCache {
  private readonly lines = new Map<string, string[]>();
  constructor(private readonly view: RepoView) {}
  of(path: string): string[] {
    let l = this.lines.get(path);
    if (!l) {
      l = fileLines(this.view.store, path);
      this.lines.set(path, l);
    }
    return l;
  }
}

/** The signature-only skeleton of a container or file: member signatures with first doc lines. */
export function skeleton(view: RepoView, parent: SymbolRecord | { id: SymbolId; path: string; kind: 'file' }, depth = 2): string {
  const lines: string[] = [];
  const walk = (id: SymbolId, d: number) => {
    for (const c of view.store.symbols.children(id)) {
      if (c.kind === 'test') continue;
      const doc = c.doc?.split('\n')[0];
      if (doc) lines.push(`${'  '.repeat(d)}/** ${doc} */`);
      lines.push(`${'  '.repeat(d)}${c.signature ?? `${c.kind} ${c.name}`}${CONTAINER_KINDS.has(c.kind) ? ' {' : ''}`);
      if (CONTAINER_KINDS.has(c.kind) && d < depth) {
        walk(c.id, d + 1);
        lines.push(`${'  '.repeat(d)}}`);
      }
    }
  };
  if (parent.kind !== 'file') {
    const p = parent as SymbolRecord;
    lines.push(`${p.signature ?? `${p.kind} ${p.name}`} {`);
    walk(p.id, 1);
    lines.push('}');
  } else walk(parent.id, 0);
  return lines.join('\n');
}

export interface MakeOpts {
  intent: Intent;
  rule: string;
  weight: number;
  score: number;
  stage: number;
  bucket: string;
  tier?: PackItem['tier'];
  /** Show the body when it is at most this many tokens, else a skeleton / signature. */
  maxBodyTokens?: number;
}

/** Builds the candidate for a symbol: body (functions, small classes) with a signature fallback. */
export function symbolCandidate(view: RepoView, src: SourceCache, s: SymbolRecord, o: MakeOpts): Candidate | undefined {
  const base = { intent: o.intent, rule: o.rule, weight: o.weight, score: o.score, stage: o.stage, bucket: o.bucket, tier: o.tier ?? 2, path: s.path, symbol: s.id };
  if (s.kind === 'file') {
    const lines = src.of(s.path);
    const full = lines.join('\n');
    const skel = skeleton(view, { id: s.id, path: s.path, kind: 'file' });
    const small = tokensOf(full) <= (o.maxBodyTokens ?? 700);
    return {
      ...base, key: `file:${s.path}`, kind: small ? 'body' : 'signature', startLine: 1, endLine: lines.length,
      content: small ? full : skel || full.split('\n').slice(0, 40).join('\n'),
      ...(small && skel ? { fallback: { kind: 'signature' as const, content: skel } } : {}),
    };
  }
  if (s.startLine === undefined || s.endLine === undefined) return undefined;
  const body = sliceLines(src.of(s.path), s.startLine, s.endLine);
  const sig = s.signature ?? `${s.kind} ${s.name}`;
  const doc = s.doc ? `/** ${s.doc.split('\n')[0]} */\n` : '';
  const kind: PackItem['kind'] = s.kind === 'test' ? 'test' : 'body';
  if (CONTAINER_KINDS.has(s.kind)) {
    const skel = skeleton(view, s);
    const fitsWhole = tokensOf(body) <= (o.maxBodyTokens ?? 700);
    return { ...base, key: `sym:${s.id}`, kind: fitsWhole ? kind : 'signature', startLine: s.startLine, endLine: s.endLine, content: fitsWhole ? body : skel, ...(fitsWhole ? { fallback: { kind: 'signature' as const, content: skel } } : {}) };
  }
  if (BODY_KINDS.has(s.kind) || tokensOf(body) <= 120) {
    return { ...base, key: `sym:${s.id}`, kind, startLine: s.startLine, endLine: s.endLine, content: body, fallback: { kind: 'signature', content: `${doc}${sig}`, endLine: s.startLine } };
  }
  return { ...base, key: `sym:${s.id}`, kind: 'signature', startLine: s.startLine, endLine: s.startLine, content: `${doc}${sig}` };
}

/** A snippet of ±`around` lines at a reference site (refactor and dispatch rules). */
export function siteCandidate(src: SourceCache, path: string, line: number, around: number, o: MakeOpts & { symbol?: SymbolId }): Candidate {
  const lines = src.of(path);
  const a = Math.max(1, line - around);
  const b = Math.min(lines.length, line + around);
  return { key: `site:${path}:${line}`, tier: o.tier ?? 2, kind: 'body', path, ...(o.symbol ? { symbol: o.symbol } : {}), startLine: a, endLine: b, content: sliceLines(lines, a, b), intent: o.intent, rule: o.rule, weight: o.weight, score: o.score, stage: o.stage, bucket: o.bucket };
}
