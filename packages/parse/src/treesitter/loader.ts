import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ParserModule from 'web-tree-sitter';
import { RiafError } from '@riaf/kernel';
import { LANGUAGE_INFO, type LanguageId } from '../languages.js';

/*
 * Lazily loads web-tree-sitter and the per-language .wasm grammars. Nothing is downloaded: grammars
 * come from RIAF_GRAMMARS_DIR, the vendored tooling/grammars folder, a `grammars/` folder next to the
 * bundle (the .vsix layout), or the tree-sitter-wasms package in node_modules, in that order.
 */

// Structural types for the parts of web-tree-sitter 0.22 we use (its typings are a global namespace).
export interface TsPoint { row: number; column: number }
export interface TsNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TsPoint;
  endPosition: TsPoint;
  parent: TsNode | null;
  children: TsNode[];
  namedChildren: TsNode[];
  childCount: number;
  previousNamedSibling: TsNode | null;
  previousSibling: TsNode | null;
  childForFieldName(name: string): TsNode | null;
  /** A getter in web-tree-sitter 0.22, a method in later releases. */
  hasError: boolean | (() => boolean);
}
export interface TsTree { rootNode: TsNode; delete(): void }
export interface TsCapture { name: string; node: TsNode }
export interface TsMatch { pattern: number; captures: TsCapture[] }
export interface TsQuery { matches(node: TsNode): TsMatch[]; captureNames: string[]; delete(): void }
export interface TsLanguage { version: number; query(source: string): TsQuery }
export interface TsParser { setLanguage(lang: TsLanguage): void; parse(input: string): TsTree; delete(): void }
interface TsParserCtor {
  new (): TsParser;
  init(opts?: object): Promise<void>;
  Language: { load(path: string): Promise<TsLanguage> };
}

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

let initPromise: Promise<TsParserCtor> | undefined;
const languages = new Map<LanguageId, Promise<TsLanguage>>();
const parsers = new Map<LanguageId, TsParser>();

async function parserCtor(): Promise<TsParserCtor> {
  if (!initPromise) {
    initPromise = (async () => {
      // a static import so bundlers include the runtime; its wasm is found next to the running script
      const Parser = ParserModule as unknown as TsParserCtor;
      await Parser.init();
      return Parser;
    })();
  }
  return initPromise;
}

/** Directories searched for `tree-sitter-<grammar>.wasm`, most specific first. */
export function grammarSearchPath(): string[] {
  const dirs: string[] = [];
  if (process.env.RIAF_GRAMMARS_DIR) dirs.push(resolve(process.env.RIAF_GRAMMARS_DIR));
  dirs.push(join(here, 'grammars'), join(here, '..', 'grammars'));
  // repo checkout: packages/parse/{src,dist}/treesitter → ../../../../tooling/grammars
  dirs.push(resolve(here, '../../../../tooling/grammars'));
  try {
    dirs.push(join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out'));
  } catch {
    // not installed: fine when grammars are vendored
  }
  return dirs;
}

/** Absolute path of a language's grammar, or a RiafError naming every folder searched. */
export function grammarPath(lang: LanguageId): string {
  const file = `tree-sitter-${LANGUAGE_INFO[lang].grammar}.wasm`;
  const dirs = grammarSearchPath();
  for (const d of dirs) {
    const p = join(d, file);
    if (existsSync(p)) return p;
  }
  throw new RiafError('parse_failure', `grammar ${file} not found`, { searched: dirs });
}

/** Loads (once) the tree-sitter language for `lang`. */
export async function loadLanguage(lang: LanguageId): Promise<TsLanguage> {
  let p = languages.get(lang);
  if (!p) {
    p = (async () => {
      const Parser = await parserCtor();
      return Parser.Language.load(grammarPath(lang));
    })();
    languages.set(lang, p);
    p.catch(() => languages.delete(lang));
  }
  return p;
}

/** Parses `source` with a cached parser for `lang`. Callers must `tree.delete()` when done. */
export async function parseSource(lang: LanguageId, source: string): Promise<TsTree> {
  const language = await loadLanguage(lang);
  let parser = parsers.get(lang);
  if (!parser) {
    const Parser = await parserCtor();
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  return parser.parse(source);
}

/** True when the subtree contains a syntax error (works across web-tree-sitter API versions). */
export function nodeHasError(node: TsNode): boolean {
  const h = node.hasError;
  return typeof h === 'function' ? h.call(node) : Boolean(h);
}
