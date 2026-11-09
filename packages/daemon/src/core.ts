import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compile, render, type RepoView } from '@riaf/compiler';
import { createLogger, hashWith, PackSchema, RiafError, shortHash, type Intent, type Logger, type ModelRouter, type Pack, type PoliciesFile, type RpcMethod, type RpcParams, type RpcResult, type SymbolId, RPC_PROTOCOL_VERSION } from '@riaf/kernel';
import { Graph, GRAPH_STAGE } from '@riaf/graph';
import { History, HISTORY_STAGE, type Rationale, type TimelineEntry } from '@riaf/history';
import { DEFAULT_GOVERNANCE, Governor } from '@riaf/govern';
import { DEFAULT_POLICIES, route } from '@riaf/intent';
import { createModelRouter, type ModelSettings } from '@riaf/models';
import { Semantic, SUMMARY_STAGE } from '@riaf/semantic';
import { clientFor, enrichWithLsp, familyOf, languageOf, PARSE_STAGE, readRepoText, runParseStage, scanIntoStore, type DiscoverOptions } from '@riaf/parse';
import { Store, type StoreOptions } from '@riaf/store';
import { gitHead } from './git.js';
import { loadPolicies, validatePolicyTexts } from './policies.js';
import { dispatch, type RpcHandlers } from './rpc/server.js';
import { Scheduler, type PipelineStage, type RunSummary } from './scheduler.js';
import type { RpcCaller } from './rpc/client.js';
import { fromWireError } from './rpc/protocol.js';

export const DAEMON_VERSION = '0.3.0';

export interface DaemonCoreOptions {
  root: string;
  /** Database location; `:memory:` keeps everything in memory (tests, eval). Default `<root>/.riaf/index.sqlite`. */
  storePath?: string;
  driver?: StoreOptions['driver'];
  logger?: Logger;
  /** Enables the LSP enrichment stage (servers must be installed). */
  lsp?: boolean;
  discover?: DiscoverOptions;
  /** Validate RPC results against the contract (tests). */
  validateResults?: boolean;
  /** Name stamped into packs and the run-book; defaults to the root directory's name. */
  repoName?: string;
  /** Mine git history (default true). */
  history?: boolean;
  /** Called after each pipeline run (the daemon persists the store here). */
  afterRun?: (s: RunSummary) => Promise<void> | void;
}

/**
 * The composition root (ADR-0001): opens the store, builds the layers, wires the pipeline and exposes
 * every capability as RPC handlers. The socket server, in-process eval and tests all use this class.
 */
export class DaemonCore implements RpcCaller {
  readonly startedAt = new Date().toISOString();
  readonly handlers: RpcHandlers = {};
  readonly scheduler: Scheduler;
  readonly graph: Graph;
  readonly semantic: Semantic;
  readonly history: History;
  readonly governor: Governor;
  readonly models: ModelRouter | undefined;
  /** Paths parsed by the most recent run (LSP enrichment works on these). */
  private lastParsed: string[] = [];
  onShutdown: (() => void) | undefined;

  private constructor(readonly root: string, readonly store: Store, private readonly opts: DaemonCoreOptions, readonly logger: Logger) {
    this.graph = new Graph(store);
    this.semantic = new Semantic(store, this.graph, opts.repoName ?? basename(resolve(root)));
    this.history = new History(store);
    this.semantic.setConventionSource(() => this.history.conventions());
    this.governor = new Governor({ root, store, graph: this.graph, governance: loadPolicies(root).governance ?? DEFAULT_GOVERNANCE });
    this.models = this.loadModels(logger);
    this.scheduler = new Scheduler(this.buildStages(), store, root, logger, opts.afterRun);
    this.registerHandlers();
  }

  static async open(opts: DaemonCoreOptions): Promise<DaemonCore> {
    const logger = opts.logger ?? createLogger('riaf-daemon', 'info');
    const path = opts.storePath ?? join(opts.root, '.riaf', 'index.sqlite');
    const store = path === ':memory:' ? await Store.open() : await Store.open({ path, ...(opts.driver ? { driver: opts.driver } : {}) });
    return new DaemonCore(opts.root, store, opts, logger);
  }

