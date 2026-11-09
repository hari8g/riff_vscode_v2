import { cpSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fileId, symbolId } from '@riaf/kernel';
import { Store } from '@riaf/store';
import { compileIgnore, discoverFiles, scanIntoStore } from '../src/scan.js';
import { runParseStage } from '../src/stage.js';

const FIXTURE = resolve(__dirname, '../../../fixtures/repos/toll-ts');
const dirs: string[] = [];
const copyFixture = () => {
  const d = mkdtempSync(join(tmpdir(), 'riaf-parse-'));
  dirs.push(d);
  cpSync(FIXTURE, d, { recursive: true });
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('discovery', () => {
  it('honours .gitignore (nested, negation, dir-only) and default ignored dirs', () => {
    const d = copyFixture();
    writeFileSync(join(d, '.gitignore'), 'generated/\n*.log\n!keep.log\n/rootonly.ts\n');
    writeFileSync(join(d, '.riafignore'), 'src/config/\n');
    for (const [p, c] of [['generated/x.ts', 'export const a = 1;'], ['node_modules/m/index.js', ''], ['a.log', ''], ['keep.log', ''], ['rootonly.ts', ''], ['src/rootonly.ts', 'export const b = 2;']]) {
      const full = join(d, p!);
      cpSync(FIXTURE + '/package.json', full, { force: true });
      writeFileSync(full, c!);
    }
    const paths = discoverFiles(d).map((f) => f.path);
    expect(paths).toContain('src/toll/session.ts');
    expect(paths).toContain('src/rootonly.ts');
    expect(paths).not.toContain('rootonly.ts');
    expect(paths.some((p) => p.startsWith('generated/') || p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('src/config/'))).toBe(false); // .riafignore
  });
  it('compileIgnore handles ** and anchoring', () => {
    expect(compileIgnore('**/fixtures/*.json', '')!.re.test('a/b/fixtures/x.json')).toBe(true);
    expect(compileIgnore('/build', '')!.re.test('pkg/build')).toBe(false);
    expect(compileIgnore('build', '')!.re.test('pkg/build')).toBe(true);
    expect(compileIgnore('*.gen.ts', 'pkg')!.re.test('pkg/a/x.gen.ts')).toBe(true);
    expect(compileIgnore('*.gen.ts', 'pkg')!.re.test('other/x.gen.ts')).toBe(false);
  });
});

describe('parse stage on toll-ts', () => {
  it('indexes symbols, refs, resolved imports and chunks; second run touches 0 blobs; one edit touches one file', async () => {
    const root = copyFixture();
    const store = await Store.open();
    const scan1 = scanIntoStore(store, root);
    expect(scan1.added.length).toBeGreaterThan(4);
    const r1 = await runParseStage(store, { root });
    expect(r1.failed).toEqual([]);
    expect(r1.parsed).toContain('src/toll/session.ts');

    const close = store.symbols.get(symbolId('src/toll/session.ts', 'TollSession.close', 'method'));
    expect(close).toMatchObject({ startLine: expect.any(Number), signature: 'close(amountPaise: number): void', parentId: symbolId('src/toll/session.ts', 'TollSession', 'class') });
    expect(close!.doc).toMatch(/Closes the session/);
    expect(store.symbols.get(fileId('src/toll/session.ts'))?.kind).toBe('file');
    expect(store.imports.byPath('src/toll/session.ts').map((i) => i.resolved)).toEqual(['src/config/flags.ts', 'src/toll/plate.ts', 'src/toll/ledger.ts']);
    expect(store.refs.byScope(close!.id).map((r) => r.name)).toEqual(expect.arrayContaining(['validatePlate', 'isEnabled', 'post']));
    expect(store.chunks.byPath('src/toll/session.ts').length).toBeGreaterThan(0);
    expect(store.fts.search('validate plate').length).toBeGreaterThan(0);

    // warm: nothing changed → nothing hashed, nothing parsed
    const scan2 = scanIntoStore(store, root);
    expect(scan2.hashed).toBe(0);
    const r2 = await runParseStage(store, { root });
    expect(r2.parsed).toEqual([]);

    // one edit → one file re-parsed
    writeFileSync(join(root, 'src/toll/plate.ts'), `${'// edited\n'}export function validatePlate(p: { text: string }): boolean { return p.text.length > 3; }\n`);
    const scan3 = scanIntoStore(store, root);
    expect(scan3.changed).toEqual(['src/toll/plate.ts']);
    const r3 = await runParseStage(store, { root });
    expect(r3.parsed).toEqual(['src/toll/plate.ts']);

    // delete → rows gone; imports pointing at it become unresolved and are re-resolved
    unlinkSync(join(root, 'src/toll/ledger.ts'));
    const scan4 = scanIntoStore(store, root);
    expect(scan4.removed).toEqual(['src/toll/ledger.ts']);
    expect(store.symbols.byPath('src/toll/ledger.ts')).toEqual([]);
    const r4 = await runParseStage(store, { root });
    expect(r4.reresolved).toContain('src/toll/session.ts');
    expect(store.imports.byPath('src/toll/session.ts').find((i) => i.spec === './ledger.js')?.resolved).toBeUndefined();
    await store.close();
  });
});
