import { describe, expect, it } from 'vitest';
import { canonicalize, checkGolden, lineDiff } from '../src/golden.js';
import { runEval } from '../src/harness.js';
import { compare, fileRecall, summarize } from '../src/metrics.js';
import { renderMarkdown } from '../src/report.js';
import { ClaudeHeadlessRunner, parseClaudeStream } from '../src/runners/claude.js';
import { keywords, ScriptedBaselineRunner } from '../src/runners/scripted.js';
import type { TaskResult } from '../src/runners/types.js';
import { loadTasks } from '../src/tasks.js';
import { defaultPaths } from '../src/workspace.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const paths = defaultPaths(__dirname);
const tasks = loadTasks(paths.tasks);
const task = (id: string) => tasks.find((t) => t.id === id)!;

describe('scripted baseline', () => {
  it('extracts identifier-first keywords', () => {
    expect(keywords('Rename Ledger.post to Ledger.record everywhere, including callers and tests.')).toEqual(expect.arrayContaining(['Ledger', 'record', 'Rename']));
    expect(keywords('decode() crashes with struct.error on truncated frames')).toEqual(expect.arrayContaining(['struct', 'error', 'truncated']));
  });

  it('greps and reads like an agent without an index, charging every tool output', async () => {
    const r = await new ScriptedBaselineRunner().run(task('toll-004'), { paths });
    expect(r.files[0]).toBe('src/gantry/dedupe.ts'); // the active file is opened first
    expect(r.toolCalls).toBeGreaterThan(3);
    expect(r.tokens).toBeGreaterThan(500);
    expect(fileRecall(task('toll-004'), r.files)).toBe(1);
  });
});

describe('Claude headless runner', () => {
  it('parses stream-json for tool calls, files and usage', () => {
    const s = parseClaudeStream([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/src/a.ts' } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
      'not json',
      JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.5, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } }),
    ].join('\n'), '/r');
    expect(s).toEqual({ toolCalls: 2, files: ['src/a.ts'], tokens: 115, costUsd: 0.5 });
  });

  it('runs a task end to end against a fake claude and scores it with the hidden tests', async () => {
    const runner = new ClaudeHeadlessRunner({ command: resolve(__dirname, 'fixtures/fake-claude.mjs'), label: 'fake-claude' });
    const r = await runner.run(task('toll-002'), { paths });
    expect(r).toMatchObject({ taskId: 'toll-002', runner: 'fake-claude', toolCalls: 3, tokens: 6500, costUsd: 0.0123, passed: true, files: ['src/pricing/peak.ts'] });
    expect(r.error).toBeUndefined();
  }, 60_000);
});

describe('metrics and report', () => {
  const rs = (runner: string, tokens: number, calls: number, files: string[], passed?: boolean): TaskResult => ({ taskId: 'toll-010', repo: 'toll-ts', intent: 'refactor', runner, files, tokens, toolCalls: calls, ms: 1, ...(passed !== undefined ? { passed } : {}) });
  it('summarizes, compares and renders', () => {
    const t = task('toll-010');
    const base = summarize('base', [t], [rs('base', 10000, 10, ['src/toll/ledger.ts'], false)]);
    const cand = summarize('riaf', [t], [rs('riaf', 6000, 4, t.gold_files, true)]);
    expect(base.recall).toBeCloseTo(1 / 3, 5);
    expect(cand.recall).toBe(1);
    const c = compare(base, cand);
    expect(c.tokenReduction).toBeCloseTo(0.4, 5);
    expect(c.toolCallReduction).toBeCloseTo(0.6, 5);
    expect(c.passRateDelta).toBe(1);
    const md = renderMarkdown({ generatedAt: 'now', summaries: [base, cand], results: [] }, [t]);
    expect(md).toContain('| riaf | 1 | 100.0% |');
    expect(md).toContain('tokens 40.0% fewer');
  });

  it('runEval isolates runner failures per task', async () => {
    const boom = { name: 'boom', run: async () => { throw new Error('nope'); } };
    const rep = await runEval([task('toll-001')], [boom], { paths });
    expect(rep.results[0]?.error).toBe('nope');
    expect(rep.summaries[0]?.errors).toBe(1);
  });
});

describe('golden packs', () => {
  it('canonicalizes away volatile fields and key order, and diffs', () => {
    expect(canonicalize({ b: 1, a: { createdAt: 'x', z: [2, 1] }, packId: 'p' })).toBe('{\n  "a": {\n    "z": [\n      2,\n      1\n    ]\n  },\n  "b": 1\n}\n');
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual(['- b', '+ x']);
    const dir = mkdtempSync(join(tmpdir(), 'riaf-golden-'));
    try {
      expect(checkGolden(dir, 'p1', { x: 1 }).status).toBe('new');
      expect(checkGolden(dir, 'p1', { x: 1 }, true).status).toBe('new');
      expect(checkGolden(dir, 'p1', { x: 1, createdAt: 'later' }).status).toBe('same');
      const d = checkGolden(dir, 'p1', { x: 2 });
      expect(d.status).toBe('changed');
      expect(d.diff).toEqual(['-   "x": 1', '+   "x": 2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
