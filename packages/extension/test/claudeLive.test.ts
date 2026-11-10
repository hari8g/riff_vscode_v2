import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ClaudeLive, claudeProjectDir, customTitleOf, describeTool, parseTranscriptLine } from '../src/claudeLive.js';

const tmp = mkdtempSync(join(tmpdir(), 'riaf-live-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const line = (o: Record<string, unknown>) => `${JSON.stringify({ sessionId: 's1', timestamp: '2026-11-10T12:00:00.000Z', ...o })}\n`;
const prompt = (uuid: string, text: string) => line({ type: 'user', uuid, message: { role: 'user', content: text } });
const toolUse = (uuid: string, name: string, input: unknown) => line({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] } });

describe('claude transcripts', () => {
  it('finds the project folder the way Claude Code names it', () => {
    expect(claudeProjectDir('/Users/harig/Desktop/riaf_vscode_v2', '/h')).toBe('/h/.claude/projects/-Users-harig-Desktop-riaf-vscode-v2');
  });

  it('turns prompts, replies, tool calls and results into events, and skips everything else', () => {
    expect(parseTranscriptLine(prompt('u1', 'Fix the lane bug<system-reminder>ignore me</system-reminder>'))).toMatchObject([{ id: 'u1:0', kind: 'prompt', text: 'Fix the lane bug', session: 's1' }]);
    expect(parseTranscriptLine(line({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Looking at it.' }] } }))).toMatchObject([{ id: 'a1:1', kind: 'text', text: 'Looking at it.' }]);
    expect(parseTranscriptLine(toolUse('a2', 'Read', { file_path: '/repo/src/a.ts' }), '/repo')).toMatchObject([{ kind: 'tool', tool: 'Read', text: 'src/a.ts' }]);
    expect(parseTranscriptLine(line({ type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'exit 1' }] }] } }))).toMatchObject([{ kind: 'result', text: 'exit 1', error: true }]);
    expect(parseTranscriptLine(line({ type: 'user', uuid: 'm1', isMeta: true, message: { content: 'meta' } }))).toEqual([]);
    expect(parseTranscriptLine(line({ type: 'api-request', id: 'x' }))).toEqual([]);
    expect(parseTranscriptLine('not json')).toEqual([]);
  });

  it('describes tool calls by what they act on', () => {
    expect(describeTool('Bash', { command: 'pnpm   test\n --run' })).toBe('pnpm test --run');
    expect(describeTool('Grep', { pattern: 'charge', path: '/r/src' }, '/r')).toBe('charge in src');
    expect(describeTool('Custom', { a: 1 })).toBe('{"a":1}');
    expect(describeTool('Custom', {})).toBe('');
  });

  it('backfills recent sessions, then streams appended lines, including a session that starts later', () => {
    const dir = join(tmp, 'proj');
    mkdirSync(dir);
    writeFileSync(join(dir, 's1.jsonl'), prompt('u1', 'First task') + toolUse('a1', 'Bash', { command: 'ls' }));
    const live = new ClaudeLive('/repo', dir, { pollMs: 60_000, now: () => Date.now() });
    const got: string[] = [];
    live.on((evs) => got.push(...evs.map((e) => e.id)));
    live.start();
    const snap = live.snapshot();
    expect(snap.found).toBe(true);
    expect(snap.sessions).toMatchObject([{ id: 's1', title: 'First task', events: 2, active: true }]);
    expect(snap.events.map((e) => e.kind)).toEqual(['prompt', 'tool']);

    // a half-written line is held until its newline arrives
    const next = toolUse('a2', 'Edit', { file_path: '/repo/src/x.ts' });
    appendFileSync(join(dir, 's1.jsonl'), next.slice(0, 20));
    expect(live.poll()).toEqual([]);
    appendFileSync(join(dir, 's1.jsonl'), next.slice(20));
    expect(live.poll().map((e) => e.text)).toEqual(['src/x.ts']);

    writeFileSync(join(dir, 's2.jsonl'), line({ type: 'user', sessionId: 's2', uuid: 'u9', message: { content: 'Second' } }));
    expect(live.poll().map((e) => e.session)).toEqual(['s2']);
    expect(got).toEqual(['a2:0', 'u9:0']);
    expect(live.snapshot().sessions.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    live.stop();
  });

  it('names a session from its first prompt even when the backfill starts later, and prefers Claude Code’s own title', () => {
    expect(customTitleOf(JSON.stringify({ type: 'custom-title', customTitle: ' Fix lanes ' }))).toBe('Fix lanes');
    expect(customTitleOf(prompt('u', 'custom-title'))).toBeUndefined();
    const dir = join(tmp, 'titles');
    mkdirSync(dir);
    const filler = Array.from({ length: 40 }, (_, k) => toolUse(`f${k}`, 'Bash', { command: 'x'.repeat(100) })).join('');
    writeFileSync(join(dir, 'a.jsonl'), prompt('u1', 'The real first ask') + filler);
    writeFileSync(join(dir, 'b.jsonl'), prompt('u2', 'Prompt') + `${JSON.stringify({ type: 'custom-title', customTitle: 'Named by Claude', sessionId: 'b' })}\n`);
    const live = new ClaudeLive('/repo', dir, { backfillBytes: 600 });
    live.start();
    const titles = Object.fromEntries(live.snapshot().sessions.map((s) => [s.id, s.title]));
    expect(titles).toEqual({ a: 'The real first ask', b: 'Named by Claude' });
    live.stop();
  });

  it('reports a missing folder instead of failing', () => {
    const live = new ClaudeLive('/nowhere', join(tmp, 'missing'));
    live.start();
    expect(live.snapshot()).toMatchObject({ found: false, sessions: [], events: [] });
    live.stop();
  });
});
