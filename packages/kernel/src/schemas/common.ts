import { z } from 'zod';
import { SYMBOL_KINDS } from '../ids.js';

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex');
export const GitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/, 'git sha');
export const RepoPathSchema = z.string().min(1).refine((p) => !p.includes('\\') && !p.startsWith('/'), 'repo-relative, forward slashes');
export const SymbolKindSchema = z.enum(SYMBOL_KINDS);
export const SymbolIdSchema = z.string().regex(/^[^#]*#[^#@]*@[a-z]+$/, 'path#qualifiedName@kind');

export const LineRangeSchema = z.object({
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
}).refine((r) => r.endLine >= r.startLine, 'endLine >= startLine');
export type LineRange = z.infer<typeof LineRangeSchema>;

export const SourceRefSchema = z.object({
  path: RepoPathSchema,
  range: LineRangeSchema.optional(),
  blobHash: Sha256Schema.optional(),
  commit: GitShaSchema.optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** The seven primitive intents of ADR-0003. Order is the canonical order of the intent vector. */
export const INTENTS = ['bugfix', 'feature', 'merge', 'review', 'refactor', 'onboarding', 'unknown'] as const;
export const IntentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof IntentSchema>;

/** A probability distribution over intents: every weight in [0,1], sum within 1e-6 of 1. */
export const IntentVectorSchema = z
  .partialRecord(IntentSchema, z.number().min(0).max(1))
  .refine((w) => {
    const sum = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    return Math.abs(sum - 1) < 1e-6;
  }, 'intent vector must sum to 1');
export type IntentVector = z.infer<typeof IntentVectorSchema>;

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
