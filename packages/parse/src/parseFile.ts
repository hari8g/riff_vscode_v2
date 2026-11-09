import { estimateTokens, fileId, symbolId, type SymbolId } from '@riaf/kernel';
import type { ChunkRecord, ImportRecord, RefRecord, SymbolRecord } from '@riaf/store';
import { chunkFile, DEFAULT_CHUNK_TOKENS, type Chunk } from './chunker.js';
import { resolveImport, type ResolverContext } from './imports.js';
import { languageOf, type LanguageId } from './languages.js';
import { extractTags, type DefTag, type ImportTag, type RefTag } from './treesitter/tags.js';

export interface ParsedFile {
  path: string;
  lang?: LanguageId;
  defs: DefTag[];
  refs: RefTag[];
  imports: ImportTag[];
  chunks: Chunk[];
  hasErrors: boolean;
}

export interface ParseFileOptions {
  maxChunkTokens?: number;
}

/** Chunks a non-code text file on blank-line boundaries under the token cap. */
export function chunkText(path: string, source: string, maxTokens = DEFAULT_CHUNK_TOKENS): Chunk[] {
  const lines = source.split('\n');
  const out: Chunk[] = [];
  let start = 0;
  let acc: string[] = [];
  const flush = (end: number) => {
    let a = start;
    let b = end;
    while (a < b && lines[a]!.trim() === '') a++;
    while (b > a && lines[b]!.trim() === '') b--;
    const content = lines.slice(a, b + 1).join('\n');
    if (content.trim()) out.push({ id: `${path}:${a + 1}`, startLine: a + 1, endLine: b + 1, tokens: estimateTokens(content), content, symbols: [] });
  };
  for (let i = 0; i < lines.length; i++) {
    acc.push(lines[i]!);
    const atBreak = lines[i]!.trim() === '' || i === lines.length - 1;
    if (atBreak && estimateTokens(acc.join('\n')) >= maxTokens * 0.75) {
      flush(i);
      start = i + 1;
      acc = [];
    } else if (estimateTokens(acc.join('\n')) > maxTokens * 1.5) {
      flush(i);
      start = i + 1;
      acc = [];
    }
  }
  if (acc.length) flush(lines.length - 1);
  return out;
}

/** Parses one file: tags (when the language is supported), chunks, imports. */
export async function parseFile(path: string, source: string, opts: ParseFileOptions = {}): Promise<ParsedFile> {
  const lang = languageOf(path);
  const max = opts.maxChunkTokens ?? DEFAULT_CHUNK_TOKENS;
  if (!lang) return { path, defs: [], refs: [], imports: [], chunks: chunkText(path, source, max), hasErrors: false };
  const tags = await extractTags(lang, path, source);
  return { path, lang, ...tags, chunks: chunkFile(path, source, tags.defs, { maxTokens: max }) };
}

export interface FileRecords {
  symbols: SymbolRecord[];
  chunks: ChunkRecord[];
  refs: RefRecord[];
  imports: ImportRecord[];
}

/** Converts a parsed file into store records. `resolver` resolves imports; omit to store them unresolved. */
export function toRecords(parsed: ParsedFile, blobHash: string, resolver?: ResolverContext): FileRecords {
  const { path } = parsed;
  const file = fileId(path);
  const base = path.slice(path.lastIndexOf('/') + 1);
  const symbols: SymbolRecord[] = [{ id: file, kind: 'file', name: base, qualifiedName: '', path, startLine: 1, endLine: Math.max(1, parsed.chunks.at(-1)?.endLine ?? 1), blobHash }];
  const ids = new Map<DefTag, SymbolId>();
  for (const d of parsed.defs) ids.set(d, symbolId(path, d.qualifiedName, d.kind));
  const parentOf = (d: DefTag): SymbolId => {
    if (!d.parent) return file;
    let best: DefTag | undefined;
    for (const p of parsed.defs) {
      if (p.qualifiedName === d.parent && p.startIndex <= d.startIndex && p.endIndex >= d.endIndex && p !== d) {
        if (!best || p.startIndex >= best.startIndex) best = p;
      }
    }
    return best ? ids.get(best)! : file;
  };
  for (const d of parsed.defs) {
    symbols.push({
      id: ids.get(d)!, kind: d.kind, name: d.name, qualifiedName: d.qualifiedName, path,
      startLine: d.startLine, endLine: d.endLine, blobHash, signature: d.signature,
      ...(d.doc ? { doc: d.doc } : {}), parentId: parentOf(d),
    });
  }
  const scopeId = new Map<string, SymbolId>();
  for (const d of parsed.defs) if (!scopeId.has(d.qualifiedName)) scopeId.set(d.qualifiedName, ids.get(d)!);
  const refs: RefRecord[] = parsed.refs.map((r) => ({ path, scopeId: (r.scope && scopeId.get(r.scope)) || file, name: r.name, kind: r.kind, line: r.line }));
  const imports: ImportRecord[] = [];
  for (const i of parsed.imports) {
    const targets = resolver && parsed.lang ? resolveImport(resolver, path, i.spec, parsed.lang, i.system ?? false).filter((t) => t !== path) : [];
    const baseRow = { path, spec: i.spec, line: i.line, lang: parsed.lang ?? 'text', ...(i.system ? { system: true } : {}) };
    if (targets.length === 0) imports.push(baseRow);
    else for (const t of targets) imports.push({ ...baseRow, resolved: t });
  }
  const chunks: ChunkRecord[] = parsed.chunks.map((c) => ({ id: c.id, path, startLine: c.startLine, endLine: c.endLine, blobHash, tokens: c.tokens, content: c.content }));
  return { symbols, chunks, refs, imports };
}
