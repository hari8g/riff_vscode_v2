import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonCore } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { answerQuestion, resetAskCache, understand, vocabularyOf } from '../src/askHost.js';
import { handleConsole } from '../src/consoleHost.js';

const REPO = resolve(__dirname, '../../..');
const root = mkdtempSync(join(tmpdir(), 'riaf-ask-'));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
let core: DaemonCore;
beforeAll(async () => {
  resetAskCache();
  core = await DaemonCore.open({ root, storePath: ':memory:', logger: silentLogger, validateResults: true });
  await core.index('test');
});
afterAll(async () => {
  await core.close();
  rmSync(root, { recursive: true, force: true });
});

describe('ask host', () => {
  it('derives product areas from the wiki tree, without tests', () => {
    const v = vocabularyOf({ id: '', level: 'repo', title: 'r', summary: 's', children: [
      { id: 'src/', level: 'directory', title: 'src/', summary: 'src: 1 file, 2 directories.', children: [
        { id: 'src/a/', level: 'directory', title: 'a', summary: 'src/a: 3 files.', children: [] },
        { id: 'src/b/', level: 'directory', title: 'b', summary: 'src/b: 1 file.', children: [] },
      ] },
      { id: 'test/', level: 'directory', title: 'test/', summary: 'test: 4 files.', children: [] },
    ] });
    expect(v.areas).toEqual([{ id: 'src/a/', name: 'A', files: 3 }, { id: 'src/b/', name: 'B', files: 1 }]);
  });

  it('understands while typing, with the repository areas', async () => {
    const r = await understand(core, 'How does pricing work?');
    expect(r.areas.map((a) => a.id)).toContain('src/pricing/');
    expect(r.parsed.subjects).toContainEqual({ text: 'Pricing', kind: 'area', area: 'src/pricing/' });
  });

  it('compiles a question into a timed plan and a grounded answer', async () => {
    const r = await answerQuestion(core, 'What would be affected if we change TollSession?');
    expect(r.plan.map((s) => s.id)).toEqual(['understand', 'locate', 'gather', 'compose']);
    expect(r.plan.every((s) => s.ms >= 0 && s.detail.length > 0)).toBe(true);
    expect(r.evidence.subjects[0]?.symbol).toBe('src/toll/session.ts#TollSession@class');
    expect(r.answer.lens).toBe('impact');
    expect(r.answer.blocks.map((b) => b.kind)).toEqual(['rings', 'risk']);
  });

  it('ranks plain words onto the right code and compiles a pack for explain', async () => {
    const r = await answerQuestion(core, 'How well tested is the plate validation?');
    expect(r.evidence.subjects[0]?.symbol).toContain('validatePlate');
    const e = await answerQuestion(core, 'How does a dispute get resolved?');
    expect(e.plan.map((s) => s.id)).toContain('compile');
    expect(e.evidence.pack?.tokensUsed).toBeGreaterThan(0);
    expect(e.evidence.subjects[0]?.area).toBe('src/disputes/');
  });

  it('flags new concepts in a request and honours a forced lens through the console', async () => {
    const r = await answerQuestion(core, 'We want to add a monthly pass discount for frequent drivers. How big is that?');
    expect(r.answer.lens).toBe('scope');
    expect(r.evidence.unmatched).toContain('frequent drivers');
    const deps = { rpc: core, writeRiafFile: async () => undefined, modelSettings: () => ({}) };
    const forced = await handleConsole(deps, { type: 'ask', text: 'TollSession', lens: 'people' });
    expect(forced.type).toBe('answered');
    expect((forced['answer'] as { lens: string }).lens).toBe('people');
    expect((await handleConsole(deps, { type: 'understand', text: 'who owns pricing', lens: 'bogus' })).type).toBe('understood');
  });
});
