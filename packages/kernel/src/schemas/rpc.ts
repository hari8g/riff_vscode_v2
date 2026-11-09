import { z } from 'zod';
import { GitShaSchema, RepoPathSchema, SymbolIdSchema } from './common.js';
import { RouteRequestSchema } from './intent.js';
import { ComposedPolicySchema } from './policy.js';
import { PackSchema, RenderTargetSchema } from './pack.js';
import { ToolCallSchema, ToolDecisionSchema } from './governance.js';

/**
 * Daemon JSON-RPC surface. Each method is a (params, result) schema pair; the client SDK and the
 * server dispatcher are both derived from this table so they cannot drift.
 */

const StageStatusSchema = z.object({
  stage: z.string(),
  pending: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  lastMs: z.number().nonnegative().optional(),
  lastError: z.string().optional(),
});

export const RPC = {
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
    params: z.object({ stages: z.array(z.string()).optional(), full: z.boolean().default(false) }),
    result: z.object({ scheduled: z.array(z.string()) }),
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
    }).refine((p) => p.route !== undefined || p.request !== undefined, 'route or request is required'),
    result: z.object({ pack: PackSchema, rendered: z.string() }),
  },
  'graph.jump': {
    params: z.object({ symbol: SymbolIdSchema.optional(), path: RepoPathSchema.optional(), line: z.number().int().nonnegative().optional() })
      .refine((p) => p.symbol !== undefined || p.path !== undefined, 'symbol or path is required'),
    result: z.object({
      definition: z.object({ symbol: SymbolIdSchema, path: RepoPathSchema, startLine: z.number().int(), endLine: z.number().int(), signature: z.string() }).optional(),
      references: z.array(z.object({ symbol: SymbolIdSchema, path: RepoPathSchema, line: z.number().int(), kind: z.string() })),
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
  'govern.toolCall': {
    params: ToolCallSchema,
    result: ToolDecisionSchema,
  },
  'govern.event': {
    params: z.object({ sessionId: z.string().min(1), kind: z.string().min(1), payload: z.record(z.string(), z.unknown()) }),
    result: z.object({ ok: z.literal(true) }),
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
