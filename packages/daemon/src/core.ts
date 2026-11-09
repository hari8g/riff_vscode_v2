import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compile, render, type RepoView } from '@riaf/compiler';
import { createLogger, hashWith, PackSchema, RiafError, shortHash, type Logger, type Pack, type PoliciesFile, type RpcMethod, type RpcParams, type RpcResult, RPC_PROTOCOL_VERSION } from '@riaf/kernel';
import { Graph, GRAPH_STAGE } from '@riaf/graph';
import { DEFAULT_POLICIES, route } from '@riaf/intent';
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
  /** Paths parsed by the most recent run (LSP enrichment works on these). */
  private lastParsed: string[] = [];
  onShutdown: (() => void) | undefined;

  private constructor(readonly root: string, readonly store: Store, private readonly opts: DaemonCoreOptions, readonly logger: Logger) {
    this.graph = new Graph(store);
    this.semantic = new Semantic(store, this.graph, opts.repoName ?? basename(resolve(root)));
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
        name: SUMMARY_STAGE, after: [GRAPH_STAGE], merkleGated: true,
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
    return { repoName: this.opts.repoName ?? basename(resolve(this.root)), store: this.store, graph: this.graph, semantic: this.semantic, ...(head ? { commit: head } : {}), ...(constraints ? { constraints } : {}) };
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
        blame: [],
        skills: [],
      };
    };
    h['graph.impact'] = (p) => {
      const r = this.graph.impact(p.symbols as never, p.hops);
      return { closure: r.closure.map((c) => ({ symbol: c.symbol, distance: c.distance, via: c.via })), coChange: r.coChange, tests: r.tests };
    };
    h['route'] = async (p) => {
      const { policies, version } = this.policies();
      const r = await route(p, { store: this.store, graph: this.graph, policies, policyVersion: version });
      this.logRoute(p.text, r.policy);
      return r.policy;
    };
    h['pack.compile'] = async (p) => {
      const { policies, version } = this.policies();
      const policy = p.route ?? (await route(p.request!, { store: this.store, graph: this.graph, policies, policyVersion: version })).policy;
      const routeId = p.route ? undefined : this.logRoute(p.request!.text, policy, p.sessionId);
      const includeRunbook = p.includeRunbook ?? !['claude', 'json'].includes(p.target);
      const pack = compile(policy, this.repoView(), { ...(p.budget ? { budget: p.budget } : {}), includeRunbook, ...(p.sessionId ? { sessionId: p.sessionId } : {}) });
      this.store.compileLog.recordPack({
        packId: pack.packId, ...(routeId ? { routeId } : {}), ...(p.sessionId ? { sessionId: p.sessionId } : {}), createdAt: pack.createdAt, budget: pack.budget,
        tokensUsed: pack.tokensUsed, policyVersion: pack.policyVersion, json: JSON.stringify(pack),
        items: pack.items.map((i) => ({ itemId: i.id, tier: i.tier, kind: i.kind, ...((i.source as { path?: string }).path ? { path: (i.source as { path: string }).path } : {}), intent: i.why.intent, rule: i.why.rule, score: i.why.score, tokens: i.tokens })),
      });
      return { pack, rendered: render(pack, p.target) };
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
