import { z } from 'zod';
import { GitShaSchema, RepoPathSchema, SymbolIdSchema } from './common.js';
import { RouteRequestSchema } from './intent.js';
import { ComposedPolicySchema } from './policy.js';
import { PackSchema, RenderTargetSchema } from './pack.js';
import { ToolCallSchema, ToolDecisionSchema } from './governance.js';
import { TokenSettingsSchema } from './tokens.js';

/**
 * Daemon JSON-RPC surface. Each method is a (params, result) schema pair; the client SDK and the
 * server dispatcher are both derived from this table so they cannot drift.
 */

export interface WikiNodeShape {
  id: string;
  level: string;
  title: string;
  summary: string;
  children: WikiNodeShape[];
}
export const WikiNodeSchema: z.ZodType<WikiNodeShape> = z.lazy(() => z.object({
  id: z.string(),
  level: z.string(),
  title: z.string(),
  summary: z.string(),
  children: z.array(WikiNodeSchema),
}));

const TimelineEntrySchema = z.object({
  commit: GitShaSchema,
  at: z.string(),
  author: z.string(),
  summary: z.string(),
  kind: z.string(),
  noise: z.boolean(),
  lines: z.number().int().nonnegative().optional(),
  refs: z.array(z.string()),
  revertedBy: GitShaSchema.optional(),
});

const StageStatusSchema = z.object({
  stage: z.string(),
  pending: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  lastMs: z.number().nonnegative().optional(),
  lastError: z.string().optional(),
});

/** Protocol version; additive changes (new methods, new optional fields) keep the major (ADR-0004). */
export const RPC_PROTOCOL_VERSION = '1.5' as const;

/** Where the agent prompt will be injected; decides tool hints in the protocol section. */
export const PromptHostSchema = z.enum(['claude', 'copilot', 'generic']);

/** How the agent prompt spends the model's context window (since 1.5). */
export const TokenPlanSchema = z.object({
  model: z.string(),
  contextWindow: z.number().int(),
  /** contextWindow × use_ratio. */
  usable: z.number().int(),
  reasoning: z.number().int(),
  /** Output reserve blended across the route's intents. */
  output: z.number().int(),
  packBudget: z.number().int(),
  packUsed: z.number().int(),
  /** Tokens of the prompt around the pack (protocol, task, plan, settings, notes, checks). */
  frame: z.number().int(),
  /** Whole injected prompt (frame + pack). */
  prompt: z.number().int(),
  /** Stable, cacheable prefix tokens. */
  cacheable: z.number().int(),
  /** What remains for the agent's own reading and tool results. */
  headroom: z.number().int(),
  /** Token count at which the agent should summarise its transcript. */
  summarizeAt: z.number().int(),
  planGate: z.boolean(),
  intentMix: z.array(z.object({ intent: z.string(), weight: z.number(), pack: z.number().int(), output: z.number().int(), planGate: z.boolean() })),
});

/** The detailed prompt injected into the agent after routing and compilation (since 1.5). */
export const AgentPromptSchema = z.object({
  promptId: z.string(),
  host: PromptHostSchema,
  text: z.string(),
  /** Hash of the stable prefix: equal across tasks on the same code and settings, so providers can cache it. */
  stableHash: z.string(),
  sections: z.array(z.object({ id: z.string(), title: z.string(), tokens: z.number().int(), cacheable: z.boolean() })),
  plan: TokenPlanSchema,
});

const SymbolMetricSchema = z.object({ symbol: SymbolIdSchema, path: z.string(), kind: z.string(), fanIn: z.number().int(), fanOut: z.number().int(), tests: z.number().int() });
const OwnerSchema = z.object({ author: z.string(), commits: z.number().int(), share: z.number(), lastAt: z.string() });
export const GlossaryTermSchema = z.object({
  term: z.string(), symbols: z.number().int(), files: z.number().int(), areas: z.array(z.string()), defines: z.array(SymbolIdSchema), meaning: z.string().optional(), score: z.number(),
});

