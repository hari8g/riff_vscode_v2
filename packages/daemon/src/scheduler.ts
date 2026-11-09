import { EventBus, toRiafError, type Logger, type PipelineEvents } from '@riaf/kernel';
import type { Store } from '@riaf/store';

/**
 * The incremental pipeline: an ordered DAG of stages (scan → parse → graph → lsp → history →
 * summaries → embed), each gated by the Merkle table so it only touches what changed. Triggers that
 * arrive during a run are coalesced into exactly one follow-up run.
 */

export interface StageContext {
  store: Store;
  root: string;
  events: EventBus<PipelineEvents>;
  logger: Logger;
  signal: AbortSignal;
  /** Why this run started (fs, git, startup, rpc). */
  reason: string;
  /** Stage names requested explicitly (index.rebuild), empty for a normal run. */
  only: ReadonlySet<string>;
}

export interface StageOutcome {
  /** Items the stage changed (files parsed, edges rebuilt, commits mined...). */
  changed: number;
  detail?: Record<string, unknown>;
}

export interface PipelineStage {
  name: string;
  /** Stages that must run before this one in the same run. */
  after?: readonly string[];
  /** Merkle-gated stages report pending work from `changedSince(name)`. */
  merkleGated?: boolean;
  /** Disabled stages stay registered (status shows them) but never run. */
  enabled?: () => boolean;
  run(ctx: StageContext): Promise<StageOutcome>;
}

export interface StageStatus {
  stage: string;
  pending: number;
  done: number;
  lastMs?: number;
  lastError?: string;
  enabled: boolean;
}

export interface RunSummary {
  reason: string;
  stages: { stage: string; changed: number; ms: number; error?: string }[];
  ms: number;
}

/** Orders stages so each runs after its `after` dependencies (stable for independent stages). */
export function orderStages(stages: readonly PipelineStage[]): PipelineStage[] {
  const byName = new Map(stages.map((s) => [s.name, s]));
  const out: PipelineStage[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (s: PipelineStage) => {
    const st = state.get(s.name);
    if (st === 'done') return;
    if (st === 'visiting') throw new Error(`pipeline cycle at stage ${s.name}`);
    state.set(s.name, 'visiting');
    for (const dep of s.after ?? []) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    state.set(s.name, 'done');
    out.push(s);
  };
  for (const s of stages) visit(s);
  return out;
}

export class Scheduler {
  readonly events = new EventBus<PipelineEvents>();
  private readonly stages: PipelineStage[];
  private readonly stats = new Map<string, { done: number; lastMs?: number; lastError?: string }>();
  private running: Promise<RunSummary> | undefined;
  private rerun: { reason: string; only: Set<string> } | undefined;
  private abort = new AbortController();
  private lastRun: RunSummary | undefined;
  private runs = 0;

  constructor(
    stages: readonly PipelineStage[],
    private readonly store: Store,
    private readonly root: string,
    private readonly logger: Logger,
    private readonly afterRun?: (s: RunSummary) => Promise<void> | void,
  ) {
    this.stages = orderStages(stages);
    for (const s of this.stages) this.stats.set(s.name, { done: 0 });
  }

  get stageNames(): string[] {
    return this.stages.map((s) => s.name);
  }

  get busy(): boolean {
    return this.running !== undefined;
  }

  get completedRuns(): number {
    return this.runs;
  }

  get last(): RunSummary | undefined {
    return this.lastRun;
  }

  /**
   * Requests a pipeline run. While a run is in progress the request is merged into a single follow-up
   * run; the returned promise resolves when the run that covers this request has finished.
   */
  trigger(reason: string, only: readonly string[] = []): Promise<RunSummary> {
    if (this.running) {
      if (!this.rerun) this.rerun = { reason, only: new Set(only) };
      else {
        if (only.length === 0) this.rerun.only.clear();
        else if (this.rerun.only.size) for (const o of only) this.rerun.only.add(o);
        this.rerun.reason = `${this.rerun.reason},${reason}`;
      }
      return this.running.then(() => this.running ?? this.lastRun!).then((r) => r);
    }
    this.running = this.loop(reason, new Set(only));
    return this.running;
  }

  private async loop(reason: string, only: Set<string>): Promise<RunSummary> {
    let summary = await this.runOnce(reason, only);
    while (this.rerun) {
      const next = this.rerun;
      this.rerun = undefined;
      summary = await this.runOnce(next.reason, next.only);
    }
    this.running = undefined;
    return summary;
  }

  private async runOnce(reason: string, only: ReadonlySet<string>): Promise<RunSummary> {
    const t0 = performance.now();
    const ctx: StageContext = { store: this.store, root: this.root, events: this.events, logger: this.logger, signal: this.abort.signal, reason, only };
    const summary: RunSummary = { reason, stages: [], ms: 0 };
    for (const s of this.stages) {
      if (s.enabled && !s.enabled()) continue;
      if (only.size && !only.has(s.name) && s.name !== 'scan') continue;
      if (this.abort.signal.aborted) break;
      const st = this.stats.get(s.name)!;
      const s0 = performance.now();
      try {
        const out = await s.run(ctx);
        st.done += out.changed;
        st.lastMs = performance.now() - s0;
        delete st.lastError;
        summary.stages.push({ stage: s.name, changed: out.changed, ms: st.lastMs });
      } catch (e) {
        const err = toRiafError(e);
        st.lastMs = performance.now() - s0;
        st.lastError = err.message;
        summary.stages.push({ stage: s.name, changed: 0, ms: st.lastMs, error: err.message });
        this.events.emit('stage:error', { stage: s.name, error: err.message });
        this.logger.error('stage failed', { stage: s.name, error: err.message });
      }
    }
    summary.ms = performance.now() - t0;
    this.lastRun = summary;
    this.runs++;
    try {
      await this.afterRun?.(summary);
    } catch (e) {
      this.logger.warn('afterRun failed', { error: String(e) });
    }
    return summary;
  }

  status(): StageStatus[] {
    return this.stages.map((s) => {
      const st = this.stats.get(s.name)!;
      const enabled = s.enabled ? s.enabled() : true;
      const pending = s.merkleGated ? this.store.merkle.changedSince(s.name).length : 0;
      return {
        stage: s.name, pending, done: st.done, enabled,
        ...(st.lastMs !== undefined ? { lastMs: st.lastMs } : {}),
        ...(st.lastError !== undefined ? { lastError: st.lastError } : {}),
      };
    });
  }

  /** Waits for any in-flight run, then stops scheduling. */
  async stop(): Promise<void> {
    this.rerun = undefined;
    if (this.running) await this.running.catch(() => undefined);
    this.abort.abort();
  }
}
