import { strongestCue } from './lexicon.js';

/**
 * Splits a request into task units. A clause becomes its own unit only when it carries a strong intent
 * cue of its own ("fix the null check in close() and add a flag so ops can disable it" → two units);
 * context sentences ("The morning peak should end at 11.") stay with the clause they explain. Order
 * words (then, after that, once…) make a unit depend on the previous one.
 */

export interface RawUnit {
  id: string;
  text: string;
  dependsOn: string[];
}

const STRONG = 2.5;
const ORDER = /^(then|and then|after that|afterwards|next|finally|once (that|this|it)('s| is) done)\b[,\s]*/i;
const SPLITTERS = /\s*(?:;|\.\s+(?=[A-Z])|\?\s+(?=[A-Z])|!\s+(?=[A-Z])|,?\s+and then\s+|,\s+then\s+|\s+then\s+(?=(?:add|fix|rename|update|remove|extract|move|implement|write|create)\b)|,?\s+and also\s+|,?\s+and\s+(?=(?:add|fix|rename|update|remove|extract|move|implement|write|create|explain)\b))/i;

/** Decomposes `text` into units; never returns an empty list. */
export function decompose(text: string): RawUnit[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  // split, remembering whether each piece was introduced by an order word
  const pieces: { text: string; ordered: boolean }[] = [];
  let rest = clean;
  for (;;) {
    const m = SPLITTERS.exec(rest);
    if (!m) {
      pieces.push({ text: rest, ordered: false });
      break;
    }
    pieces.push({ text: rest.slice(0, m.index), ordered: false });
    const sep = m[0].toLowerCase();
    rest = rest.slice(m.index + m[0].length);
    if (/then/.test(sep) && rest) rest = `then ${rest}`;
  }
  const units: { text: string; ordered: boolean }[] = [];
  for (const p of pieces) {
    let t = p.text.trim().replace(/[.;,!]+$/, '');
    if (!t) continue;
    const ordered = ORDER.test(t);
    t = t.replace(ORDER, '').trim();
    if (!t) continue;
    const standalone = strongestCue(t) >= STRONG && t.split(' ').length >= 3;
    const prev = units[units.length - 1];
    if (prev && !standalone) prev.text = `${prev.text}. ${t}`;
    else units.push({ text: t, ordered });
  }
  // a weak first unit followed by strong ones: fold it in as context for the next unit
  if (units.length > 1 && strongestCue(units[0]!.text) < STRONG) {
    const first = units.shift()!;
    units[0]!.text = `${first.text}. ${units[0]!.text}`;
  }
  if (units.length === 0) units.push({ text: clean || text, ordered: false });
  return units.map((u, i) => ({ id: `u${i + 1}`, text: u.text, dependsOn: u.ordered && i > 0 ? [`u${i}`] : [] }));
}
