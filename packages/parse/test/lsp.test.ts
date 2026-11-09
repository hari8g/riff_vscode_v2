import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { symbolId } from '@riaf/kernel';
import { Store } from '@riaf/store';
import { FrameDecoder, frame, LspClient } from '../src/lsp/client.js';
import { enrichWithLsp, nameColumn } from '../src/lsp/enrich.js';
import { detectServers, which } from '../src/lsp/servers.js';
import { scanIntoStore } from '../src/scan.js';
import { runParseStage } from '../src/stage.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-lsp-')));
cpSync(resolve(__dirname, '../../../fixtures/repos/toll-ts'), root, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('LSP framing', () => {
  it('round-trips messages split across chunks', () => {
    const bytes = Buffer.concat([frame({ a: 1 }), frame({ b: 'ü' })]);
    const d = new FrameDecoder();
    expect([...d.push(bytes.subarray(0, 7)), ...d.push(bytes.subarray(7, 30)), ...d.push(bytes.subarray(30))]).toEqual([{ a: 1 }, { b: 'ü' }]);
  });
});

describe('LspClient + enrichWithLsp against a fake server', () => {
  it('handshakes, answers server requests, queries references and writes lsp edges', async () => {
    const client = new LspClient({ command: process.execPath, args: [resolve(__dirname, 'fixtures/fake-lsp.mjs')], languageId: 'typescript', root });
    expect(await client.isAvailable()).toBe(true);
    const syms = await client.documentSymbols('src/toll/plate.ts');
    expect(syms[0]).toMatchObject({ name: 'validatePlate', kind: 'function' });

    const store = await Store.open();
    scanIntoStore(store, root);
    await runParseStage(store, { root });
    const res = await enrichWithLsp(store, client, { paths: ['src/toll/plate.ts'], readText: (p) => readFileSync(join(root, p), 'utf8') });
    expect(res.queried).toBeGreaterThan(0);
    const target = store.symbols.byPath('src/toll/plate.ts').find((s) => s.name === 'validatePlate')!;
    const incoming = store.edges.incoming(target.id, 'references');
    expect(incoming.map((e) => e.src)).toContain(symbolId('src/toll/session.ts', 'TollSession.close', 'method'));
    expect(incoming.every((e) => e.source === 'lsp')).toBe(true);
    await client.dispose();
    await store.close();
  });

  it('nameColumn and server detection', () => {
    expect(nameColumn('a\n  close(x) {', 2, 'close')).toBe(2);
    expect(which('definitely-not-a-real-binary-xyz')).toBeUndefined();
    expect(detectServers({ PATH: '' }).every((s) => s.command === undefined)).toBe(true);
  });
});
