import { z } from 'zod';
import { GitShaSchema, IntentSchema, IntentVectorSchema, IsoDateTimeSchema, Sha256Schema, SourceRefSchema } from './common.js';
import { RouteBranchSchema } from './intent.js';

export const PACK_TIERS = [1, 2, 3, 4] as const; // 1 map · 2 ingredients · 3 history & conventions · 4 run-book
export const PackTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const PACK_ITEM_KINDS = [
  'signature', 'body', 'summary', 'commit', 'co_change', 'convention', 'skill', 'runbook', 'test', 'diff',
] as const;
export const PackItemKindSchema = z.enum(PACK_ITEM_KINDS);

export const PackItemSchema = z.object({
  id: z.string().min(1),
  tier: PackTierSchema,
  kind: PackItemKindSchema,
  source: SourceRefSchema.or(z.object({ commit: GitShaSchema })).or(z.object({ virtual: z.string().min(1) })),
  hash: Sha256Schema,
  /** Which primitive and rule selected this item, and at what weight. */
  why: z.object({ intent: IntentSchema, rule: z.string().min(1), weight: z.number().min(0).max(1), score: z.number() }),
  tokens: z.number().int().nonnegative(),
  stage: z.number().int().nonnegative(),
  content: z.string(),
});
export type PackItem = z.infer<typeof PackItemSchema>;

export const OpenLookupSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  reason: z.string().min(1),
});
export type OpenLookup = z.infer<typeof OpenLookupSchema>;

export const PackSchema = z.object({
  packId: z.string().min(1),
  repo: z.string().min(1),
  commit: GitShaSchema.optional(),
  route: z.object({
    w: IntentVectorSchema,
    H: z.number().min(0).max(1),
    branch: RouteBranchSchema,
    stages: z.array(z.array(z.string().min(1))),
    question: z.string().optional(),
  }),
  budget: z.number().int().positive(),
  tokensUsed: z.number().int().nonnegative(),
  openLookups: z.array(OpenLookupSchema),
  items: z.array(PackItemSchema),
  policyVersion: z.string().min(1),
  schemaVersion: z.literal(1),
  createdAt: IsoDateTimeSchema,
}).refine((p) => p.tokensUsed <= p.budget, 'tokensUsed must not exceed budget')
  .refine((p) => p.items.reduce((a, i) => a + i.tokens, 0) === p.tokensUsed, 'tokensUsed must equal the sum of item tokens');
export type Pack = z.infer<typeof PackSchema>;

export const RENDER_TARGETS = ['claude', 'copilot', 'fragment', 'json', 'agentsmd'] as const;
export const RenderTargetSchema = z.enum(RENDER_TARGETS);
export type RenderTarget = z.infer<typeof RenderTargetSchema>;
