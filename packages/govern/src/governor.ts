import { estimateTokens, hashWith, systemClock, type Clock, type GovernanceFile, type Pack, type ToolCall, type ToolDecision } from '@riaf/kernel';
import type { Graph } from '@riaf/graph';
import type { Store } from '@riaf/store';
import { checkBudget, newBudgetState, type BudgetState, type Phase } from './budgets.js';
import { distill, recomputePriors, recordUtilisation } from './learn.js';
import { callKey, EDIT_TOOLS, isTestCommand, relPath } from './normalize.js';
import { serveGlob, serveGrep } from './serve.js';

/**
 * The governor behind the Claude Code hooks: every tool call is checked against the phase budgets,
 * the loop guard, the repeat-read cache and the index (grep/glob answered without a process), and
 * every outcome is recorded. Session end computes utilisation, refreshes priors and distils skills.
 */

export interface GovernorOptions {
  root: string;
  store: Store;
  graph: Graph;
  governance: GovernanceFile;
  clock?: Clock;
  /** Context window of the driving model, for the compaction advisor. */
  contextWindow?: number;
}

interface SessionState {
  budget: BudgetState;
  seq: number;
  recent: string[];
  edited: boolean;
  tested: boolean;
  tokens: number;
  compactionAdvised: boolean;
  /** Read results keyed by (path, range) with the blob hash they were read at. */
  reads: Map<string, { blob: string; seq: number; text: string }>;
}

export interface SessionSummary {
  sessionId: string;
  calls: number;
  utilisation?: number;
  skills: string[];
  priors: Record<string, number>;
}

export class Governor {
  private readonly sessions = new Map<string, SessionState>();
  private readonly clock: Clock;

  constructor(private readonly opts: GovernorOptions) {
    this.clock = opts.clock ?? systemClock;
  }

