import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeEdit, LiveEvent, LiveSession } from './claudeLive.js';
import { buildWorkflow, type Turn } from './workflow.js';

/**
 * Prompt runs: every agent prompt RIAF compiles is kept under `.riaf/prompts/` and keyed to the
 * Claude Code session that ran it, so the console can show a prompt next to the code Claude Code
 * generated for it.
 *
 * Keying works two ways:
 *  - exported from the console: the launch text starts with a marker, `[RIAF pr_…]`, that appears in
 *    the session's first prompt;
 *  - injected by the Claude Code prompt hook: the hook records the session id with the prompt.
 */

export interface PromptRecord {
  promptId: string;
  packId: string;
  task: string;
  host: string;
  tokens: number;
  createdAt: string;
  source: 'console' | 'hook';
  /** Set by the hook, which knows the session the prompt was injected into. */
  sessionId?: string;
  exportedAt?: string;
}

export type RunStatus = 'compiled' | 'exported' | 'running' | 'done' | 'failed';

export interface PromptRun extends PromptRecord {
  status: RunStatus;
  session?: { id: string; title: string; active: boolean; updatedAt: string };
}

export interface RunResult {
  run: PromptRun;
  prompt: string;
  /** Turns of the session that belong to this prompt (its turn and the follow-ups before the next RIAF prompt). */
  turns: Turn[];
  /** Claude Code's last reply for the prompt. */
  response?: string;
  /** The code it wrote, grouped by file in order. */
  files: { path: string; edits: CodeEdit[] }[];
  commands: { text: string; status: string }[];
  /** Claude Code's activity for this prompt, oldest first (the last 80 events), for a terminal-style feed. */
  activity: { id: string; at: string; kind: LiveEvent['kind']; text: string; tool?: string; error?: boolean }[];
  totals: { steps: number; failed: number; filesChanged: number; durationMs: number };
}

export const promptsDir = (root: string) => join(root, '.riaf', 'prompts');
/** The marker that keys a Claude Code session to a prompt. */
export const marker = (promptId: string) => `[RIAF ${promptId}]`;
const MARKER = /\[RIAF (pr_[\w]+)\]/;
const SAFE_ID = /^pr_[\w]+$/;