export const RPC = {
  'daemon.info': {
    params: z.object({}),
    result: z.object({
      protocol: z.string(),
      version: z.string(),
      pid: z.number().int(),
      root: z.string(),
      startedAt: z.string(),
      methods: z.array(z.string()),
    }),
  },
  'daemon.shutdown': {
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'index.status': {
    params: z.object({}),
    result: z.object({
      repo: z.string(),
      head: GitShaSchema.optional(),
      blobs: z.number().int().nonnegative(),
      symbols: z.number().int().nonnegative(),
      edges: z.number().int().nonnegative(),
      stages: z.array(StageStatusSchema),
      schemaVersion: z.number().int(),
    }),
  },
  'index.rebuild': {
    params: z.object({
      stages: z.array(z.string()).optional(),
      full: z.boolean().default(false),
      /** Wait for the run and return its summary (since 1.1). */
      wait: z.boolean().default(false),
    }),
    result: z.object({
      scheduled: z.array(z.string()),
      run: z.object({
        reason: z.string(),
        ms: z.number().nonnegative(),
        stages: z.array(z.object({ stage: z.string(), changed: z.number().int().nonnegative(), ms: z.number().nonnegative(), error: z.string().optional() })),
      }).optional(),
    }),
  },
  'route': {
    params: RouteRequestSchema,
    result: ComposedPolicySchema,
  },
  'pack.compile': {
    params: z.object({
      route: ComposedPolicySchema.optional(),
      request: RouteRequestSchema.optional(),
      budget: z.number().int().positive().optional(),
      target: RenderTargetSchema.default('json'),
      /** Groups packs and telemetry of one agent session (since 1.2). */
      sessionId: z.string().min(1).optional(),
      /** Include the run-book item; defaults to true for targets that do not load CLAUDE.md (since 1.2). */
      includeRunbook: z.boolean().optional(),
    }).refine((p) => p.route !== undefined || p.request !== undefined, 'route or request is required'),
    result: z.object({ pack: PackSchema, rendered: z.string() }),
  },
  'pack.get': {
    params: z.object({ packId: z.string().optional(), sessionId: z.string().optional(), target: RenderTargetSchema.default('claude') }),
    result: z.object({ pack: PackSchema.optional(), rendered: z.string().optional() }),
  },
  'wiki.structure': {
    params: z.object({ depth: z.number().int().min(1).max(6).default(3) }),
    result: z.object({ tree: WikiNodeSchema }),
  },
  'wiki.page': {
    params: z.object({ node: z.string() }),
    result: z.object({
      id: z.string(),
      level: z.string(),
      summary: z.string(),
      children: z.array(z.object({ id: z.string(), summary: z.string() })),
      symbols: z.array(z.object({ id: z.string(), kind: z.string(), signature: z.string(), doc: z.string().optional() })),
    }),
  },
  'runbook.get': {
    params: z.object({}),
    result: z.object({ text: z.string(), lines: z.number().int().nonnegative() }),
  },
  'graph.jump': {
    params: z.object({
      symbol: SymbolIdSchema.optional(),
      path: RepoPathSchema.optional(),
      line: z.number().int().nonnegative().optional(),
      /** Free-text lookup: qualified name (`TollSession.close`), bare name, or `path:line` (since 1.1). */
      query: z.string().min(1).optional(),
    }).refine((p) => p.symbol !== undefined || p.path !== undefined || p.query !== undefined, 'symbol, path or query is required'),
    result: z.object({
      definition: z.object({
        symbol: SymbolIdSchema, path: RepoPathSchema, startLine: z.number().int(), endLine: z.number().int(), signature: z.string(),
        kind: z.string().optional(), doc: z.string().optional(),
      }).optional(),
      alternatives: z.array(SymbolIdSchema).default([]),
      references: z.array(z.object({ symbol: SymbolIdSchema, path: RepoPathSchema, line: z.number().int(), kind: z.string(), confidence: z.number().optional() })),
      blame: z.array(z.object({ commit: GitShaSchema, summary: z.string().optional(), at: z.string() })),
      skills: z.array(z.object({ purpose: z.string(), playbook: z.string() })),
    }),
  },
  'graph.impact': {
    params: z.object({ symbols: z.array(SymbolIdSchema).min(1), hops: z.number().int().min(1).max(4).default(2) }),
    result: z.object({
      closure: z.array(z.object({ symbol: SymbolIdSchema, distance: z.number().int(), via: z.string() })),
      coChange: z.array(z.object({ symbol: SymbolIdSchema, support: z.number().int(), confidence: z.number() })),
      tests: z.array(SymbolIdSchema),
    }),
  },
  'history.timeline': {
    params: z.object({ query: z.string().min(1).optional(), path: RepoPathSchema.optional(), limit: z.number().int().min(1).max(200).default(20) })
      .refine((p) => p.query !== undefined || p.path !== undefined, 'query or path is required'),
    result: z.object({ target: z.string(), kind: z.enum(['symbol', 'path', 'none']), entries: z.array(TimelineEntrySchema), text: z.string() }),
  },
  'history.rationale': {
    params: z.object({ query: z.string().min(1) }),
    result: z.object({
      symbol: SymbolIdSchema.optional(),
      commits: z.array(TimelineEntrySchema),
      reverts: z.array(z.object({ commit: GitShaSchema, reverted: z.string(), summary: z.string() })),
      incidents: z.array(z.object({ commit: GitShaSchema, ref: z.string(), summary: z.string() })),
      adrs: z.array(z.object({ path: z.string(), title: z.string(), status: z.string(), excerpt: z.string() })),
      coChange: z.array(z.object({ symbol: SymbolIdSchema, support: z.number(), confidence: z.number() })),
      text: z.string(),
    }),
  },
  'govern.toolCall': {
    params: ToolCallSchema,
    result: ToolDecisionSchema,
  },
  'govern.event': {
    params: z.object({ sessionId: z.string().min(1), kind: z.string().min(1), payload: z.record(z.string(), z.unknown()) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'telemetry.query': {
    params: z.object({ since: z.string().optional() }),
    result: z.object({
      sessions: z.number().int().nonnegative(),
      toolCalls: z.object({ total: z.number().int().nonnegative(), byDecision: z.record(z.string(), z.number().int().nonnegative()) }),
      branches: z.record(z.string(), z.number().int().nonnegative()),
      utilisation: z.array(z.object({ rule: z.string(), intent: z.string(), delivered: z.number().int(), read: z.number().int() })),
      priors: z.record(z.string(), z.number()),
      skills: z.number().int().nonnegative(),
      packs: z.number().int().nonnegative(),
    }),
  },
  'prompt.build': {
    params: z.object({
      request: RouteRequestSchema.optional(),
      /** A route already computed (the Claude Code prompt hook); `text` then carries the task wording. */
      route: ComposedPolicySchema.optional(),
      text: z.string().optional(),
      host: PromptHostSchema.default('claude'),
      /** Overrides the blended per-intent pack budget. */
      budget: z.number().int().positive().optional(),
      sessionId: z.string().min(1).optional(),
    }).refine((p) => p.request !== undefined || (p.route !== undefined && p.text !== undefined), 'request, or route and text, is required'),
    result: z.object({ pack: PackSchema, prompt: AgentPromptSchema }),
  },
  'tokens.get': {
    params: z.object({}),
    result: z.object({ settings: TokenSettingsSchema, text: z.string(), source: z.enum(['file', 'builtin']), errors: z.array(z.string()) }),
  },
  'tokens.validate': {
    params: z.object({ text: z.string() }),
    result: z.object({ ok: z.boolean(), errors: z.array(z.string()), settings: TokenSettingsSchema.optional() }),
  },
  'graph.insights': {
    params: z.object({ top: z.number().int().min(1).max(100).default(10) }),
    result: z.object({
      totals: z.object({ symbols: z.number().int(), files: z.number().int(), edges: z.number().int(), definitions: z.number().int(), testedDefinitions: z.number().int() }),
      hubs: z.array(SymbolMetricSchema), tangled: z.array(SymbolMetricSchema), untestedHubs: z.array(SymbolMetricSchema), unreferenced: z.array(SymbolMetricSchema),
      cycles: z.array(z.array(z.string())),
    }),
  },
  'history.hotspots': {
    params: z.object({ top: z.number().int().min(1).max(200).default(20), under: z.string().optional(), byDirectory: z.boolean().default(false), halfLifeDays: z.number().positive().default(90) }),
    result: z.object({
      hotspots: z.array(z.object({
        path: z.string(), commits: z.number().int(), churn: z.number().int(), heat: z.number(), fixShare: z.number(), authors: z.number().int(), busFactor: z.number().int(),
        owners: z.array(OwnerSchema), firstAt: z.string(), lastAt: z.string(),
      })),
    }),
  },
  'semantic.glossary': {
    params: z.object({ top: z.number().int().min(1).max(200).default(60), phrase: z.string().optional() }),
    result: z.object({ terms: z.array(GlossaryTermSchema) }),
  },
  'policies.get': {
    params: z.object({}),
    result: z.object({ policies: z.string(), governance: z.string(), version: z.string() }),
  },
  'policies.validate': {
    params: z.object({ policies: z.string().optional(), governance: z.string().optional() }),
    result: z.object({ ok: z.boolean(), diagnostics: z.array(z.object({ file: z.string(), path: z.string(), message: z.string() })) }),
  },
} as const;

export type RpcMethod = keyof typeof RPC;
export type RpcParams<M extends RpcMethod> = z.input<(typeof RPC)[M]['params']>;
/** Params as a handler receives them: validated, with defaults applied. */
export type RpcParsedParams<M extends RpcMethod> = z.output<(typeof RPC)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.output<(typeof RPC)[M]['result']>;

export const RPC_METHODS = Object.keys(RPC) as RpcMethod[];

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
