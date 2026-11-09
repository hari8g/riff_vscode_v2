/**
 * Identifier-aware tokenisation, done in TypeScript because FTS5's tokenizer cannot be extended in
 * the wasm build (ADR-0002). `TollSession.closeLane` → [tollsession, toll, session, closelane, close, lane].
 */

const SPLIT_CAMEL = /([a-z0-9])([A-Z])|([A-Z]+)([A-Z][a-z])/g;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/** Splits one identifier into lower-case parts, keeping the whole identifier as the first token. */
export function splitIdentifier(ident: string): string[] {
  const whole = ident.toLowerCase();
  const spaced = ident.replace(SPLIT_CAMEL, (_m, a: string | undefined, b: string | undefined, c: string | undefined, d: string | undefined) =>
    a !== undefined ? `${a} ${b}` : `${c} ${d}`,
  );
  const parts = spaced
    .split(/[^\p{L}\p{N}]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/u)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [whole, ...parts]) {
    if (t.length < 2 && !/\d/.test(t)) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Tokenises arbitrary code or prose for the FTS column. */
export function tokenizeForFts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(NON_WORD)) {
    if (!raw) continue;
    for (const t of splitIdentifier(raw)) out.push(t);
  }
  return out;
}

/** Builds the `fts_text` column value. */
export function toFtsText(text: string): string {
  return tokenizeForFts(text).join(' ');
}

/** Turns a natural-language or identifier query into an FTS5 MATCH expression. */
export function buildFtsQuery(query: string, mode: 'and' | 'or' = 'and'): string | undefined {
  const toks = tokenizeForFts(query).filter((t) => t.length >= 2);
  if (toks.length === 0) return undefined;
  const quoted = [...new Set(toks)].map((t) => `"${t.replace(/"/g, '')}"`);
  return quoted.join(mode === 'and' ? ' AND ' : ' OR ');
}
