import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { symbolId, type SymbolId } from '@riaf/kernel';
import { Graph } from '@riaf/graph';
import { runParseStage, scanIntoStore } from '@riaf/parse';
import { Store } from '@riaf/store';
import { History } from '../src/history.js';

const REPO = resolve(__dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'riaf-history-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Manifest { head: string; reformat: string; bugs: { bug: string; fix: string; path: string; line: number; ticket: string }[]; reverts: { commit: string; revert: string; path: string; line: number }[]; cochange: { a: string; b: string; commits: string[] }[] }
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnv }).trim();

async function indexAll(root: string, store?: Store) {
  const s = store ?? (await Store.open());
  scanIntoStore(s, root);
  await runParseStage(s, { root });
  const graph = new Graph(s);
  graph.update();
  const history = new History(s);
  const r = await history.update({ root });
  return { store: s, graph, history, r };
}

describe('history on the synthetic toll-ts history (known answers)', () => {
  const root = join(tmp, 'toll-ts');
  let m: Manifest;
  let ctx: Awaited<ReturnType<typeof indexAll>>;
  beforeAll(async () => {
    m = JSON.parse((await promisify(execFile)(process.execPath, [join(REPO, 'tooling/scripts/make-fixture-history.mjs'), 'toll-ts', root])).stdout) as Manifest;
    ctx = await indexAll(root);
  }, 120_000);

  it('mines every commit, flags the reformat as noise and links the revert', () => {
    expect(ctx.r.mined).toBe(200);
    expect(ctx.store.history.count()).toBe(200);
    expect(ctx.store.history.commit(m.reformat)?.noise).toBe(true);
    expect(ctx.store.history.revertOf(m.reverts[0]!.commit)).toBe(m.reverts[0]!.revert);
    for (const b of m.bugs) expect(['fix', 'incident']).toContain(ctx.store.history.commit(b.fix)?.kind);
    expect(ctx.store.history.incidentsOf(m.bugs[0]!.fix).map((i) => i.ref)).toContain(m.bugs[0]!.ticket);
  });

  it('blames each bug line on its fix commit, and never on the reformat', () => {
    for (const b of m.bugs) {
      const sym = ctx.store.symbols.atLine(b.path, b.line)!;
      expect(sym, `${b.path}:${b.line}`).toBeDefined();
      const commits = ctx.history.blame(sym.id as SymbolId, 50).map((e) => e.commit);
      expect(commits, `${sym.id}`).toContain(b.fix);
      expect(commits).not.toContain(b.bug); // the fix restored the line
    }
    const anyOwnedByReformat = ctx.store.history.symbolsOf(m.reformat);
    expect(anyOwnedByReformat).toEqual([]);
  });

  it('finds the scripted co-change pairs at file level and serves rationale and facts', () => {
    for (const pair of m.cochange) {
      expect(ctx.store.history.fileCoChange(pair.a).map((x) => x.path), `${pair.a} ~ ${pair.b}`).toContain(pair.b);
    }
    const bug = m.bugs[0]!;
    const sym = ctx.store.symbols.atLine(bug.path, bug.line)!.id as SymbolId;
    const facts = ctx.history.facts();
    expect(facts.blame(sym, 5).some((b) => b.commit === bug.fix && b.summary.includes(bug.ticket))).toBe(true);
    expect(facts.origin(sym)?.commit).toMatch(/^[0-9a-f]{40}$/);
    const why = ctx.history.rationale(sym);
    expect(why.commits.length).toBeGreaterThan(0);
    const rev = m.reverts[0]!;
    const revSym = ctx.store.symbols.atLine(rev.path, rev.line)!.id as SymbolId;
    expect(ctx.history.rationale(revSym).reverts.map((r) => r.commit)).toContain(rev.revert);
  });

  it('is incremental: nothing to do on a second run; a new commit mines one and re-blames its file', async () => {
    const again = await ctx.history.update({ root });
    expect(again).toMatchObject({ mined: 0, blamed: 0 });
    // a save without a commit changes no history: no git blame runs until a commit touches the file
    appendFileSync(join(root, 'src/pricing/tariff.ts'), '\n// local experiment\n');
    scanIntoStore(ctx.store, root);
    await runParseStage(ctx.store, { root });
    expect(await ctx.history.update({ root })).toMatchObject({ mined: 0, blamed: 0 });
    git(root, 'checkout', '--', 'src/pricing/tariff.ts');
    appendFileSync(join(root, 'src/pricing/peak.ts'), '\nexport const PEAK_VERSION = 2;\n');
    git(root, 'commit', '-qam', 'feat(pricing): version the peak table (TOLL-200)');
    scanIntoStore(ctx.store, root);
    await runParseStage(ctx.store, { root });
    ctx.graph.update();
    const r = await ctx.history.update({ root });
    expect(r.mined).toBe(1);
    expect(r.blamed).toBe(1);
    const v = ctx.store.symbols.byPath('src/pricing/peak.ts').find((s) => s.name === 'PEAK_VERSION')!;
    expect(ctx.history.blame(v.id as SymbolId)[0]?.summary).toBe('version the peak table (TOLL-200)');
  });

  it('re-mines everything when history is rewritten', async () => {
    git(root, 'commit', '-q', '--amend', '-m', 'feat(pricing): version the peak table, amended');
    const r = await ctx.history.update({ root });
    expect(r.rewritten).toBe(true);
    expect(ctx.store.history.count()).toBe(201);
  });

  it('links ADRs to the symbols they mention', async () => {
    mkdirSync(join(root, 'docs/adr'), { recursive: true });
    writeFileSync(join(root, 'docs/adr/0001-charge-on-close.md'), '# ADR-0001 — Charge when the session closes\n\n**Status:** accepted\n\n`TollSession.close` posts to the `Ledger` only when `charge-on-close` is on.\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'docs: ADR-0001');
    scanIntoStore(ctx.store, root);
    await runParseStage(ctx.store, { root });
    const r = await ctx.history.update({ root });
    expect(r.adrs).toBe(1);
    const close = symbolId('src/toll/session.ts', 'TollSession.close', 'method');
    expect(ctx.history.facts().adrs(close).map((a) => a.title)).toEqual(['ADR-0001 — Charge when the session closes']);
  });
});

describe('symbol-level co-change', () => {
  it('connects functions in different files that keep changing in the same commits', async () => {
    const root = join(tmp, 'cochange');
    mkdirSync(join(root, 'src'), { recursive: true });
    git(tmp, 'init', '-q', '-b', 'main', root);
    const write = (n: number) => {
      writeFileSync(join(root, 'src/encode.ts'), `export function encodeFrame(x: number) {\n  return x + ${n};\n}\n\nexport function unrelated() {\n  return 0;\n}\n`);
      writeFileSync(join(root, 'src/decode.ts'), `export function decodeFrame(x: number) {\n  return x - ${n};\n}\n`);
    };
    write(0);
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'feat: codec');
    for (let n = 1; n <= 3; n++) {
      write(n);
      git(root, 'commit', '-qam', `fix: codec offset ${n}`);
    }
    const { store, history } = await indexAll(root);
    const enc = symbolId('src/encode.ts', 'encodeFrame', 'function');
    const dec = symbolId('src/decode.ts', 'decodeFrame', 'function');
    // only the last commit owns the changed lines; the first commit owns the function headers
    expect(store.edges.outgoing(enc, 'co_changes').map((e) => e.dst)).toContain(dec);
    expect(store.edges.outgoing(symbolId('src/encode.ts', 'unrelated', 'function'), 'co_changes').map((e) => e.dst)).not.toContain(dec);
    expect(history.rationale(enc).coChange.map((c) => c.symbol)).toContain(dec);
  });
});

describe('not a git repository', () => {
  it('skips cleanly and marks the stage done', async () => {
    const root = join(tmp, 'plain');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    const { r, store } = await indexAll(root);
    expect(r.skipped).toMatch(/not a git repository/);
    expect(store.merkle.changedSince('history')).toEqual([]);
  });
});
