import { describe, expect, it } from 'vitest';
import { chunkFile } from '../src/chunker.js';
import { chunkText } from '../src/parseFile.js';
import { extractTags } from '../src/treesitter/tags.js';

const method = (i: number, lines: number) =>
  [`  m${i}(x: number): number {`, ...Array.from({ length: lines }, (_, k) => `    const v${k} = x * ${k} + this.offset + ${i};`), '    return x;', '  }'].join('\n');

describe('chunkFile', () => {
  it('keeps a small file in one chunk covering every definition', async () => {
    const src = "import { a } from './a';\n\nexport function f() { return a(); }\nexport function g() { return 2; }\n";
    const tags = await extractTags('typescript', 'x.ts', src);
    const chunks = chunkFile('x.ts', src, tags.defs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ id: 'x.ts:1', startLine: 1, endLine: 4, symbols: ['f', 'g'] });
  });

  it('splits an oversized class into header and members, never splitting a method', async () => {
    const src = ['export class Big {', '  offset = 1;', method(1, 40), method(2, 40), method(3, 40), '}', ''].join('\n');
    const tags = await extractTags('typescript', 'big.ts', src);
    const chunks = chunkFile('big.ts', src, tags.defs, { maxTokens: 400 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const name of ['Big.m1', 'Big.m2', 'Big.m3']) {
      const def = tags.defs.find((d) => d.qualifiedName === name)!;
      const holder = chunks.find((c) => c.startLine <= def.startLine && c.endLine >= def.endLine);
      expect(holder, `${name} must sit wholly inside one chunk`).toBeDefined();
    }
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.symbols).toContain('Big');
    // chunks are ordered and do not overlap
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.startLine).toBeGreaterThan(chunks[i - 1]!.endLine);
  });

  it('keeps a single function over the cap whole', async () => {
    const src = `function huge(x: number) {\n${Array.from({ length: 200 }, (_, k) => `  x += ${k};`).join('\n')}\n  return x;\n}\n`;
    const tags = await extractTags('typescript', 'h.ts', src);
    const chunks = chunkFile('h.ts', src, tags.defs, { maxTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.endLine).toBe(203);
  });

  it('chunks plain text on paragraph boundaries', () => {
    const para = (n: number) => Array.from({ length: 12 }, (_, k) => `Paragraph ${n} line ${k} has a few words of prose in it.`).join('\n');
    const src = [para(1), '', para(2), '', para(3), '', para(4)].join('\n');
    const chunks = chunkText('README.md', src, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.startLine).toBe(1);
    for (const c of chunks) expect(c.content.trim().length).toBeGreaterThan(0);
  });
});
