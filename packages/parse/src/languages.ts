/**
 * The languages RIAF parses at launch and how a path maps to one. Adding a language is a grammar
 * file in tree-sitter-wasms (or tooling/grammars), a tags query in treesitter/queries, and a row here.
 */

export const LANGUAGES = ['typescript', 'tsx', 'javascript', 'python', 'java', 'go', 'c', 'cpp', 'csharp'] as const;
export type LanguageId = (typeof LANGUAGES)[number];

/** The import-resolution family a language belongs to (tsx and javascript resolve like typescript). */
export type LanguageFamily = 'ts' | 'python' | 'java' | 'go' | 'c' | 'csharp';

interface LanguageInfo {
  grammar: string; // basename of the .wasm without the `tree-sitter-` prefix
  family: LanguageFamily;
  extensions: readonly string[];
}

export const LANGUAGE_INFO: Record<LanguageId, LanguageInfo> = {
  typescript: { grammar: 'typescript', family: 'ts', extensions: ['.ts', '.mts', '.cts'] },
  tsx: { grammar: 'tsx', family: 'ts', extensions: ['.tsx'] },
  javascript: { grammar: 'javascript', family: 'ts', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  python: { grammar: 'python', family: 'python', extensions: ['.py', '.pyi'] },
  java: { grammar: 'java', family: 'java', extensions: ['.java'] },
  go: { grammar: 'go', family: 'go', extensions: ['.go'] },
  c: { grammar: 'c', family: 'c', extensions: ['.c', '.h'] },
  cpp: { grammar: 'cpp', family: 'c', extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.ipp'] },
  csharp: { grammar: 'c_sharp', family: 'csharp', extensions: ['.cs'] },
};

const BY_EXTENSION = new Map<string, LanguageId>();
for (const id of LANGUAGES) for (const ext of LANGUAGE_INFO[id].extensions) BY_EXTENSION.set(ext, id);

/** Returns the language for a repo path, or undefined when RIAF does not parse it. */
export function languageOf(path: string): LanguageId | undefined {
  if (path.endsWith('.d.ts')) return 'typescript';
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return undefined;
  return BY_EXTENSION.get(path.slice(dot).toLowerCase());
}

/** The resolution family for a language. */
export function familyOf(lang: LanguageId): LanguageFamily {
  return LANGUAGE_INFO[lang].family;
}

/** True when the path looks like a test file by naming convention, in any supported language. */
export function isTestPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return (
    /(^|\/)(test|tests|__tests__|spec|specs)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    /^test_.*\.py$|_test\.py$/.test(base) ||
    /_test\.go$/.test(base) ||
    /(Test|Tests|IT)\.(java|cs)$/.test(base)
  );
}