  private buildStages(): PipelineStage[] {
    const root = this.root;
    return [
      {
        name: 'scan',
        run: async ({ store }) => {
          const r = scanIntoStore(store, root, this.opts.discover);
          return { changed: r.added.length + r.changed.length + r.removed.length, detail: { added: r.added.length, changed: r.changed.length, removed: r.removed.length, hashed: r.hashed } };
        },
      },
      {
        name: PARSE_STAGE, after: ['scan'], merkleGated: true,
        run: async ({ store, events, logger, signal }) => {
          const r = await runParseStage(store, { root, events, logger, signal });
          this.lastParsed = r.parsed;
          return { changed: r.parsed.length, detail: { failed: r.failed.length, reresolved: r.reresolved.length } };
        },
      },
      {
        name: GRAPH_STAGE, after: [PARSE_STAGE], merkleGated: true,
        run: async ({ events }) => {
          const r = this.graph.update({ events });
          return { changed: r.changed.length + r.affected.length, detail: { edges: r.edges } };
        },
      },
      {
        name: HISTORY_STAGE, after: [GRAPH_STAGE], merkleGated: true, enabled: () => this.opts.history !== false,
        run: async ({ events, logger }) => {
          const summarizer = this.models?.for('summarize');
          const r = await this.history.update({ root, events, logger, ...(summarizer ? { summarizer } : {}) });
          return { changed: r.mined + r.blamed, detail: { mined: r.mined, blamed: r.blamed, adrs: r.adrs, coChange: r.coChangeEdges, ...(r.skipped ? { skipped: r.skipped } : {}) } };
        },
      },
      {
        name: SUMMARY_STAGE, after: [GRAPH_STAGE, HISTORY_STAGE], merkleGated: true,
        run: async ({ events }) => {
          const r = this.semantic.update({ events });
          return { changed: r.files + r.directories };
        },
      },
      {
        name: 'lsp', after: [GRAPH_STAGE], enabled: () => this.opts.lsp === true,
        run: async ({ store, signal }) => {
          const byFamily = new Map<string, string[]>();
          for (const p of this.lastParsed) {
            const lang = languageOf(p);
            if (!lang) continue;
            const f = familyOf(lang);
            byFamily.set(f, [...(byFamily.get(f) ?? []), p]);
          }
          let edges = 0;
          for (const [family, paths] of byFamily) {
            const client = clientFor(family as never, root);
            if (!client) continue;
            try {
              edges += (await enrichWithLsp(store, client, { paths, readText: (p) => readRepoText(root, p), signal })).edges;
            } finally {
              await client.dispose();
            }
          }
          return { changed: edges };
        },
      },
    ];
  }

  /** Names of the pipeline stages in run order. */
  get stageNames(): string[] {
    return this.scheduler.stageNames;
  }

  /** Model adapters from `.riaf/models.json` (optional; nothing is wired without it). */
  private loadModels(logger: Logger): ModelRouter | undefined {
    try {
      const settings = JSON.parse(readFileSync(join(this.root, '.riaf', 'models.json'), 'utf8')) as ModelSettings;
      return createModelRouter(settings);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('models.json ignored', { error: String(e) });
      return undefined;
    }
  }

  /** Route dependencies: store, graph, policies, learned priors and the optional classifier arbiter. */
  private routeDeps() {
    const { policies, version } = this.policies();
    const priors = this.store.govern.priors() as Partial<Record<Intent, number>>;
    const arbiter = this.models?.for('classify');
    return { store: this.store, graph: this.graph, policies, policyVersion: version, ...(Object.keys(priors).length ? { priors } : {}), ...(arbiter ? { arbiter } : {}) };
  }

  /** Validated policies for this repository (built-in defaults when `.riaf/policies.yaml` is absent or invalid). */
  policies(): { policies: PoliciesFile; version: string } {
    const l = loadPolicies(this.root);
    return l.policies ? { policies: l.policies, version: l.version } : { policies: DEFAULT_POLICIES, version: 'builtin@1' };
  }

  /** The read view the compiler works on. */
  repoView(): RepoView {
    let constraints: string | undefined;
    try {
      constraints = readFileSync(join(this.root, '.riaf', 'constraints.md'), 'utf8');
    } catch {
      constraints = undefined;
    }
    const head = gitHead(this.root);
    return { repoName: this.opts.repoName ?? basename(resolve(this.root)), store: this.store, graph: this.graph, semantic: this.semantic, ...(this.opts.history !== false && this.store.history.count() > 0 ? { history: this.history.facts() } : {}), ...(this.store.govern.skillCount() > 0 ? { skills: (entities: readonly SymbolId[]) => this.store.govern.skillsFor(entities) } : {}), ...(head ? { commit: head } : {}), ...(constraints ? { constraints } : {}) };
  }

