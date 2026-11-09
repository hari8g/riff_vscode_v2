import { z } from 'zod';
import { IntentSchema, IntentVectorSchema, SymbolIdSchema, RepoPathSchema } from './common.js';

/** What the IDE knows at request time; every field optional so the CLI can route from text alone. */
export const IdeStateSchema = z.object({
  activeFile: RepoPathSchema.optional(),
  selection: z.object({ path: RepoPathSchema, startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative() }).optional(),
  openFiles: z.array(RepoPathSchema).default([]),
  branch: z.string().optional(),
  failingTests: z.array(z.string()).default([]),
  stackTrace: z.string().optional(),
  diffFiles: z.array(RepoPathSchema).default([]),
  interactive: z.boolean().default(true),
});
export type IdeState = z.infer<typeof IdeStateSchema>;

export const RouteRequestSchema = z.object({
  text: z.string().min(1),
  ide: IdeStateSchema.prefault({}),
  budget: z.number().int().positive().optional(),
  /** Caller's hint (e.g. a slash command); the router treats it as a strong prior, not a verdict. */
  intentHint: IntentSchema.optional(),
});
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

export const TaskUnitSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  anchors: z.array(SymbolIdSchema),
  /** Anchors that did not resolve to a symbol; kept so probe/clarify can show them. */
  ungrounded: z.array(z.string()).default([]),
  w: IntentVectorSchema,
  /** Normalised entropy of w in [0,1]. */
  H: z.number().min(0).max(1),
  dependsOn: z.array(z.string()).default([]),
});
export type TaskUnit = z.infer<typeof TaskUnitSchema>;

export const ROUTE_BRANCHES = ['single', 'blended', 'probe', 'clarify', 'generic'] as const;
export const RouteBranchSchema = z.enum(ROUTE_BRANCHES);
export type RouteBranch = z.infer<typeof RouteBranchSchema>;

export const ClarifyQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), intent: IntentSchema, w: IntentVectorSchema })).min(2).max(3),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;
