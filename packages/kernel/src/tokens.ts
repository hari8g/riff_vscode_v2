/**
 * Fast token estimation without a tokenizer dependency.
 *
 * The compiler and governor need token counts for thousands of candidate items per request, so an
 * exact tokenizer per model is too slow and too heavy for the .vsix. We estimate from character
 * classes with a per-model calibration factor. Calibrate against the real tokenizer on a sample of
 * repository text and store the factor in CALIBRATION; the eval harness reports drift.
 */

export type TokenModelFamily = 'claude' | 'gpt' | 'gemini' | 'generic';

/** chars-per-token observed on source code; lower means more tokens per character. */
const CALIBRATION: Record<TokenModelFamily, { code: number; prose: number }> = {
  claude: { code: 3.2, prose: 4.1 },
  gpt: { code: 3.4, prose: 4.0 },
  gemini: { code: 3.6, prose: 4.2 },
  generic: { code: 3.3, prose: 4.0 },
};

const CODE_SIGNALS = /[{}();=<>[\]]|=>|->|::|^\s*(import|from|def|class|function|const|let|var|public|private|return)\b/m;

/** True when the text looks like source code rather than prose. */
export function looksLikeCode(text: string): boolean {
  if (text.length === 0) return false;
  const sample = text.length > 2000 ? text.slice(0, 2000) : text;
  const lines = sample.split('\n');
  let codeLines = 0;
  for (const l of lines) if (CODE_SIGNALS.test(l)) codeLines++;
  return codeLines / Math.max(1, lines.length) > 0.25;
}

/** Estimates tokens for `text` under `family`. Never returns less than 1 for non-empty text. */
export function estimateTokens(text: string, family: TokenModelFamily = 'claude'): number {
  if (text.length === 0) return 0;
  const cal = CALIBRATION[family];
  const perToken = looksLikeCode(text) ? cal.code : cal.prose;
  // Whitespace runs and punctuation inflate token counts slightly relative to plain characters.
  const punct = (text.match(/[^\w\s]/g) ?? []).length;
  const est = text.length / perToken + punct * 0.15;
  return Math.max(1, Math.round(est));
}

/** A budget tracker the compiler uses while filling a pack. */
export class TokenBudget {
  private used = 0;
  constructor(public readonly total: number, private readonly family: TokenModelFamily = 'claude') {
    if (!Number.isFinite(total) || total < 0) throw new Error(`TokenBudget: invalid total ${total}`);
  }
  get remaining(): number {
    return Math.max(0, this.total - this.used);
  }
  get spent(): number {
    return this.used;
  }
  /** Returns true and charges the budget when `text` fits; false otherwise. */
  tryTake(text: string): boolean {
    const n = estimateTokens(text, this.family);
    if (n > this.remaining) return false;
    this.used += n;
    return true;
  }
  takeExact(tokens: number): void {
    if (tokens > this.remaining) throw new Error(`TokenBudget: ${tokens} exceeds remaining ${this.remaining}`);
    this.used += tokens;
  }
}
