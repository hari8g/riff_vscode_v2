import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import type { Task } from '../tasks.js';
import { writeHidden } from '../tasks.js';
import { runTaskTests } from '../testrun.js';
import { prepareWorkspace, type Workspace } from '../workspace.js';
import type { Runner, RunnerContext, TaskResult } from './types.js';

/**
 * Runs a task through Claude Code headless (`claude -p ... --output-format stream-json`) in a fresh
 * workspace, then adds the hidden tests and runs them. Token usage, cost and tool calls come from the
 * stream; files are those read through tools plus those the run changed (git diff).
 * The `riaf` condition (M3) adds the RIAF MCP server; `baseline` runs the bare harness.
 */

export interface ClaudeRunnerOptions {
  /** Executable; defaults to `claude` on PATH. Tests point this at a fake. */
  command?: string;
  model?: string;
  maxTurns?: number;
  /** Extra CLI args (e.g. `--mcp-config <file>` for the RIAF condition). */
  extraArgs?: (ws: Workspace) => string[];
  label?: string;
}

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[]; usage?: Usage };
  usage?: Usage;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  result?: string;
}
interface Usage { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/** Parses Claude Code stream-json output into tool calls, files and usage. */
export function parseClaudeStream(text: string, root: string): { toolCalls: number; files: string[]; tokens: number; costUsd?: number; error?: string } {
  let toolCalls = 0;
  const files = new Set<string>();
  let tokens = 0;
  let costUsd: number | undefined;
  let error: string | undefined;
  const rel = (p: string) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p.replace(/^\.\//, ''));
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev: StreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        toolCalls++;
        const p = (c.input?.['file_path'] ?? c.input?.['path'] ?? c.input?.['notebook_path']) as string | undefined;
        if (p && /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name ?? '')) files.add(rel(p));
      }
    } else if (ev.type === 'result') {
      const u = ev.usage ?? {};
      tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      costUsd = ev.total_cost_usd;
      if (ev.is_error) error = ev.result ?? ev.subtype ?? 'error';
    }
  }
  return { toolCalls, files: [...files].sort(), tokens, ...(costUsd !== undefined ? { costUsd } : {}), ...(error ? { error } : {}) };
}

export class ClaudeHeadlessRunner implements Runner {
  readonly name: string;
  constructor(private readonly opts: ClaudeRunnerOptions = {}) {
    this.name = opts.label ?? 'claude-headless';
  }

  async run(task: Task, ctx: RunnerContext): Promise<TaskResult> {
    const t0 = performance.now();
    const ws = prepareWorkspace(task, ctx.paths);
    try {
      const prompt = [
        task.request,
        task.ide.stackTrace ? `\nStack trace:\n${task.ide.stackTrace}` : '',
        task.ide.failingTests?.length ? `\nFailing tests: ${task.ide.failingTests.join(', ')}` : '',
        task.intent === 'onboarding' ? '\nAnswer in prose; do not modify files.' : '\nMake the change in the repository. Do not ask questions; do not create commits.',
      ].join('');
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--max-turns', String(this.opts.maxTurns ?? 30),
        ...(this.opts.model ? ['--model', this.opts.model] : []), ...(this.opts.extraArgs?.(ws) ?? [])];
      const out = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
        const child = spawn(this.opts.command ?? 'claude', args, { cwd: ws.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
        const timer = setTimeout(() => child.kill('SIGTERM'), ctx.timeoutMs ?? 15 * 60_000);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, code });
        });
        child.on('error', () => {
          clearTimeout(timer);
          resolve({ stdout, code: -1 });
        });
      });
      const parsed = parseClaudeStream(out.stdout, ws.root);
      const changed = execFileSync('git', ['status', '--porcelain'], { cwd: ws.root, encoding: 'utf8' })
        .split('\n').filter(Boolean).map((l) => l.slice(3).trim()).filter((p) => !p.startsWith('node_modules'));
      const files = [...new Set([...parsed.files, ...changed])].sort();
      let passed: boolean | undefined;
      let testsSkipped: string | undefined;
      if (task.test) {
        writeHidden(ws.root, task);
        const t = runTaskTests(task, ws.root, ctx.paths);
        if (t.skipped) testsSkipped = t.skipped;
        else passed = t.passed;
      }
      return {
        taskId: task.id, repo: task.repo, intent: task.intent, runner: this.name, files, tokens: parsed.tokens, toolCalls: parsed.toolCalls,
        ...(passed !== undefined ? { passed } : {}), ...(testsSkipped ? { testsSkipped } : {}),
        ...(parsed.costUsd !== undefined ? { costUsd: parsed.costUsd } : {}),
        ...(parsed.error || out.code ? { error: parsed.error ?? `exit ${out.code}` } : {}),
        ms: performance.now() - t0,
      };
    } finally {
      ws.dispose();
    }
  }
}
