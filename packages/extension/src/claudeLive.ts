import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

/**
 * Follows what Claude Code does in a repository by tailing its session transcripts
 * (`~/.claude/projects/<encoded root>/<session>.jsonl`). Read-only: nothing is written to Claude Code's
 * files, and no hook has to be installed for the console to show a session live.
 */

/** One thing that happened in a Claude Code session, ready for the console to render. */
export interface LiveEvent {
  id: string;
  session: string;
  at: string;
  kind: 'prompt' | 'text' | 'tool' | 'result';
  text: string;
  tool?: string;
  error?: boolean;
  /** Links a tool call to its result (Claude Code's tool_use id). */
  ref?: string;
  /** True for steps a sub-agent took on the main session's behalf. */
  sidechain?: boolean;
}

/** One transcript file: a Claude Code session in this repository. */
export interface LiveSession {
  id: string;
  title: string;
  updatedAt: string;
  /** Written to in the last `activeMs` (default 20 s). */
  active: boolean;
  events: number;
}

/** Claude Code's folder for a repository's transcripts: every non-alphanumeric character becomes `-`. */
export function claudeProjectDir(root: string, home = homedir()): string {
  return join(home, '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const stripTags = (s: string) => s.replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, '').trim();

/** A short description of a tool call: the command, file, pattern or URL it acts on. */
export function describeTool(name: string, input: Record<string, unknown> | undefined, root?: string): string {
  const i = input ?? {};
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  const path = (p: string | undefined) => (p && root && p.startsWith(root) ? relative(root, p) || '.' : p);
  const pick = str('command') ?? path(str('file_path') ?? str('notebook_path') ?? str('path')) ?? str('pattern') ?? str('url') ?? str('query') ?? str('description') ?? str('prompt');
  if (name === 'Grep' && str('pattern')) return clip(`${str('pattern')}${str('path') ? ` in ${path(str('path'))}` : ''}`, 200);
  if (pick) return clip(oneLine(pick), 200);
  const json = JSON.stringify(i);
  return json === '{}' ? '' : clip(json, 200);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).filter(Boolean).join('\n');
  return '';
}

/** Turns one transcript line into the events it holds; anything that is not a message yields none. */
export function parseTranscriptLine(line: string, root?: string): LiveEvent[] {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  if ((o['type'] !== 'user' && o['type'] !== 'assistant') || o['isMeta']) return [];
  const msg = o['message'] as { content?: unknown } | undefined;
  if (!msg) return [];
  const base = { session: String(o['sessionId'] ?? ''), at: String(o['timestamp'] ?? new Date().toISOString()), ...(o['isSidechain'] ? { sidechain: true } : {}) };
  const uuid = String(o['uuid'] ?? `${base.session}:${base.at}`);
  const blocks: unknown[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : [];
  const out: LiveEvent[] = [];
  blocks.forEach((b, k) => {
    if (!b || typeof b !== 'object') return;
    const blk = b as Record<string, unknown>;
    const id = `${uuid}:${k}`;
    if (blk['type'] === 'text') {
      const text = o['type'] === 'user' ? stripTags(String(blk['text'] ?? '')) : String(blk['text'] ?? '').trim();
      if (text) out.push({ id, ...base, kind: o['type'] === 'user' ? 'prompt' : 'text', text: clip(text, 2000) });
    } else if (blk['type'] === 'tool_use') {
      const tool = String(blk['name'] ?? 'tool');
      out.push({ id, ...base, kind: 'tool', tool, text: describeTool(tool, blk['input'] as Record<string, unknown> | undefined, root), ...(blk['id'] ? { ref: String(blk['id']) } : {}) });
    } else if (blk['type'] === 'tool_result') {
      const text = clip(resultText(blk['content']).trim(), 600);
      out.push({ id, ...base, kind: 'result', text, ...(blk['is_error'] ? { error: true } : {}), ...(blk['tool_use_id'] ? { ref: String(blk['tool_use_id']) } : {}) });
    }
  });
  return out;
}

/** The title Claude Code gave a session (`custom-title` record), if this line holds one. */
export function customTitleOf(line: string): string | undefined {
  if (!line.includes('"custom-title"')) return undefined;
  try {
    const o = JSON.parse(line) as { type?: string; customTitle?: unknown };
    return o.type === 'custom-title' && typeof o.customTitle === 'string' && o.customTitle.trim() ? o.customTitle.trim() : undefined;
  } catch {
    return undefined;
  }
}

interface Tail {
  offset: number;
  partial: string;
  title: string;
  /** The title came from Claude Code itself and wins over the first prompt. */
  named?: boolean;
  events: number;
  mtime: number;
}

export interface ClaudeLiveOptions {
  /** Poll interval; transcripts are appended to, so a stat per file per tick is enough. Default 1000. */
  pollMs?: number;
  /** Bytes read from the end of each recent transcript on start, so the console opens with context. */
  backfillBytes?: number;
  /** How many of the most recent sessions to backfill. Default 3. */
  backfillSessions?: number;
  /** Events kept in memory for a console that opens later. Default 400. */
  keep?: number;
  activeMs?: number;
  now?: () => number;
}

/** Tails every transcript in one Claude Code project folder and reports new events as they are written. */
export class ClaudeLive {
  private tails = new Map<string, Tail>();
  private buffer: LiveEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private listeners = new Set<(events: LiveEvent[]) => void>();
  private readonly o: Required<ClaudeLiveOptions>;

  constructor(readonly root: string, readonly dir = claudeProjectDir(root), opts: ClaudeLiveOptions = {}) {
    this.o = { pollMs: 1000, backfillBytes: 256 * 1024, backfillSessions: 3, keep: 400, activeMs: 20_000, now: Date.now, ...opts };
  }

  /** Reads the recent history once and starts polling. Safe to call twice. */
  start(): void {
    if (this.timer) return;
    const files = this.files().sort((a, b) => a.mtime - b.mtime);
    const recent = new Set(files.slice(-this.o.backfillSessions).map((f) => f.id));
    for (const f of files) {
      const from = recent.has(f.id) ? Math.max(0, f.size - this.o.backfillBytes) : f.size;
      this.tails.set(f.id, { offset: from, partial: '', title: '', events: 0, mtime: f.mtime });
      this.readTitle(f.id, f.size);
      if (recent.has(f.id)) this.read(f.id, f.size, from > 0);
    }
    this.buffer.sort((a, b) => a.at.localeCompare(b.at));
    this.timer = setInterval(() => this.poll(), this.o.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  /** Subscribes to new events; returns the unsubscribe function. */
  on(listener: (events: LiveEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sessions newest first, and the events kept in memory (oldest first). */
  snapshot(): { dir: string; found: boolean; sessions: LiveSession[]; events: LiveEvent[] } {
    const now = this.o.now();
    const sessions = [...this.tails.entries()]
      .map(([id, t]) => ({ id, title: t.title || 'Untitled session', updatedAt: new Date(t.mtime).toISOString(), active: now - t.mtime < this.o.activeMs, events: t.events }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { dir: this.dir, found: existsSync(this.dir), sessions, events: [...this.buffer] };
  }

  /** Every event of one session, read from its transcript (the last `maxBytes`, default 16 MB). */
  sessionEvents(id: string, maxBytes = 16 * 1024 * 1024): LiveEvent[] {
    if (!/^[\w-]+$/.test(id)) return [];
    const file = join(this.dir, `${id}.jsonl`);
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    const from = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - from);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, buf.length, from);
    } finally {
      closeSync(fd);
    }
    const lines = buf.toString('utf8').split('\n');
    if (from > 0) lines.shift();
    return lines.flatMap((l) => (l ? parseTranscriptLine(l, this.root) : [])).map((e) => ({ ...e, session: e.session || id }));
  }

  /** Checks every transcript for new lines now (the timer calls this). */
  poll(): LiveEvent[] {
    const fresh: LiveEvent[] = [];
    for (const f of this.files()) {
      let t = this.tails.get(f.id);
      if (!t) {
        t = { offset: 0, partial: '', title: '', events: 0, mtime: f.mtime };
        this.tails.set(f.id, t);
      }
      if (f.size < t.offset) Object.assign(t, { offset: 0, partial: '' }); // rewritten from scratch
      t.mtime = f.mtime;
      if (f.size > t.offset) fresh.push(...this.read(f.id, f.size, false));
    }
    if (fresh.length) for (const l of this.listeners) l(fresh);
    return fresh;
  }

  private files(): { id: string; size: number; mtime: number }[] {
    if (!existsSync(this.dir)) return [];
    const out: { id: string; size: number; mtime: number }[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const s = statSync(join(this.dir, name));
        out.push({ id: name.slice(0, -6), size: s.size, mtime: s.mtimeMs });
      } catch { /* removed between readdir and stat */ }
    }
    return out;
  }

  /** Names a session from the start of its transcript (first prompt or title), before any backfill. */
  private readTitle(id: string, size: number): void {
    const t = this.tails.get(id)!;
    const len = Math.min(size, 128 * 1024);
    if (!len) return;
    const buf = Buffer.alloc(len);
    const fd = openSync(join(this.dir, `${id}.jsonl`), 'r');
    try {
      readSync(fd, buf, 0, len, 0);
    } finally {
      closeSync(fd);
    }
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.pop();
    for (const l of lines) {
      const named = customTitleOf(l);
      if (named) Object.assign(t, { title: clip(named, 90), named: true });
      if (t.title) continue;
      const first = parseTranscriptLine(l).find((e) => e.kind === 'prompt' && !e.sidechain);
      if (first) t.title = clip(oneLine(first.text), 90);
    }
  }

  private read(id: string, size: number, skipFirstLine: boolean): LiveEvent[] {
    const t = this.tails.get(id)!;
    const len = size - t.offset;
    const buf = Buffer.alloc(len);
    const fd = openSync(join(this.dir, `${id}.jsonl`), 'r');
    try {
      readSync(fd, buf, 0, len, t.offset);
    } finally {
      closeSync(fd);
    }
    t.offset = size;
    const lines = (t.partial + buf.toString('utf8')).split('\n');
    t.partial = lines.pop() ?? '';
    if (skipFirstLine) lines.shift(); // the backfill window starts mid-line
    for (const l of lines) {
      const named = customTitleOf(l);
      if (named) Object.assign(t, { title: clip(named, 90), named: true });
    }
    const events = lines.flatMap((l) => (l ? parseTranscriptLine(l, this.root) : []));
    for (const e of events) {
      e.session ||= id;
      if (!t.title && e.kind === 'prompt' && !e.sidechain) t.title = clip(oneLine(e.text), 90);
    }
    t.events += events.length;
    this.buffer.push(...events);
    if (this.buffer.length > this.o.keep) this.buffer.splice(0, this.buffer.length - this.o.keep);
    return events;
  }
}
