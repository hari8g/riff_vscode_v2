import { describe, expect, it } from 'vitest';
import { TokenBudget, estimateTokens, looksLikeCode } from '../src/tokens.js';

const CODE = `export function close(session: TollSession): void {\n  if (!session) { return; }\n  session.state = 'closed';\n}\n`;
const PROSE = 'The toll session closes when the vehicle leaves the lane and the plate has been matched to an account.';

describe('token estimation', () => {
  it('detects code versus prose', () => {
    expect(looksLikeCode(CODE)).toBe(true);
    expect(looksLikeCode(PROSE)).toBe(false);
    expect(looksLikeCode('')).toBe(false);
  });

  it('estimates within a plausible band', () => {
    const code = estimateTokens(CODE);
    expect(code).toBeGreaterThan(CODE.length / 5);
    expect(code).toBeLessThan(CODE.length / 2);
    const prose = estimateTokens(PROSE);
    expect(prose).toBeGreaterThan(PROSE.length / 6);
    expect(prose).toBeLessThan(PROSE.length / 3);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('x')).toBe(1);
  });

  it('budget charges and refuses correctly', () => {
    const b = new TokenBudget(30);
    expect(b.tryTake(PROSE)).toBe(true);
    expect(b.spent).toBeGreaterThan(0);
    expect(b.tryTake(PROSE)).toBe(false);
    expect(b.remaining).toBe(30 - b.spent);
    expect(() => b.takeExact(1000)).toThrow();
    expect(() => new TokenBudget(-1)).toThrow();
  });
});
