import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { editsOf, parseTranscriptLine, type LiveEvent, type LiveSession } from '../src/claudeLive.js';
import { launchCommand, launchText, linkRuns, listPrompts, markExported, marker, promptIdIn, readPrompt, recordPrompt, runResult, statusOf, type PromptRecord } from '../src/runs.js';

const root = mkdtempSync(join(tmpdir(), 'riaf-runs-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const rec = (id: string, extra: Partial<PromptRecord> = {}): PromptRecord => ({ promptId: id, packId: 'pk-1', task: `Fix the null check (${id})`, host: 'claude', tokens: 4000, createdAt: `2026-11-10T10:00:0${id.slice(-1)}Z`, source: 'console', ...extra });
const session = (id: string, title: string, extra: Partial<LiveSession> = {}): LiveSession => ({ id, title, updatedAt: '2026-11-10T11:00:00Z', active: false, events: 5, ...extra });
let n = 0;
const ev = (kind: LiveEvent['kind'], text: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({ id: `e${n++}`, session: 's1', at: `2026-11-10T11:00:${String(n).padStart(2, '0')}Z`, kind, text, ...extra });

describe('prompt registry', () => {
  it('records prompts, merges export marks and lists newest first', () => {
    recordPrompt(root, rec('pr_aaa1'), '# prompt one');
    recordPrompt(root, rec('pr_aaa2'), '# prompt two');
    markExported(root, 'pr_aaa1', '2026-11-10T10:30:00Z');
    const list = listPrompts(root);
    expect(list.map((r) => r.promptId)).toEqual(['pr_aaa2', 'pr_aaa1']);
    expect(list[1]!.exportedAt).toBe('2026-11-10T10:30:00Z');
    expect(readPrompt(root, 'pr_aaa1')).toBe('# prompt one');
    expect(readPrompt(root, '../etc/passwd')).toBeUndefined();
    expect(() => recordPrompt(root, rec('../x'), '')).toThrow();
  });

  it('builds a keyed, single-line launch text and a safely quoted command', () => {
    const r = { promptId: 'pr_abc', task: "Don't break\n$HOME `pwd`" };
    expect(launchText(r)).toMatch(/^\[RIAF pr_abc\] Don't break \$HOME `pwd` — RIAF compiled the full prompt for this task in \.riaf\/prompts\/pr_abc\.md/);
    expect(launchText(r)).not.toContain('\n');
    expect(launchCommand(r)).toMatch(/^claude '\[RIAF pr_abc\] Don'\\''t break \$HOME `pwd`/);
    expect(promptIdIn(`${marker('pr_x1y2')} do it`)).toBe('pr_x1y2');
  });
});

describe('keying sessions to prompts', () => {
  it('links by hook session id, by the title marker, then by a marker in later prompts', () => {
    const records = [rec('pr_h1', { source: 'hook', sessionId: 's-hook' }), rec('pr_t1', { exportedAt: '2026-11-10T10:00:00Z' }), rec('pr_p1', { exportedAt: '2026-11-10T10:00:00Z' }), rec('pr_none')];
    const sessions = [session('s-hook', 'whatever'), session('s-title', `${marker('pr_t1')} Fix the null check`), session('s-named', 'Named by Claude Code')];
    const links = linkRuns(records, sessions, (id) => (id === 's-named' ? ['hello', `${marker('pr_p1')} task`] : []));
    expect(links.get('pr_h1')?.id).toBe('s-hook');
    expect(links.get('pr_t1')?.id).toBe('s-title');
    expect(links.get('pr_p1')?.id).toBe('s-named');
    expect(links.has('pr_none')).toBe(false);
    expect(statusOf(records[3]!, undefined)).toBe('compiled');
    expect(statusOf(records[1]!, undefined)).toBe('exported');
    expect(statusOf(records[1]!, session('x', 't', { active: true }))).toBe('running');
  });

  it('extracts the turns, reply, code and commands that answer one prompt', () => {
    const events: LiveEvent[] = [
      ev('prompt', 'an earlier unrelated task'),
      ev('text', 'done earlier'),
      ev('prompt', `${marker('pr_r1')} Fix the null check`),
      ev('tool', 'src/toll/session.ts', { tool: 'Read', ref: 't1' }), ev('result', 'contents', { ref: 't1' }),
      ev('tool', 'src/toll/session.ts', { tool: 'Edit', ref: 't2', edits: [{ path: 'src/toll/session.ts', before: 'if (x)', after: 'if (x != null)' }] }), ev('result', 'ok', { ref: 't2' }),
      ev('tool', 'npm test', { tool: 'Bash', ref: 't3' }), ev('result', '13 passed', { ref: 't3' }),
      ev('text', 'Fixed the null check and ran the tests.'),
      ev('prompt', 'also add a log line'),
      ev('tool', 'src/toll/session.ts', { tool: 'Write', ref: 't4', edits: [{ path: 'src/toll/log.ts', after: 'export const log = 1;' }] }), ev('result', 'ok', { ref: 't4' }),
      ev('text', 'Added.'),
      ev('prompt', `${marker('pr_other')} next task`),
      ev('tool', 'x', { tool: 'Edit', ref: 't5', edits: [{ path: 'src/other.ts', before: 'a', after: 'b' }] }),
    ];
    const r = runResult({ ...rec('pr_r1'), status: 'running', session: { id: 's1', title: 't', active: false, updatedAt: '' } }, '# the prompt', events);
    expect(r.turns).toHaveLength(2);
    expect(r.response).toBe('Added.');
    expect(r.files.map((f) => f.path)).toEqual(['src/toll/session.ts', 'src/toll/log.ts']);
    expect(r.files[0]!.edits[0]).toEqual({ path: 'src/toll/session.ts', before: 'if (x)', after: 'if (x != null)' });
    expect(r.commands).toEqual([{ text: 'npm test', status: 'ok' }]);
    expect(r.totals.filesChanged).toBe(2);
    expect(r.run.status).toBe('done');
  });
});

describe('edit capture from transcripts', () => {
  it('keeps the code of Edit, MultiEdit and Write calls, relative to the repository', () => {
    expect(editsOf('Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }, '/repo')).toEqual([{ path: 'src/a.ts', before: 'a', after: 'b' }]);
    expect(editsOf('MultiEdit', { file_path: '/repo/a.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] }, '/repo')).toHaveLength(2);
    expect(editsOf('Write', { file_path: '/repo/n.ts', content: 'x'.repeat(10_000) }, '/repo')[0]!.after.length).toBeLessThanOrEqual(6000);
    expect(editsOf('Read', { file_path: '/repo/a.ts' }, '/repo')).toEqual([]);
    const line = JSON.stringify({ type: 'assistant', sessionId: 's', timestamp: '2026-11-10T11:00:00Z', uuid: 'u1', message: { content: [{ type: 'tool_use', id: 't', name: 'Edit', input: { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' } }] } });
    expect(parseTranscriptLine(line, '/repo')[0]!.edits).toEqual([{ path: 'src/a.ts', before: 'x', after: 'y' }]);
  });
});