/** Stores a compiled prompt and its record (re-recording the same id keeps the first). */
export function recordPrompt(root: string, rec: PromptRecord, text: string): void {
  if (!SAFE_ID.test(rec.promptId)) throw new Error(`bad prompt id ${rec.promptId}`);
  const dir = promptsDir(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${rec.promptId}.md`);
  if (!existsSync(file)) writeFileSync(file, text);
  appendFileSync(join(dir, 'index.jsonl'), `${JSON.stringify(rec)}\n`);
}

/** Notes that a prompt was handed to Claude Code. */
export function markExported(root: string, promptId: string, at = new Date().toISOString()): void {
  appendFileSync(join(promptsDir(root), 'index.jsonl'), `${JSON.stringify({ promptId, exportedAt: at })}\n`);
}

/** All prompt records, newest first (later lines for the same id are merged into the first). */
export function listPrompts(root: string): PromptRecord[] {
  const file = join(promptsDir(root), 'index.jsonl');
  if (!existsSync(file)) return [];
  const byId = new Map<string, PromptRecord>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<PromptRecord> & { promptId: string };
      byId.set(r.promptId, { ...(byId.get(r.promptId) ?? ({} as PromptRecord)), ...r });
    } catch { /* torn line */ }
  }
  return [...byId.values()].filter((r) => r.task).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readPrompt(root: string, promptId: string): string | undefined {
  if (!SAFE_ID.test(promptId)) return undefined;
  const f = join(promptsDir(root), `${promptId}.md`);
  return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
}

/** What to type into Claude Code: the marker, the task, and where the full prompt is. */
export function launchText(rec: Pick<PromptRecord, 'promptId' | 'task'>): string {
  return `${marker(rec.promptId)} ${rec.task.trim().replace(/\s+/g, ' ')} — RIAF compiled the full prompt for this task in .riaf/prompts/${rec.promptId}.md: the plan, the token budget, what to watch and the context. Read it first and follow it.`;
}

/** The prompt id a session's prompts carry, if any. */
export const promptIdIn = (text: string): string | undefined => MARKER.exec(text)?.[1];

/**
 * Links records to sessions: the hook's session id first, then a marker in the session title
 * (its first prompt), then a marker anywhere in the session's prompts (`promptsOf`).
 */
export function linkRuns(records: readonly PromptRecord[], sessions: readonly LiveSession[], promptsOf: (session: string) => string[] = () => []): Map<string, LiveSession> {
  const out = new Map<string, LiveSession>();
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  for (const r of records) if (r.sessionId && byId.has(r.sessionId)) out.set(r.promptId, byId.get(r.sessionId)!);
  for (const s of sessions) {
    const id = promptIdIn(s.title);
    if (id && !out.has(id)) out.set(id, s);
  }
  const pending = records.filter((r) => !out.has(r.promptId) && r.exportedAt);
  if (pending.length) {
    for (const s of sessions) {
      if (pending.every((r) => s.updatedAt < r.exportedAt!)) continue;
      for (const p of promptsOf(s.id)) {
        const id = promptIdIn(p);
        if (id && !out.has(id)) out.set(id, s);
      }
    }
  }
  return out;
}

/** A record's status from its linked session's events. */
export function statusOf(rec: PromptRecord, session: LiveSession | undefined, result?: Pick<RunResult, 'turns'>): RunStatus {
  if (!session) return rec.exportedAt ? 'exported' : 'compiled';
  const turns = result?.turns ?? [];
  if (session.active || turns.some((t) => t.open)) return 'running';
  return turns.some((t) => t.failed > 0 && t.filesChanged.length === 0) ? 'failed' : 'done';
}

/** The part of a session's events that answers one prompt, as the console shows it. */
export function runResult(run: PromptRun, prompt: string, events: readonly LiveEvent[]): RunResult {
  const flow = buildWorkflow(events);
  // the prompt's own turn: the one carrying its marker, else (hook-injected) the one whose text matches the task
  let start = flow.turns.findIndex((t) => promptIdIn(t.prompt) === run.promptId);
  if (start < 0) start = flow.turns.findIndex((t) => t.prompt.trim().startsWith(run.task.trim().slice(0, 60)));
  if (start < 0 && run.sessionId) start = 0;
  const turns: Turn[] = [];
  if (start >= 0) {
    for (const t of flow.turns.slice(start)) {
      const other = promptIdIn(t.prompt);
      if (turns.length && other && other !== run.promptId) break;
      turns.push(t);
    }
  }
  const ids = new Set(turns.flatMap((t) => t.stages.flatMap((s) => s.steps.map((x) => x.id))));
  const files = new Map<string, CodeEdit[]>();
  for (const e of events) {
    if (!ids.has(e.id) || !e.edits) continue;
    for (const ed of e.edits) files.set(ed.path, [...(files.get(ed.path) ?? []), ed]);
  }
  const response = [...turns].reverse().find((t) => t.response)?.response;
  // the run's slice of the event stream: from its first turn's prompt to the next RIAF prompt
  const from = turns.length ? events.findIndex((e) => e.id === turns[0]!.id) : -1;
  let to = events.length;
  if (from >= 0) for (let i = from + 1; i < events.length; i++) {
    const other = events[i]!.kind === 'prompt' ? promptIdIn(events[i]!.text) : undefined;
    if (other && other !== run.promptId) { to = i; break; }
  }
  const activity = from < 0 ? [] : events.slice(from, to).filter((e) => !e.sidechain).slice(-80)
    .map((e) => ({ id: e.id, at: e.at, kind: e.kind, text: e.kind === 'result' ? e.text.slice(0, 240) : e.text.slice(0, 600), ...(e.tool ? { tool: e.tool } : {}), ...(e.error ? { error: true } : {}) }));
  const status = statusOf(run, run.session as LiveSession | undefined, { turns });
  return {
    run: { ...run, status },
    prompt,
    turns,
    ...(response ? { response } : {}),
    files: [...files.entries()].map(([path, edits]) => ({ path, edits })),
    commands: turns.flatMap((t) => t.commands.map((c) => ({ text: c.text, status: c.status }))),
    activity,
    totals: {
      steps: turns.reduce((a, t) => a + t.steps, 0), failed: turns.reduce((a, t) => a + t.failed, 0),
      filesChanged: files.size || new Set(turns.flatMap((t) => t.filesChanged)).size, durationMs: turns.reduce((a, t) => a + t.durationMs, 0),
    },
  };
}
