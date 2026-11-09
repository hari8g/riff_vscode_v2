/**
 * Stable identifiers shared by every layer.
 *
 * A symbol id is `path#qualifiedName@kind`, e.g. `src/toll/session.ts#TollSession.close@method`.
 * It survives re-indexing as long as the symbol keeps its name and file, which is what the
 * history layer (blame per symbol) and the skill store (entity-grounded skills) need.
 */

export type BlobHash = string & { readonly __brand: 'BlobHash' };
export type TreeHash = string & { readonly __brand: 'TreeHash' };
export type SymbolId = string & { readonly __brand: 'SymbolId' };

export const SYMBOL_KINDS = [
  'repo', 'package', 'directory', 'file', 'module', 'namespace',
  'class', 'interface', 'enum', 'struct', 'trait', 'type',
  'function', 'method', 'constructor', 'property', 'field', 'variable', 'constant',
  'test', 'unknown',
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

const SEP_NAME = '#';
const SEP_KIND = '@';

/** Builds a symbol id. `path` must be repo-relative with forward slashes. */
export function symbolId(path: string, qualifiedName: string, kind: SymbolKind): SymbolId {
  if (path.includes('\\')) throw new Error(`symbolId: path must use forward slashes: ${path}`);
  if (qualifiedName.includes(SEP_NAME) || qualifiedName.includes(SEP_KIND)) {
    throw new Error(`symbolId: qualified name may not contain '#' or '@': ${qualifiedName}`);
  }
  return `${path}${SEP_NAME}${qualifiedName}${SEP_KIND}${kind}` as SymbolId;
}

/** A file node's id: `path#@file`. */
export function fileId(path: string): SymbolId {
  return symbolId(path, '', 'file');
}

export interface ParsedSymbolId {
  path: string;
  qualifiedName: string;
  kind: SymbolKind;
}

/** Parses a symbol id; returns undefined when the string is not a valid id. */
export function parseSymbolId(id: string): ParsedSymbolId | undefined {
  const hash = id.lastIndexOf(SEP_NAME);
  const at = id.lastIndexOf(SEP_KIND);
  if (hash < 0 || at < hash) return undefined;
  const kind = id.slice(at + 1);
  if (!(SYMBOL_KINDS as readonly string[]).includes(kind)) return undefined;
  return { path: id.slice(0, hash), qualifiedName: id.slice(hash + 1, at), kind: kind as SymbolKind };
}

/** Normalises an OS path to the repo-relative, forward-slash form used in ids. */
export function normalizeRepoPath(path: string): string {
  let p = path.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  return p;
}
