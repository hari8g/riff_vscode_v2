import { watch, type FSWatcher } from 'node:fs';
import { DEFAULT_IGNORED_DIRS } from '@riaf/parse';

/**
 * Debounced file-system watcher. Working-tree edits trigger a normal pipeline run; changes to git
 * refs (`.git/HEAD`, `.git/refs/...`) are reported separately so the history stage can mine new
 * commits. Falls back to polling when recursive watching is unavailable.
 */

export type WatchReason = 'fs' | 'git';

export interface WatcherOptions {
  debounceMs?: number;
  pollMs?: number;
  /** Force polling (tests, network drives). */
  poll?: boolean;
}

const IGNORED = new Set(DEFAULT_IGNORED_DIRS.filter((d) => d !== '.git'));

/** Classifies a changed path (relative to the root) as working-tree, git-ref or ignored. */
export function classifyChange(rel: string): WatchReason | undefined {
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('.git/')) {
    return p === '.git/HEAD' || p.startsWith('.git/refs/') || p === '.git/packed-refs' || p === '.git/ORIG_HEAD' ? 'git' : undefined;
  }
  if (p === '.git') return undefined;
  const parts = p.split('/');
  if (parts.some((s) => IGNORED.has(s))) return undefined;
  if (parts[0] === '.riaf') return undefined;
  return 'fs';
}

export class RepoWatcher {
  private fsw: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private poller: NodeJS.Timeout | undefined;
  private pending = new Set<WatchReason>();

  constructor(
    private readonly root: string,
    private readonly onChange: (reasons: ReadonlySet<WatchReason>) => void,
    private readonly opts: WatcherOptions = {},
  ) {}

  start(): 'watch' | 'poll' {
    if (!this.opts.poll) {
      try {
        this.fsw = watch(this.root, { recursive: true }, (_event, filename) => {
          if (!filename) return this.queue('fs');
          const reason = classifyChange(filename.toString());
          if (reason) this.queue(reason);
        });
        this.fsw.on('error', () => this.fallback());
        return 'watch';
      } catch {
        // recursive watch unsupported on this platform/filesystem
      }
    }
    this.fallback();
    return 'poll';
  }

  private fallback(): void {
    this.fsw?.close();
    this.fsw = undefined;
    if (!this.poller) this.poller = setInterval(() => this.onChange(new Set<WatchReason>(['fs', 'git'])), this.opts.pollMs ?? 5000);
  }

  private queue(reason: WatchReason): void {
    this.pending.add(reason);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const reasons = this.pending;
      this.pending = new Set();
      this.timer = undefined;
      this.onChange(reasons);
    }, this.opts.debounceMs ?? 250);
  }

  stop(): void {
    this.fsw?.close();
    this.fsw = undefined;
    if (this.timer) clearTimeout(this.timer);
    if (this.poller) clearInterval(this.poller);
    this.timer = undefined;
    this.poller = undefined;
  }
}
