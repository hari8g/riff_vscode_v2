import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { markExported, recordPrompt } from '../src/runs.js';
import { sidebarItems } from '../src/sidebar.js';

const root = mkdtempSync(join(tmpdir(), 'riaf-sidebar-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('RIAF sidebar', () => {
  it('asks for a repository when none is open', () => {
    expect(sidebarItems(undefined)).toEqual([{ id: 'open-repo', label: 'Open a repository…', icon: 'folder-opened', command: 'riaf.openRepository' }]);
  });

  it('lists actions and the latest prompt runs, each opening the right console page', () => {
    const empty = sidebarItems(root);
    expect(empty.map((i) => i.id)).toEqual(['console', 'prompt', 'repository', 'runs', 'savings', 'governance', 'reindex']);
    expect(empty.find((i) => i.id === 'runs')!.children![0]!.label).toMatch(/Compile a prompt/);

    const now = Date.parse('2026-11-10T12:00:00Z');
    recordPrompt(root, { promptId: 'pr_one', packId: 'pk-1', task: 'Build a new feature\nfor ISS passes', host: 'claude', tokens: 4200, createdAt: '2026-11-10T11:58:00Z', source: 'console' }, '# p');
    recordPrompt(root, { promptId: 'pr_two', packId: 'pk-2', task: 'Fix the marker', host: 'claude', tokens: 3100, createdAt: '2026-11-10T11:59:30Z', source: 'hook', sessionId: 's' }, '# p');
    markExported(root, 'pr_one');
    const items = sidebarItems(root, (r) => (r.promptId === 'pr_two' ? 'done' : r.exportedAt ? 'exported' : 'compiled'), now);
    const runs = items.find((i) => i.id === 'runs')!;
    expect(runs.description).toBe('2');
    expect(runs.children!.map((c) => [c.label, c.description, c.icon, c.open])).toEqual([
      ['Fix the marker', 'done · just now', 'pass-filled', { page: 'claude', arg: 'pr_two' }],
      ['Build a new feature for ISS passes', 'sent · 2 min ago', 'send', { page: 'claude', arg: 'pr_one' }],
    ]);
    expect(runs.children![0]!.tooltip).toContain('typed in Claude Code');
    expect(items.find((i) => i.id === 'reindex')!.command).toBe('riaf.index');
  });
});