  /** Runs the pipeline now (or joins the run in progress). */
  index(reason = 'rpc', only: readonly string[] = []): Promise<RunSummary> {
    return this.scheduler.trigger(reason, only);
  }

  private registerHandlers(): void {
    const h = this.handlers;
    h['daemon.info'] = () => ({ protocol: RPC_PROTOCOL_VERSION, version: DAEMON_VERSION, pid: process.pid, root: this.root, startedAt: this.startedAt, methods: Object.keys(this.handlers).sort() });
    h['daemon.shutdown'] = () => {
      setImmediate(() => this.onShutdown?.());
      return { ok: true as const };
    };
    h['index.status'] = () => {
      const s = this.store.stats();
      const head = gitHead(this.root);
      return {
        repo: this.root, ...(head ? { head } : {}), blobs: s.blobs, symbols: s.symbols, edges: s.edges, schemaVersion: s.schemaVersion,
        stages: this.scheduler.status().filter((x) => x.enabled).map(({ stage, pending, done, lastMs, lastError }) => ({ stage, pending, done, ...(lastMs !== undefined ? { lastMs } : {}), ...(lastError !== undefined ? { lastError } : {}) })),
      };
    };
    h['index.rebuild'] = async (p) => {
      const names = p.stages?.length ? p.stages.filter((s) => this.stageNames.includes(s)) : this.stageNames;
      if (p.full) {
        for (const s of names) this.store.merkle.resetStage(s);
        if (names.includes(GRAPH_STAGE)) this.store.driver.run('DELETE FROM edge WHERE source IN (?, ?)', ['treesitter', 'heuristic']);
      }
      const run = this.index('rebuild', p.stages?.length ? names : []);
      if (!p.wait) {
        void run;
        return { scheduled: names };
      }
      const r = await run;
      return { scheduled: names, run: { reason: r.reason, ms: r.ms, stages: r.stages.map((s) => ({ stage: s.stage, changed: s.changed, ms: s.ms, ...(s.error ? { error: s.error } : {}) })) } };
    };
    h['graph.jump'] = (p) => {
      const query = p.symbol ?? p.query ?? (p.path !== undefined ? (p.line !== undefined ? `${p.path}:${p.line}` : `${p.path}:1`) : '');
      const j = this.graph.jump(query);
      const d = j.definition;
      return {
        ...(d ? { definition: { symbol: d.id, path: d.path, startLine: d.startLine ?? 1, endLine: d.endLine ?? d.startLine ?? 1, signature: d.signature ?? d.name, kind: d.kind, ...(d.doc ? { doc: d.doc } : {}) } } : {}),
        alternatives: j.alternatives.map((a) => a.id),
        references: j.references.map((r) => ({ symbol: r.symbol, path: r.path, line: r.line, kind: r.kind, confidence: r.confidence })),
        blame: d && d.kind !== 'file' ? this.history.blame(d.id, 5).map((b) => ({ commit: b.commit, summary: b.summary, at: b.at })) : [],
        skills: d && d.kind !== 'file' ? this.store.govern.skillsFor([d.id], 3).map((k) => ({ purpose: k.purpose, playbook: k.playbook })) : [],
      };
    };
    h['history.timeline'] = (p) => {
      const target = this.historyTarget(p.query, p.path);
      const entries = target.kind === 'symbol' ? this.history.timeline({ symbol: target.id as never }, p.limit) : target.kind === 'path' ? this.history.timeline({ path: target.id }, p.limit) : [];
      return { target: target.id, kind: target.kind, entries, text: renderTimeline(target.id, entries, this.store.history.count() > 0) };
    };
    h['history.rationale'] = (p) => {
      const target = this.historyTarget(p.query);
      if (target.kind !== 'symbol') return { commits: [], reverts: [], incidents: [], adrs: [], coChange: [], text: `No symbol matched ${p.query}.` };
      const r = this.history.rationale(target.id as never);
      return { symbol: target.id, ...r, text: renderRationale(target.id, r) };
    };
    h['graph.impact'] = (p) => {
      const r = this.graph.impact(p.symbols as never, p.hops);
      return { closure: r.closure.map((c) => ({ symbol: c.symbol, distance: c.distance, via: c.via })), coChange: r.coChange, tests: r.tests };
    };
    h['route'] = async (p) => {
      const r = await route(p, this.routeDeps());
      this.logRoute(p.text, r.policy);
      return r.policy;
    };
    h['pack.compile'] = async (p) => {
      const policy = p.route ?? (await route(p.request!, this.routeDeps())).policy;
      const routeId = p.route ? undefined : this.logRoute(p.request!.text, policy, p.sessionId);
      const includeRunbook = p.includeRunbook ?? !['claude', 'json'].includes(p.target);
      const pack = compile(policy, this.repoView(), { ...(p.budget ? { budget: p.budget } : {}), includeRunbook, ...(p.sessionId ? { sessionId: p.sessionId } : {}) });
      this.store.compileLog.recordPack({
        packId: pack.packId, ...(routeId ? { routeId } : {}), ...(p.sessionId ? { sessionId: p.sessionId } : {}), createdAt: pack.createdAt, budget: pack.budget,
        tokensUsed: pack.tokensUsed, policyVersion: pack.policyVersion, json: JSON.stringify(pack),
        items: pack.items.map((i) => ({ itemId: i.id, tier: i.tier, kind: i.kind, ...((i.source as { path?: string }).path ? { path: (i.source as { path: string }).path } : {}), intent: i.why.intent, rule: i.why.rule, score: i.why.score, tokens: i.tokens })),
      });
      if (p.sessionId) {
        this.governor.onPackCompiled(p.sessionId, pack, p.request?.text);
        for (const sk of pack.items.filter((i) => i.kind === 'skill')) this.store.govern.markSkillUsed((i => i.slice(i.indexOf(':') + 1))((sk.source as { virtual: string }).virtual));
      }
      return { pack, rendered: render(pack, p.target) };
    };
    h['govern.toolCall'] = (p) => this.governor.onToolCall(p);
    h['govern.event'] = (p) => {
      const pl = p.payload;
      switch (p.kind) {
        case 'session.start':
          this.store.govern.startSession(p.sessionId, new Date().toISOString(), typeof pl['request'] === 'string' ? pl['request'] : undefined);
          break;
        case 'tool.result':
          this.governor.onToolResult(p.sessionId, String(pl['tool'] ?? ''), (pl['args'] as Record<string, unknown>) ?? {}, typeof pl['result'] === 'string' ? pl['result'] : JSON.stringify(pl['result'] ?? ''));
          break;
        case 'pack.read':
          this.store.govern.recordPackRead(p.sessionId, String(pl['packId'] ?? ''), (pl['itemIds'] as string[]) ?? [], new Date().toISOString());
          break;
        case 'session.end': {
          const o = pl['outcome'];
          const s = this.governor.onSessionEnd(p.sessionId, o === 'success' || o === 'failure' || o === 'unknown' ? o : undefined);
          this.logger.info('session ended', { sessionId: p.sessionId, calls: s.calls, utilisation: s.utilisation, skills: s.skills.length });
          break;
        }
        default:
          throw new RiafError('invalid_input', `unknown govern event ${p.kind}`);
      }
      return { ok: true as const };
    };
    h['telemetry.query'] = (p) => {
      const since = p.since ?? '1970-01-01T00:00:00Z';
      const byDecision: Record<string, number> = {};
      let total = 0;
      for (const r of this.store.driver.all<{ decision: string; n: number }>('SELECT decision, COUNT(*) AS n FROM tool_call WHERE at >= ? GROUP BY decision', [since])) {
        byDecision[r.decision] = Number(r.n);
        total += Number(r.n);
      }
      return {
        sessions: Number(this.store.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM session WHERE started_at >= ?', [since])?.n ?? 0),
        toolCalls: { total, byDecision }, branches: this.store.compileLog.branchCounts(since), utilisation: this.store.govern.utilisationByRule(),
        priors: this.store.govern.priors(), skills: this.store.govern.skillCount(), packs: this.store.compileLog.packCount(),
      };
    };
    h['pack.get'] = (p) => {
      const json = this.store.compileLog.pack(p.packId, p.sessionId);
      if (!json) return {};
      const pack = PackSchema.parse(JSON.parse(json)) as Pack;
      return { pack, rendered: render(pack, p.target) };
    };
    h['wiki.structure'] = (p) => ({ tree: this.semantic.wikiStructure(p.depth) });
    h['wiki.page'] = (p) => this.semantic.wikiPage(p.node);
    h['runbook.get'] = () => {
      const text = this.semantic.runbook(this.repoView().constraints);
      return { text, lines: text.trimEnd().split('\n').length };
    };
    h['policies.get'] = () => {
      const l = loadPolicies(this.root);
      return { policies: l.policiesText, governance: l.governanceText, version: l.version };
    };
    h['policies.validate'] = (p) => {
      const v = validatePolicyTexts(p.policies, p.governance);
      return { ok: v.diagnostics.length === 0, diagnostics: v.diagnostics };
    };
  }

  /** Resolves a history query to a symbol (preferred) or a path. */
  private historyTarget(query?: string, path?: string): { kind: 'symbol' | 'path' | 'none'; id: string } {
    if (path) return { kind: 'path', id: path };
    const q = query ?? '';
    const j = this.graph.jump(q);
    if (j.definition && j.definition.kind !== 'file') return { kind: 'symbol', id: j.definition.id };
    if (j.definition) return { kind: 'path', id: j.definition.path };
    if (this.store.merkle.getBlob(q)) return { kind: 'path', id: q };
    return { kind: 'none', id: q };
  }

  private logRoute(text: string, policy: { branch: string; H: number; w: Record<string, number | undefined> }, sessionId?: string): string {
    const createdAt = new Date().toISOString();
    const routeId = `rt-${shortHash(hashWith('route', text, createdAt), 12)}`;
    this.store.compileLog.recordRoute({ routeId, ...(sessionId ? { sessionId } : {}), text, branch: policy.branch, H: policy.H, w: Object.fromEntries(Object.entries(policy.w).map(([k, v]) => [k, v ?? 0])), json: JSON.stringify(policy), createdAt });
    return routeId;
  }

  /** In-process RPC with the same validation as the socket server. */
  async call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const out = await dispatch(this.handlers, method, params, { validateResults: this.opts.validateResults ?? false, logger: this.logger });
    if ('error' in out) throw fromWireError(out.error);
    return out.result as RpcResult<M>;
  }

