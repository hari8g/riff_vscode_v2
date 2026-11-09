import type { Intent } from '@riaf/kernel';

/**
 * Lexicon features per primitive intent (carried over from v1's intent.ts and re-weighted on the eval
 * task set). Each match adds its weight to the intent's logit; the classifier turns logits into a
 * distribution. Patterns are matched case-insensitively against one task unit.
 */

export type Lexicon = Record<Exclude<Intent, 'unknown'>, readonly (readonly [RegExp, number])[]>;

export const LEXICON: Lexicon = {
  bugfix: [
    [/\bfix(es|ed|ing)?\b/i, 2.5], [/\bbugs?\b/i, 2.5], [/\bcrash(es|ed|ing)?\b/i, 2.5], [/\b(exception|traceback|stack ?trace)\b/i, 2],
    [/\bfail(s|ed|ing|ure)?\b/i, 1.5], [/\b(broken|wrong|incorrect|regression|off[- ]by[- ]one)\b/i, 2], [/\berrors?\b/i, 1.2],
    [/\binstead of\b/i, 1.2], [/\b(is|are) being\b/i, 1], [/\b(doesn'?t|does not|don'?t|not working|never|no longer)\b/i, 1],
    [/\b(returns? stale|loses?|drops?|overwrites?|leaks?|hangs?|rejects? our)\b/i, 1.2], [/\b(null|undefined|nil|segfault|NPE)\b/i, 1],
    [/\bshould (end|only|not|be)\b/i, 0.8], [/\bstays?\b/i, 0.6],
    // symptom descriptions: observed behaviour that contradicts the expected one
    [/\b(is|are|gets?|got) (charged|sent|marked|given|assigned|kept|dropped|lost|ignored|rejected|duplicated)\b/i, 1.5],
    [/\b(far outside|outside the|larger than|smaller than|more than|less than|exceeds?|too (many|few|large|small|early|late))\b/i, 1.2],
    [/\brejects? (our|the|them|valid)\b/i, 1.5], [/\b(drops?|loses?) (every|the|all|buffered)\b/i, 1.5], [/\b(we|it) keeps? the\b/i, 1],
    [/\b(even though|although|but (it )?should)\b/i, 1.5], [/\b(stale|blurrier|garbled|corrupt(ed)?|truncated|off)\b/i, 0.8], [/\binstead\b/i, 0.4],
  ],
  feature: [
    [/\badd(s|ed|ing)?\b/i, 2.5], [/\bimplement(s|ed|ing)?\b/i, 2.5], [/\bintroduce\b/i, 2], [/\bsupport(s|ing)?\b/i, 1.5],
    [/\bnew\b/i, 1], [/\bcreate\b/i, 1.5], [/\b(endpoint|option|setting|template|field|command)\b/i, 1],
    [/\b(allow|enable|expose|provide|accept)s?\b/i, 1.5], [/\bshould (reject|count|accept|expose|provide|return|give)\b/i, 1.2],
    [/\b(need|want)s? to (see|have|be able)\b/i, 1.5], [/\bso (that )?(ops|users|we|the)\b/i, 1], [/\bgive\b/i, 0.8],
    // new conditional behaviour behind a switch
    [/\bwhen the [\w-]+ (flag|option|setting|mode) is (on|off|enabled|set)\b/i, 2.5], [/\bshould (mark|reject|refuse|warn|log|notify)\b/i, 1],
  ],
  refactor: [
    [/\brename\b/i, 3.5], [/\bextract\b/i, 3], [/\bmove\b/i, 2], [/\bclean ?up\b/i, 3], [/\bsimplify\b/i, 2.5], [/\b(restructure|reorgani[sz]e)\b/i, 3],
    [/\bsplit\b/i, 2], [/\binline\b/i, 2], [/\b(deduplicate|dedupe the code)\b/i, 3], [/\bdelegate(s)? to\b/i, 2.5], [/\beverywhere\b/i, 1.5], [/\bwithout changing behaviou?r\b/i, 3],
  ],
  review: [
    [/\breview\b/i, 3.5], [/\blook over\b/i, 3], [/\baudit\b/i, 2.5], [/\b(pull request|\bPR\b|diff|changeset)\b/i, 2], [/\bfeedback\b/i, 2],
    [/\bis (this|it) (correct|safe|ok|right)\b/i, 2.5], [/\bcheck (this|my|the) (change|diff|pr|patch)\b/i, 3],
  ],
  merge: [
    [/\bmerge\b/i, 3], [/\b(merge )?conflicts?\b/i, 3.5], [/\brebase\b/i, 3], [/\bcherry[- ]pick\b/i, 3], [/\bboth branches\b/i, 2], [/<<<<<<<|>>>>>>>/, 4],
  ],
  onboarding: [
    [/\bexplain\b/i, 3.5], [/\bhow (does|do|is|are)\b/i, 2.5], [/\bwalk (me )?through\b/i, 3], [/\bwhat (is|does|are)\b/i, 2], [/\boverview\b/i, 3],
    [/\bunderstand\b/i, 2], [/\bwhere (is|are|do|does)\b/i, 2], [/\barchitecture\b/i, 2], [/^\s*(how|what|where|why|which)\b/i, 1.5], [/\?\s*$/, 0.5],
  ],
};

/** Constant logit for `unknown`: wins when nothing else matches, loses to any clear cue. */
export const UNKNOWN_LOGIT = 1.0;

/** Sums lexicon weights per intent for `text`. */
export function lexiconLogits(text: string, lexicon: Lexicon = LEXICON): Record<Intent, number> {
  const out: Record<Intent, number> = { bugfix: 0, feature: 0, merge: 0, review: 0, refactor: 0, onboarding: 0, unknown: UNKNOWN_LOGIT };
  for (const [intent, patterns] of Object.entries(lexicon) as [Exclude<Intent, 'unknown'>, readonly (readonly [RegExp, number])[]][]) {
    for (const [re, w] of patterns) if (re.test(text)) out[intent] += w;
  }
  return out;
}

/** The strongest single cue in `text` (used by the decomposer to decide whether a clause stands alone). */
export function strongestCue(text: string, lexicon: Lexicon = LEXICON): number {
  let best = 0;
  for (const patterns of Object.values(lexicon)) for (const [re, w] of patterns) if (re.test(text)) best = Math.max(best, w);
  return best;
}
