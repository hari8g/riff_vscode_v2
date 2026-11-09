import { z } from 'zod';

const PhaseLimitsSchema = z.object({
  soft_calls: z.number().int().positive(),
  max_calls: z.number().int().positive(),
  soft_tokens: z.number().int().positive(),
  max_tokens: z.number().int().positive(),
  max_minutes: z.number().int().positive(),
}).refine((p) => p.soft_calls <= p.max_calls && p.soft_tokens <= p.max_tokens, 'soft limits must not exceed hard limits');

export const PHASES = ['explore', 'plan', 'implement', 'verify'] as const;
export const PhaseSchema = z.enum(PHASES);

/** Shape of `.riaf/governance.yaml`. */
export const GovernanceFileSchema = z.object({
  version: z.literal(1),
  phases: z.record(PhaseSchema, PhaseLimitsSchema).refine((p) => Object.keys(p).length === 4, 'all four phases must be defined'),
  guard: z.object({
    serve_first_reads: z.boolean(),
    serve_repeat_reads: z.boolean(),
    rewrite_grep_to_index: z.boolean(),
    loop_threshold: z.number().int().min(2).max(10),
  }),
  compaction: z.object({
    advise_at_ratio: z.number().gt(0).lt(1),
    keep: z.array(z.string().min(1)),
  }),
});
export type GovernanceFile = z.infer<typeof GovernanceFileSchema>;

export const ToolCallSchema = z.object({
  sessionId: z.string().min(1),
  phase: PhaseSchema,
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  at: z.string().datetime({ offset: true }),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }),
  z.object({ kind: z.literal('serve'), result: z.unknown(), from: z.enum(['cache', 'index']) }),
  z.object({ kind: z.literal('rewrite'), tool: z.string().min(1), args: z.record(z.string(), z.unknown()), reason: z.string() }),
  z.object({ kind: z.literal('reflect'), message: z.string().min(1) }),
  z.object({ kind: z.literal('block'), reason: z.string().min(1) }),
]);
export type ToolDecision = z.infer<typeof ToolDecisionSchema>;
