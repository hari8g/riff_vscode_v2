import { describe, expect, it } from 'vitest';
import { buildWorkflow, phaseOf, toolName, type WorkflowEvent } from '../src/workflow.js';

let n = 0;
const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 12, 0, s)).toISOString();
const ev = (kind: WorkflowEvent['kind'], text: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({ id: `e${n++}`, at: at(n), kind, text, ...extra });
const call = (tool: string, target: string, ref: string, error = false): WorkflowEvent[] => [ev('tool', target, { tool, ref }), ev('result', error ? 'exit 1' : 'ok', { ref, ...(error ? { error: true } : {}) })];

describe('claude code workflow', () => {
  it('classifies tool calls into phases', () => {
    expect(phaseOf('Read', 'src/a.ts')).toBe('explore');
    expect(phaseOf('Grep', 'x')).toBe('explore');
    expect(phaseOf('Edit', 'src/a.ts')).toBe('edit');
    expect(phaseOf('TodoWrite')).toBe('plan');
    expect(phaseOf('Task', 'find callers')).toBe('delegate');
    expect(phaseOf('mcp__riaf__riaf_pack', 'fix bug')).toBe('context');
    expect(phaseOf('Bash', 'pnpm test')).toBe('verify');
    expect(phaseOf('Bash', 'npx tsc --noEmit')).toBe('verify');
    expect(phaseOf('Bash', 'sed -n 1,20p src/a.ts')).toBe('explore');
    expect(phaseOf('Bash', 'git commit -m x')).toBe('run');
    expect(phaseOf('Bash', 'cd /repo/pkg && grep -rn foo src')).toBe('explore');
    expect(phaseOf('Bash', 'cd "/a b" && pnpm verify')).toBe('verify');
    expect(toolName('mcp__Claude_Browser__browser_batch')).toBe('browser_batch');
  });

  it('splits a session into turns with stages, files, commands, failures and a response', () => {
    const events = [
      ev('prompt', 'Fix the lane bug'),
      ...call('mcp__riaf__riaf_pack', 'Fix the lane bug', 'r0'),
      ...call('Read', 'src/gantry.ts', 'r1'),
      ...call('Grep', 'lane', 'r2'),
      ...call('Edit', 'src/gantry.ts', 'r3'),
      ...call('Bash', 'pnpm test', 'r4', true),
      ...call('Edit', 'src/gantry.ts', 'r5'),
      ...call('Bash', 'pnpm test', 'r6'),
      ev('text', 'Fixed: the last lane is now included.'),
      ev('prompt', 'Now commit it'),
      ev('tool', 'git commit -m fix', { tool: 'Bash', ref: 'r7' }),
    ];
    const w = buildWorkflow(events);
    expect(w.turns).toHaveLength(2);
    const [t1, t2] = w.turns;
    expect(t1!.stages.map((s) => `${s.phase}:${s.steps.length}`)).toEqual(['context:1', 'explore:2', 'edit:1', 'verify:1', 'edit:1', 'verify:1']);
    expect(t1!.stages[3]!.failed).toBe(1);
    expect(t1).toMatchObject({ prompt: 'Fix the lane bug', steps: 7, failed: 1, filesRead: ['src/gantry.ts'], filesChanged: ['src/gantry.ts'], response: 'Fixed: the last lane is now included.', open: false });
    expect(t1!.commands).toEqual([{ text: 'pnpm test', status: 'failed', phase: 'verify' }, { text: 'pnpm test', status: 'ok', phase: 'verify' }]);
    expect(t1!.durationMs).toBeGreaterThan(0);
    expect(t2).toMatchObject({ prompt: 'Now commit it', open: true, commands: [{ text: 'git commit -m fix', status: 'running', phase: 'run' }] });
    expect(w.totals).toMatchObject({ turns: 2, steps: 8, failed: 1, filesRead: 1, filesChanged: 1, commands: 3 });
    expect(w.phases).toMatchObject({ context: 1, explore: 2, edit: 2, verify: 2, run: 1, plan: 0, delegate: 0 });
  });

  it('keeps work done before the first prompt in the backfill window as a continued turn', () => {
    const w = buildWorkflow([...call('Read', 'a.ts', 'x1'), ev('text', 'done')]);
    expect(w.turns).toMatchObject([{ prompt: '(continued)', steps: 1, open: false }]);
    expect(buildWorkflow([])).toMatchObject({ turns: [], totals: { turns: 0 } });
  });
});
