/**
 * The Claude Code workflow of one session: each prompt starts a turn, and the turn's tool calls are
 * grouped into the stages a developer recognises (context, explore, plan, edit, verify, run, delegate).
 * Pure: shared by the extension host, its tests and the console webview.
 */

/** The subset of a live event the workflow needs (see `claudeLive.ts`). */
export interface WorkflowEvent {
  id: string;
  at: string;
  kind: 'prompt' | 'text' | 'tool' | 'result';
  text: string;
  tool?: string;
  error?: boolean;
  ref?: string;
  sidechain?: boolean;
}

export type Phase = 'context' | 'explore' | 'plan' | 'edit' | 'verify' | 'run' | 'delegate';

/** Order and wording of the phases, as shown in the console. */
export const PHASES: { id: Phase; label: string; detail: string }[] = [
  { id: 'context', label: 'Context', detail: 'RIAF packs, symbol lookups and impact queries' },
  { id: 'explore', label: 'Explore', detail: 'reads files, searches the code and the web' },
  { id: 'plan', label: 'Plan', detail: 'writes or updates its task list' },
  { id: 'edit', label: 'Edit', detail: 'changes or creates files' },
  { id: 'verify', label: 'Verify', detail: 'builds, tests, lints and type-checks' },
  { id: 'run', label: 'Run', detail: 'other shell commands, git and tools' },
  { id: 'delegate', label: 'Delegate', detail: 'hands work to a sub-agent' },
];

export interface Step {
  id: string;
  at: string;
  tool: string;
  target: string;
  phase: Phase;
  status: 'ok' | 'failed' | 'running';
  result?: string;
  sidechain?: boolean;
}

export interface Stage { phase: Phase; steps: Step[]; failed: number }

export interface Turn {
  id: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stages: Stage[];
  steps: number;
  failed: number;
  filesRead: string[];
  filesChanged: string[];
  commands: { text: string; status: Step['status']; phase: Phase }[];
  /** Claude's last message in the turn: usually its summary of what it did. */
  response?: string;
  /** Still in progress: no reply yet after the last tool call. */
  open: boolean;
}

export interface Workflow {
  turns: Turn[];
  totals: { turns: number; steps: number; failed: number; filesRead: number; filesChanged: number; commands: number; durationMs: number };
  /** Steps per phase over the whole session. */
  phases: Record<Phase, number>;
}

const VERIFY = /\b(test|tests|vitest|jest|mocha|pytest|go test|cargo test|mvn|gradle|lint|eslint|tsc|typecheck|build|verify|check|ruff|mypy|prettier --check)\b/;
const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead', 'ToolSearch']);
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const PLAN = new Set(['TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'update_plan']);
const DELEGATE = new Set(['Task', 'Agent']);

/** Short tool name: MCP tools drop their `mcp__server__` prefix. */
export const toolName = (t = '') => (t.startsWith('mcp__') ? t.split('__').slice(2).join('__') || t : t);

/** Which stage of the workflow a tool call belongs to. */
export function phaseOf(tool: string, target = ''): Phase {
  const t = toolName(tool);
  if (/^riaf/i.test(t) || /riaf/i.test(tool)) return 'context';
  if (EXPLORE.has(t) || /^(read|get|find|search|list|query)/i.test(t)) return 'explore';
  if (EDIT.has(t)) return 'edit';
  if (PLAN.has(t)) return 'plan';
  if (DELEGATE.has(t)) return 'delegate';
  if (t === 'Bash') {
    target = target.replace(/^(\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, '');
    if (/^\s*(cat|head|tail|sed -n|grep|rg|find|ls|tree|wc|git (log|show|diff|status|blame))\b/.test(target)) return 'explore';
    if (VERIFY.test(target)) return 'verify';
  }
  return 'run';
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Builds the session's workflow from its events, oldest first. */
export function buildWorkflow(events: readonly WorkflowEvent[]): Workflow {
  const results = new Map<string, WorkflowEvent>();
  for (const e of events) if (e.kind === 'result' && e.ref) results.set(e.ref, e);
  const turns: Turn[] = [];
  let cur: { prompt: WorkflowEvent | undefined; items: WorkflowEvent[] } | undefined;
  const flush = () => {
    if (!cur || (!cur.prompt && !cur.items.some((e) => e.kind === 'tool'))) return;
    turns.push(toTurn(cur.prompt, cur.items, results));
  };
  for (const e of events) {
    if (e.kind === 'prompt' && !e.sidechain) {
      flush();
      cur = { prompt: e, items: [] };
    } else {
      cur ??= { prompt: undefined, items: [] };
      cur.items.push(e);
    }
  }
  flush();
  const phases = Object.fromEntries(PHASES.map((p) => [p.id, 0])) as Record<Phase, number>;
  for (const t of turns) for (const s of t.stages) phases[s.phase] += s.steps.length;
  const sum = (f: (t: Turn) => number) => turns.reduce((a, t) => a + f(t), 0);
  return {
    turns,
    phases,
    totals: {
      turns: turns.length, steps: sum((t) => t.steps), failed: sum((t) => t.failed),
      filesRead: uniq(turns.flatMap((t) => t.filesRead)).length, filesChanged: uniq(turns.flatMap((t) => t.filesChanged)).length,
      commands: sum((t) => t.commands.length), durationMs: sum((t) => t.durationMs),
    },
  };
}

function toTurn(prompt: WorkflowEvent | undefined, items: WorkflowEvent[], results: Map<string, WorkflowEvent>): Turn {
  const stages: Stage[] = [];
  const steps: Step[] = [];
  for (const e of items) {
    if (e.kind !== 'tool') continue;
    const r = e.ref ? results.get(e.ref) : undefined;
    const tool = toolName(e.tool);
    const step: Step = {
      id: e.id, at: e.at, tool, target: e.text, phase: phaseOf(e.tool ?? '', e.text),
      status: r ? (r.error ? 'failed' : 'ok') : 'running',
      ...(r?.text ? { result: r.text } : {}), ...(e.sidechain ? { sidechain: true } : {}),
    };
    steps.push(step);
    const last = stages[stages.length - 1];
    if (last && last.phase === step.phase) last.steps.push(step);
    else stages.push({ phase: step.phase, steps: [step], failed: 0 });
  }
  for (const s of stages) s.failed = s.steps.filter((x) => x.status === 'failed').length;
  const all = [prompt, ...items].filter((e): e is WorkflowEvent => !!e);
  const startedAt = all[0]?.at ?? new Date(0).toISOString();
  const endedAt = all[all.length - 1]?.at ?? startedAt;
  const texts = items.filter((e) => e.kind === 'text' && !e.sidechain);
  const lastTool = items.map((e) => e.kind).lastIndexOf('tool');
  const lastText = items.map((e) => e.kind === 'text' && !e.sidechain).lastIndexOf(true);
  const response = texts[texts.length - 1]?.text;
  return {
    id: prompt?.id ?? items[0]?.id ?? startedAt,
    prompt: prompt?.text ?? '(continued)',
    startedAt, endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) || 0,
    stages, steps: steps.length,
    failed: steps.filter((s) => s.status === 'failed').length,
    filesRead: uniq(steps.filter((s) => s.tool === 'Read').map((s) => s.target)),
    filesChanged: uniq(steps.filter((s) => s.phase === 'edit').map((s) => s.target)),
    commands: steps.filter((s) => s.tool === 'Bash').map((s) => ({ text: s.target, status: s.status, phase: s.phase })),
    ...(response ? { response } : {}),
    open: lastTool > lastText || steps.some((s) => s.status === 'running'),
  };
}
