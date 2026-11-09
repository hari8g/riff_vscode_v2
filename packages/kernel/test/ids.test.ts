import { describe, expect, it } from 'vitest';
import { fileId, normalizeRepoPath, parseSymbolId, symbolId } from '../src/ids.js';

describe('symbol ids', () => {
  it('round-trips path, qualified name and kind', () => {
    const id = symbolId('src/toll/session.ts', 'TollSession.close', 'method');
    expect(id).toBe('src/toll/session.ts#TollSession.close@method');
    expect(parseSymbolId(id)).toEqual({ path: 'src/toll/session.ts', qualifiedName: 'TollSession.close', kind: 'method' });
  });

  it('builds file ids with an empty qualified name', () => {
    expect(fileId('README.md')).toBe('README.md#@file');
    expect(parseSymbolId('README.md#@file')?.kind).toBe('file');
  });

  it('rejects backslashes and separator characters', () => {
    expect(() => symbolId('src\\a.ts', 'x', 'function')).toThrow();
    expect(() => symbolId('src/a.ts', 'a#b', 'function')).toThrow();
    expect(() => symbolId('src/a.ts', 'a@b', 'function')).toThrow();
  });

  it('returns undefined for malformed ids and unknown kinds', () => {
    expect(parseSymbolId('no-separators')).toBeUndefined();
    expect(parseSymbolId('a.ts#x@alien')).toBeUndefined();
  });

  it('normalises OS paths', () => {
    expect(normalizeRepoPath('.\\src\\a.ts')).toBe('src/a.ts');
    expect(normalizeRepoPath('/src/a.ts')).toBe('src/a.ts');
    expect(normalizeRepoPath('./././src/a.ts')).toBe('src/a.ts');
  });
});