  private state(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { budget: newBudgetState(this.clock.now().getTime()), seq: 0, recent: [], edited: false, tested: false, tokens: 0, compactionAdvised: false, reads: new Map() };
      this.sessions.set(sessionId, s);
      this.opts.store.govern.startSession(sessionId, this.clock.now().toISOString());
    }
    return s;
  }

  /** Phase inferred from what the session has done (hooks cannot know it). */
  private phase(s: SessionState, call: ToolCall): Phase {
    if (call.phase !== 'explore') return call.phase;
    if (s.tested || (s.edited && call.tool === 'Bash' && isTestCommand(call.args['command']))) return 'verify';
    return s.edited ? 'implement' : 'explore';
  }

  /** Decides one tool call (PreToolUse). */
  onToolCall(call: ToolCall): ToolDecision {
    const { root, store, governance } = this.opts;
    const s = this.state(call.sessionId);
    const now = this.clock.now();
    const phase = this.phase(s, call);
    const key = callKey(root, call);
    const record = (decision: string) => {
      s.seq++;
      store.govern.recordCall({ sessionId: call.sessionId, seq: s.seq, at: now.toISOString(), phase, tool: call.tool, argsKey: key, argsJson: JSON.stringify(call.args), decision, tokens: 0 });
      s.budget.calls[phase]++;
      s.recent.push(key);
      if (s.recent.length > 10) s.recent.shift();
    };
    // loop guard: the same call again and again
    const threshold = governance.guard.loop_threshold;
    if (s.recent.length >= threshold - 1 && s.recent.slice(-(threshold - 1)).every((k) => k === key)) {
      record('block');
      return { kind: 'block', reason: `the same ${call.tool} call ran ${threshold} times in a row with the same arguments. Change approach: read the error, narrow the query, or ask the user.` };
    }
    // budgets
    const b = checkBudget(governance, s.budget, phase, now.getTime());
    if (b.level === 'hard') {
      record('block');
      return { kind: 'block', reason: b.message };
    }
    if (EDIT_TOOLS.has(call.tool)) s.edited = true;
    if (call.tool === 'Bash' && s.edited && isTestCommand(call.args['command'])) s.tested = true;
    // repeat reads of unchanged content
    if (call.tool === 'Read' && governance.guard.serve_repeat_reads) {
      const path = relPath(root, call.args['file_path']);
      const prev = path ? s.reads.get(`${path}:${call.args['offset'] ?? ''}:${call.args['limit'] ?? ''}`) : undefined;
      const blob = path ? store.merkle.getBlob(path)?.hash : undefined;
      if (prev && blob && prev.blob === blob) {
        record('serve:cache');
        return { kind: 'serve', from: 'cache', result: `RIAF: ${path} has not changed since you read it at call #${prev.seq}; the same content follows.\n${prev.text}` };
      }
    }
    // grep / glob from the index
    if (governance.guard.rewrite_grep_to_index) {
      if (call.tool === 'Grep' && typeof call.args['pattern'] === 'string' && !call.args['glob'] && !call.args['type'] && !call.args['multiline']) {
        const scope = relPath(root, call.args['path']);
        const served = serveGrep(store, call.args['pattern'] as string, { ...(scope ? { scope } : {}), caseInsensitive: call.args['-i'] === true, filesOnly: call.args['output_mode'] === 'files_with_matches' });
        if (served && served.matches > 0) {
          record('serve:index');
          return { kind: 'serve', from: 'index', result: `RIAF answered this search from its index (${served.matches} match${served.matches === 1 ? '' : 'es'}):\n${served.text}` };
        }
      }
      if (call.tool === 'Glob' && typeof call.args['pattern'] === 'string') {
        const scope = relPath(root, call.args['path']);
        const served = serveGlob(store, call.args['pattern'] as string, scope);
        if (served && served.matches > 0) {
          record('serve:index');
          return { kind: 'serve', from: 'index', result: `RIAF answered this glob from its index (${served.matches} file${served.matches === 1 ? '' : 's'}):\n${served.text}` };
        }
      }
    }
    // compaction advice when the session's tool output approaches the context window
    const window = this.opts.contextWindow ?? 200_000;
    if (!s.compactionAdvised && s.tokens >= governance.compaction.advise_at_ratio * window) {
      s.compactionAdvised = true;
      record('reflect');
      return { kind: 'reflect', message: `tool output in this session is about ${Math.round((100 * s.tokens) / window)}% of the context window. Consider compacting; keep: ${governance.compaction.keep.join(', ')}.` };
    }
    if (b.level === 'soft') {
      record('reflect');
      return { kind: 'reflect', message: b.message };
    }
    record('allow');
    return { kind: 'allow' };
  }

  /** Records a tool result (PostToolUse): token accounting and the repeat-read cache. */
  onToolResult(sessionId: string, tool: string, args: Record<string, unknown>, result: string): void {
    const s = this.state(sessionId);
    const tokens = estimateTokens(result);
    s.tokens += tokens;
    const phase: Phase = s.tested ? 'verify' : s.edited ? 'implement' : 'explore';
    s.budget.tokens[phase] += tokens;
    if (s.seq > 0) this.opts.store.govern.setCallTokens(sessionId, s.seq, tokens);
    if (tool === 'Read') {
      const path = relPath(this.opts.root, args['file_path']);
      const blob = path ? this.opts.store.merkle.getBlob(path)?.hash : undefined;
      if (path && blob) s.reads.set(`${path}:${args['offset'] ?? ''}:${args['limit'] ?? ''}`, { blob, seq: s.seq, text: result.slice(0, 60_000) });
    }
    if (EDIT_TOOLS.has(tool)) {
      // a changed file invalidates its cached reads (the index catches up on the next scan)
      const path = relPath(this.opts.root, args['file_path']);
      for (const k of [...s.reads.keys()]) if (path && k.startsWith(`${path}:`)) s.reads.delete(k);
    }
  }

  /** Links a compiled pack and the request to the session. */
  onPackCompiled(sessionId: string, pack: Pack, request?: string): void {
    this.state(sessionId);
    this.opts.store.govern.startSession(sessionId, this.clock.now().toISOString(), request);
    this.opts.store.govern.setSessionPack(sessionId, pack.packId);
  }

  /** Session end (Stop hook): utilisation, priors, and skills when the session succeeded. */
  onSessionEnd(sessionId: string, outcome: 'success' | 'failure' | 'unknown' = 'unknown'): SessionSummary {
    const at = this.clock.now().toISOString();
    this.state(sessionId);
    const { store, graph, root } = this.opts;
    store.govern.endSession(sessionId, at, outcome);
    const utilisation = recordUtilisation(store, root, sessionId, at);
    const priors = recomputePriors(store, at);
    const skills = outcome === 'success' ? distill(store, graph, root, sessionId, at) : [];
    const calls = store.govern.calls(sessionId).length;
    this.sessions.delete(sessionId);
    return { sessionId, calls, ...(utilisation !== undefined ? { utilisation } : {}), skills, priors };
  }

  /** A stable id for anonymous callers. */
  static sessionKey(...parts: string[]): string {
    return hashWith('session', ...parts).slice(0, 16);
  }
}
