import type { SymbolId } from '@riaf/kernel';
import type { Store, SymbolRecord } from '@riaf/store';

/**
 * The domain glossary: the business words a code base is built from ("plate", "dispute", "tariff"),
 * mined from symbol names, doc comments and directory names, each with where it is defined, where it
 * is used, which areas it spans and a one-line meaning taken from the best doc comment. It lets
 * plain-language questions and task prompts land on the right code ("plate validation" → validatePlate).
 */

export interface GlossaryTerm {
  term: string;
  /** Distinct symbols whose name contains the term. */
  symbols: number;
  files: number;
  /** Areas (directories) it appears in. */
  areas: string[];
  /** Symbols whose name is, or starts with, the term: the definitions to read first. */
  defines: SymbolId[];
  /** One-line meaning from the most specific doc comment, if any. */
  meaning?: string;
  /** Weighted frequency used for ranking. */
  score: number;
}

/** Programming words that say nothing about the domain. */
const GENERIC = new Set(`get set has is to of on in at by for from with and or not new make create build init update delete remove add put post
fetch load save read write open close start stop run handle handler process manager service util utils helper helpers impl base abstract default
value values data item items list map set array string number int bool boolean object type types id ids key keys name names index count size length
result results error errors err ok options option opts config param params arg args input output request response req res ctx context state
test tests spec mock fake stub fixture expect should when then given main app api src lib core common shared internal private public static
this self cls true false null none undefined void async await promise callback fn func function method class interface enum const let var
min max total first last next prev current old tmp temp other all any each one two three`.split(/\s+/).filter(Boolean));

const TYPE_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'type', 'enum', 'struct', 'trait']);
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.\w+$|_test\.\w+$/;

/** Splits an identifier into lower-case words: `validatePlate` → [validate, plate], `MAX_RETRY` → [max, retry]. */
export function splitIdentifier(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

/** Light stemmer shared with the plain-language layer: "disputes" ~ "dispute", "pricing" ~ "price". */
export const stemWord = (w: string) => w.toLowerCase().replace(/ies$/, 'y').replace(/(?:ation|ition|ment|ness|ing|ed|es|(?<!s)s)$/, '').replace(/e$/, '');

const areaOf = (path: string) => (path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : './');
const firstSentence = (doc: string) => doc.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]!.slice(0, 200);

export interface GlossaryOptions {
  top?: number;
  /** Include test code (default false). */
  includeTests?: boolean;
}

/** Mines the glossary from the symbol table. */
export function buildGlossary(store: Store, opts: GlossaryOptions = {}): GlossaryTerm[] {
  const acc = new Map<string, { words: Map<string, number>; syms: Set<string>; files: Set<string>; areas: Set<string>; defs: SymbolRecord[]; score: number }>();
  const touch = (word: string, s: SymbolRecord, weight: number) => {
    if (GENERIC.has(word)) return;
    const st = stemWord(word);
    if (st.length < 3) return;
    const a = acc.get(st) ?? { words: new Map(), syms: new Set(), files: new Set(), areas: new Set(), defs: [], score: 0 };
    a.words.set(word, (a.words.get(word) ?? 0) + 1);
    a.syms.add(s.id);
    a.files.add(s.path);
    a.areas.add(areaOf(s.path));
    a.score += weight;
    acc.set(st, a);
  };
  for (const s of store.symbols.all()) {
    if (!opts.includeTests && TEST_PATH.test(s.path)) continue;
    if (s.kind === 'file') {
      for (const w of s.path.split('/').slice(0, -1).flatMap(splitIdentifier)) touch(w, s, 0.5);
      continue;
    }
    if (s.kind === 'variable' || s.kind === 'unknown' || s.kind === 'repo' || s.kind === 'package') continue;
    const words = splitIdentifier(s.name);
    const typeLike = TYPE_KINDS.has(s.kind);
    for (const [i, w] of words.entries()) {
      touch(w, s, typeLike ? 2 : s.kind === 'property' || s.kind === 'field' ? 0.5 : i === words.length - 1 ? 1.2 : 1);
      const a = acc.get(stemWord(w));
      // a symbol "defines" a term when its own name leads with it (Plate, PlateValidator, plateChecksum, validatePlate's head noun)
      if (a && (i === 0 || (i === words.length - 1 && words.length <= 2)) && !a.defs.some((d) => d.id === s.id)) a.defs.push(s);
    }
    if (s.doc) for (const w of splitIdentifier(s.doc.slice(0, 200))) if (acc.has(stemWord(w))) touch(w, s, 0.25);
  }
  const kindRank = (k: string) => (TYPE_KINDS.has(k) ? 0 : k === 'function' || k === 'method' ? 1 : 2);
  return [...acc.values()]
    .filter((a) => a.syms.size >= 2 || a.defs.some((d) => kindRank(d.kind) <= 1))
    .map((a) => {
      const term = [...a.words.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]![0];
      const defs = [...a.defs].sort((x, y) => kindRank(x.kind) - kindRank(y.kind) || x.name.length - y.name.length);
      const meaningFrom = defs.find((d) => d.doc) ?? undefined;
      return {
        term, symbols: a.syms.size, files: a.files.size, areas: [...a.areas].sort(), defines: defs.slice(0, 5).map((d) => d.id),
        ...(meaningFrom?.doc ? { meaning: firstSentence(meaningFrom.doc) } : {}),
        score: Math.round((a.score * (1 + Math.log2(a.files.size))) * 100) / 100,
      };
    })
    .sort((x, y) => y.score - x.score || x.term.localeCompare(y.term))
    .slice(0, opts.top ?? 60);
}

/** Finds glossary terms for the words of a plain-language phrase ("plate validation" → plate, validate). */
export function lookupTerms(glossary: readonly GlossaryTerm[], phrase: string): GlossaryTerm[] {
  const stems = new Set(splitIdentifier(phrase).map(stemWord));
  const byStem = new Map(glossary.map((g) => [stemWord(g.term), g] as const));
  return [...stems].map((s) => byStem.get(s) ?? [...byStem.entries()].find(([k]) => k.length >= 4 && (k.startsWith(s) || s.startsWith(k)))?.[1]).filter((g): g is GlossaryTerm => !!g);
}
