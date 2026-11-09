import { hashWith, type EventBus, type Logger, type PipelineEvents } from '@riaf/kernel';
import type { ImportRecord, Store } from '@riaf/store';
import { buildResolverContext, resolveImport, type ResolverContext } from './imports.js';
import type { LanguageId } from './languages.js';
import { parseFile, toRecords } from './parseFile.js';
import { readRepoText } from './scan.js';

export const PARSE_STAGE = 'parse';
const FILESET_KEY = 'parse.fileset';

export interface ParseStageOptions {
  root: string;
  /** Reads a repo-relative file; defaults to the working tree under `root`. */
  readText?: (path: string) => string | undefined;
  maxChunkTokens?: number;
  events?: EventBus<PipelineEvents>;
  logger?: Logger;
  signal?: AbortSignal;
}

export interface ParseStageResult {
  parsed: string[];
  failed: { path: string; error: string }[];
  /** Unchanged files whose imports were re-resolved because the file set changed. */
  reresolved: string[];
  ms: number;
}

/** Re-resolves stored import rows of `path` without re-parsing (the file set changed, the file did not). */
function reresolve(store: Store, ctx: ResolverContext, path: string): void {
  const rows = store.imports.byPath(path);
  const seen = new Set<string>();
  const out: ImportRecord[] = [];
  for (const r of rows) {
    const key = `${r.spec}\u0000${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = { path, spec: r.spec, line: r.line, lang: r.lang, ...(r.system ? { system: true } : {}) };
    const targets = r.lang === 'text' ? [] : resolveImport(ctx, path, r.spec, r.lang as LanguageId, r.system ?? false).filter((t) => t !== path);
    if (targets.length === 0) out.push(base);
    else for (const t of targets) out.push({ ...base, resolved: t });
  }
  store.imports.replaceForPath(path, out);
}

/**
 * Runs the parse stage over every blob the Merkle table reports as not yet parsed: tags, chunks,
 * references and resolved imports are written per file in one transaction, then the blob is marked.
 */
export async function runParseStage(store: Store, opts: ParseStageOptions): Promise<ParseStageResult> {
  const t0 = performance.now();
  const read = opts.readText ?? ((p: string) => readRepoText(opts.root, p));
  const pending = store.merkle.changedSince(PARSE_STAGE);
  const files = store.merkle.paths();
  const fileSet = new Set(files);
  const ctx = buildResolverContext(files, read);
  const result: ParseStageResult = { parsed: [], failed: [], reresolved: [], ms: 0 };
  opts.events?.emit('stage:start', { stage: PARSE_STAGE, pending: pending.length });

  let done = 0;
  for (const blob of pending) {
    if (opts.signal?.aborted) break;
    const source = read(blob.path);
    if (source === undefined) {
      result.failed.push({ path: blob.path, error: 'unreadable' });
      continue;
    }
    try {
      const parsed = await parseFile(blob.path, source, opts.maxChunkTokens !== undefined ? { maxChunkTokens: opts.maxChunkTokens } : {});
      const rec = toRecords(parsed, blob.hash, ctx);
      store.driver.transaction(() => {
        store.symbols.deleteByPath(blob.path);
        store.symbols.upsertMany(rec.symbols);
        store.replaceChunksForPath(blob.path, rec.chunks);
        store.refs.replaceForPath(blob.path, rec.refs);
        store.imports.replaceForPath(blob.path, rec.imports);
        store.merkle.markDone(PARSE_STAGE, [blob.path]);
      });
      result.parsed.push(blob.path);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ path: blob.path, error });
      opts.logger?.warn('parse failed', { path: blob.path, error });
    }
    done++;
    if (done % 50 === 0) opts.events?.emit('stage:progress', { stage: PARSE_STAGE, done, total: pending.length });
  }

  // When files were added or removed, imports in unchanged files may now resolve differently.
  const setHash = hashWith('fileset', ...files);
  if (store.kv.get(FILESET_KEY) !== setHash) {
    const parsedNow = new Set(result.parsed);
    const stale = new Set(store.imports.pathsNeedingResolution(fileSet));
    // Files that previously resolved to something that could now be shadowed are rare; unresolved
    // and dangling rows are the cases that matter after an add/remove.
    for (const p of stale) {
      if (parsedNow.has(p) || !fileSet.has(p)) continue;
      reresolve(store, ctx, p);
      result.reresolved.push(p);
    }
    store.kv.set(FILESET_KEY, setHash);
  }

  result.ms = performance.now() - t0;
  opts.events?.emit('stage:end', { stage: PARSE_STAGE, changed: result.parsed.length, ms: result.ms });
  return result;
}
