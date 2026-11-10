import { listPrompts, type PromptRecord } from './runs.js';

/**
 * The RIAF sidebar (Activity Bar → RIAF): quick actions and the latest prompt runs. Each item knows
 * which console page to open, so a click lands on the right place. The data side is plain objects so
 * it is testable without VS Code; `extension.ts` turns them into tree items.
 */

export interface SidebarItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  /** Codicon id. */
  icon: string;
  /** Console page (and optional focus) to open on click. */
  open?: { page: string; arg?: string };
  /** A VS Code command to run on click instead of opening a page. */
  command?: string;
  children?: SidebarItem[];
}

const STATUS_ICON: Record<string, string> = { compiled: 'circle-outline', exported: 'send', running: 'sync~spin', done: 'pass-filled', failed: 'warning' };
const STATUS_WORD: Record<string, string> = { compiled: 'compiled', exported: 'sent', running: 'running', done: 'done', failed: 'needs a look' };
const ago = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

/** The sidebar tree for a repository; `statusOf` supplies a run's live status when the Claude Code feed knows it. */
export function sidebarItems(root: string | undefined, statusOf: (r: PromptRecord) => string = (r) => (r.exportedAt ? 'exported' : 'compiled'), now = Date.now()): SidebarItem[] {
  if (!root) return [{ id: 'open-repo', label: 'Open a repository…', icon: 'folder-opened', command: 'riaf.openRepository' }];
  const runs = listPrompts(root).slice(0, 10);
  return [
    { id: 'console', label: 'Open the RIAF Console', icon: 'home', open: { page: 'overview' }, tooltip: 'Home: start a task, see the latest runs' },
    { id: 'prompt', label: 'New prompt', description: 'compile a task', icon: 'sparkle', open: { page: 'prompt' }, tooltip: 'Describe a task; RIAF compiles it into a prompt for Claude Code' },
    { id: 'repository', label: 'Repository', description: 'browse · ask · health', icon: 'repo', open: { page: 'repository' } },
    {
      id: 'runs', label: 'Prompt runs', description: runs.length ? `${runs.length}` : 'none yet', icon: 'terminal', open: { page: 'claude' },
      children: runs.length ? runs.map((r) => {
        const st = statusOf(r);
        return {
          id: `run:${r.promptId}`, label: r.task.replace(/\s+/g, ' ').slice(0, 80), description: `${STATUS_WORD[st] ?? st} · ${ago(r.createdAt, now)}`,
          tooltip: `${r.task}\n\nPrompt ${r.promptId} · ${r.tokens.toLocaleString()} tokens · ${r.source === 'hook' ? 'typed in Claude Code' : 'from the console'}`,
          icon: STATUS_ICON[st] ?? 'circle-outline', open: { page: 'claude', arg: r.promptId },
        };
      }) : [{ id: 'runs-empty', label: 'Compile a prompt to see its run here', icon: 'info', open: { page: 'prompt' } }],
    },
    { id: 'savings', label: 'Savings', icon: 'graph-line', open: { page: 'savings' } },
    { id: 'governance', label: 'Governance', icon: 'shield', open: { page: 'governance' } },
    { id: 'reindex', label: 'Refresh the index', icon: 'refresh', command: 'riaf.index' },
  ];
}
