import type { LspPort, SymbolId } from '@riaf/kernel';
import type { EdgeRecord, Store, SymbolRecord } from '@riaf/store';

/**
 * LSP enrichment (the Serena idea as an optional pass): for each definition in the given files, ask
 * the language server for its references and record precise `references` edges with source `lsp`
 * from the enclosing symbol at each reference site to the definition. The graph layer prefers these
 * over heuristic name-matched edges when both exist.
 */

const ENRICHABLE = new Set(['class', 'interface', 'struct', 'enum', 'function', 'method', 'constructor', 'type', 'trait']);

export interface EnrichOptions {
  /** Repo-relative paths whose definitions are enriched. */
  paths: readonly string[];
  /** Reads a file so the name column can be found on the definition line. */
  readText: (path: string) => string | undefined;
  /** Upper bound on reference queries per run (keeps one save cheap). */
  maxQueries?: number;
  signal?: AbortSignal;
}

export interface EnrichResult {
  queried: number;
  edges: number;
  failed: number;
}

/** Column of `name` on 1-based `line` of `text`, or undefined when it is not there. */
export function nameColumn(text: string, line: number, name: string): number | undefined {
  const l = text.split('\n')[line - 1];
  if (l === undefined) return undefined;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(l);
  return m ? m.index : undefined;
}

/** Runs enrichment through `lsp` for definitions in `opts.paths`, writing `lsp` edges into the store. */
export async function enrichWithLsp(store: Store, lsp: LspPort, opts: EnrichOptions): Promise<EnrichResult> {
  const result: EnrichResult = { queried: 0, edges: 0, failed: 0 };
  const max = opts.maxQueries ?? 2000;
  for (const path of opts.paths) {
    const text = opts.readText(path);
    if (text === undefined) continue;
    const defs = store.symbols.byPath(path).filter((s) => ENRICHABLE.has(s.kind) && s.startLine !== undefined);
    const edges: EdgeRecord[] = [];
    for (const def of defs) {
      if (opts.signal?.aborted || result.queried >= max) break;
      const line = findNameLine(text, def);
      if (!line) continue;
      result.queried++;
      try {
        const refs = await lsp.references({ path, range: { start: { line: line.line - 1, character: line.col }, end: { line: line.line - 1, character: line.col } } }, false);
        for (const r of refs) {
          const site = store.symbols.atLine(r.path, r.range.start.line + 1);
          const src = (site?.id ?? `${r.path}#@file`) as SymbolId;
          if (src === def.id) continue;
          edges.push({ src, dst: def.id, kind: 'references', source: 'lsp', confidence: 1, weight: 1 });
        }
      } catch {
        result.failed++;
      }
    }
    store.edges.deleteOutgoingFromPath(path, ['lsp']);
    store.edges.upsertMany(edges);
    result.edges += edges.length;
  }
  return result;
}

function findNameLine(text: string, def: SymbolRecord): { line: number; col: number } | undefined {
  const start = def.startLine ?? 1;
  for (let l = start; l <= Math.min(start + 5, def.endLine ?? start); l++) {
    const col = nameColumn(text, l, def.name);
    if (col !== undefined) return { line: l, col };
  }
  return undefined;
}