  async persist(): Promise<void> {
    await this.store.persist();
  }

  async close(): Promise<void> {
    await this.scheduler.stop();
    await this.store.persist().catch((e) => this.logger.warn('persist on close failed', { error: String(e) }));
    await this.store.close();
  }
}

export { RiafError };

const nameOf = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || id;

/** Markdown timeline for riaf_history and `riaf history`. */
export function renderTimeline(target: string, entries: readonly TimelineEntry[], indexed: boolean): string {
  if (!indexed) return 'History is not indexed (not a git repository, or the history stage is disabled).';
  if (entries.length === 0) return `No commits found for ${target}.`;
  const out = [`History of \`${nameOf(target)}\` (${entries.length} commits, newest first):`];
  for (const e of entries) out.push(`- ${e.commit.slice(0, 10)} ${e.at.slice(0, 10)} ${e.kind}${e.noise ? ' (noise)' : ''}: ${e.summary}${e.refs.length ? ` [${e.refs.join(', ')}]` : ''}${e.lines !== undefined ? ` — owns ${e.lines} line${e.lines === 1 ? '' : 's'}` : ''}${e.revertedBy ? ` — reverted by ${e.revertedBy.slice(0, 10)}` : ''} (${e.author})`);
  return out.join('\n');
}

/** Markdown rationale: commits, reverts, incidents, ADRs and co-change partners. */
export function renderRationale(symbol: string, r: Rationale): string {
  const out = [`Why \`${nameOf(symbol)}\` is the way it is:`];
  if (r.commits.length) out.push('', 'Commits owning its current lines:', ...r.commits.slice(0, 8).map((c) => `- ${c.commit.slice(0, 10)} ${c.at.slice(0, 10)} ${c.kind}: ${c.summary}${c.refs.length ? ` [${c.refs.join(', ')}]` : ''}`));
  if (r.reverts.length) out.push('', 'Reverted changes in this file:', ...r.reverts.map((v) => `- ${v.commit.slice(0, 10)} reverted ${v.reverted.slice(0, 10)}: ${v.summary}`));
  if (r.incidents.length) out.push('', 'Incidents and tickets:', ...r.incidents.map((i) => `- ${i.ref} (${i.commit.slice(0, 10)}): ${i.summary}`));
  if (r.adrs.length) out.push('', 'Decisions:', ...r.adrs.map((a) => `- ${a.title} (${a.status}, \`${a.path}\`)`));
  if (r.coChange.length) out.push('', 'Usually changes together with:', ...r.coChange.map((c) => `- \`${nameOf(c.symbol)}\` (${c.support} commits, confidence ${c.confidence.toFixed(2)})`));
  if (out.length === 1) out.push('', 'No history recorded for it yet.');
  return out.join('\n');
}
