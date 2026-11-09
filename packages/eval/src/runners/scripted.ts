import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { estimateTokens } from '@riaf/kernel';
import type { Task } from '../tasks.js';
import { prepareWorkspace } from '../workspace.js';
import type { Runner, RunnerContext, TaskResult } from './types.js';

/**
 * The no-RIAF baseline: a deterministic script of what an agent does without an index — list the
 * tree, grep for the request's keywords, then read the most-hit files in full. Every tool output is
 * charged as context tokens, so the numbers compare like-for-like with a compiled pack.
 */

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'should', 'instead', 'every', 'there', 'their', 'about', 'which', 'would', 'could', 'make', 'must', 'have', 'been', 'being', 'they', 'them', 'than', 'then', 'also', 'only', 'more', 'most', 'other', 'some', 'what', 'where', 'while', 'add', 'fix', 'new', 'how', 'does', 'explain', 'walk', 'through', 'flow', 'later', 'never', 'again', 'after', 'before', 'without', 'within', 'next', 'same', 'still', 'name', 'returns', 'return']);

/** Keywords an agent would grep for: identifiers and words of four or more letters, minus stop words. */
export function keywords(text: string, max = 5): string[] {
  const ids = [...text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g)].map((m) => m[0]);
  const scored = new Map<string, number>();
  for (const raw of ids) {
    const dotted = raw.includes('.');
    for (const part of raw.split('.')) {
      const w = part.length >= 4 && !STOP.has(part.toLowerCase()) ? part : '';
      if (!w) continue;
      const camel = dotted || /[a-z][A-Z]|_/.test(w) ? 3 : /^[A-Z]/.test(w) ? 2 : 1; // identifiers first
      scored.set(w, Math.max(scored.get(w) ?? 0, camel));
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max).map(([w]) => w);
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n === 'node_modules' || n === '.git' || n === '.riaf') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out;
}

export interface ScriptedOptions {
  /** Files read in full after grepping. */
  maxReads?: number;
}

export class ScriptedBaselineRunner implements Runner {
  readonly name = 'scripted-baseline';
  constructor(private readonly opts: ScriptedOptions = {}) {}

  async run(task: Task, ctx: RunnerContext): Promise<TaskResult> {
    const t0 = performance.now();
    const ws = prepareWorkspace(task, ctx.paths, { git: false });
    try {
      const files = listFiles(ws.root);
      let tokens = estimateTokens(files.join('\n')); // tool call 1: list the tree
      let calls = 1;
      const texts = new Map(files.map((f) => [f, readFileSync(join(ws.root, f), 'utf8')]));
      const hits = new Map<string, number>();
      // IDE anchors an agent would open first
      const anchors = new Set<string>([...(task.ide.activeFile ? [task.ide.activeFile] : []), ...(task.ide.failingTests ?? []).map((t) => t.split('::')[0]!)]);
      for (const m of (task.ide.stackTrace ?? '').matchAll(/([\w./-]+\.(?:ts|py|java|c|h|go|cs))/g)) anchors.add(m[1]!);
      for (const kw of keywords(task.request)) {
        calls++; // tool call: grep -rn kw
        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const lines: string[] = [];
        for (const [f, text] of texts) {
          text.split('\n').forEach((l, i) => {
            if (re.test(l)) {
              lines.push(`${f}:${i + 1}:${l}`);
              hits.set(f, (hits.get(f) ?? 0) + 1);
            }
          });
        }
        tokens += estimateTokens(lines.slice(0, 200).join('\n'));
      }
      const ranked = [...anchors].filter((a) => texts.has(a)).concat([...hits.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f));
      const read = [...new Set(ranked)].slice(0, this.opts.maxReads ?? 6);
      for (const f of read) {
        calls++; // tool call: read file
        tokens += estimateTokens(texts.get(f)!);
      }
      return { taskId: task.id, repo: task.repo, intent: task.intent, runner: this.name, files: read, tokens, toolCalls: calls, ms: performance.now() - t0 };
    } finally {
      ws.dispose();
    }
  }
}
