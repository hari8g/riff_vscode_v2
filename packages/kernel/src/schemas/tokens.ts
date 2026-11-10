import { z } from 'zod';
import { INTENTS } from './common.js';

/**
 * Shape of `.riaf/tokens.yaml`: how the agent prompt RIAF injects after intent routing and pack
 * compilation spends the model's context window. Per-intent settings are blended by the route's
 * intent weights, so a "bug fix + feature" task gets a weighted mix of both.
 */

const IntentTokensSchema = z.object({
  /** Token budget for the compiled context pack. */
  pack: z.number().int().min(1000).max(200_000),
  /** Output tokens reserved for the agent's reply and edits. */
  output: z.number().int().min(256).max(128_000),
  /** Ask the agent to present its plan and wait for approval before editing. */
  plan_gate: z.boolean(),
});
export type IntentTokens = z.infer<typeof IntentTokensSchema>;

export const TokenSettingsSchema = z.object({
  version: z.literal(1),
  model: z.object({
    /** Name shown in the prompt and console, e.g. claude-sonnet. */
    name: z.string().min(1),
    /** The model's full context window in tokens. */
    context_window: z.number().int().min(8000).max(2_000_000),
    /** Share of the window RIAF plans to fill; the rest is a safety margin. */
    use_ratio: z.number().gt(0.3).max(0.98),
  }),
  /** Extended-thinking budget reserved inside the window (0 = off). */
  reasoning: z.number().int().min(0).max(128_000),
  /** Prompt sections around the pack: hard caps so the frame never crowds out the context. */
  sections: z.object({
    protocol: z.number().int().min(100).max(4000),
    plan: z.number().int().min(100).max(4000),
    notes: z.number().int().min(0).max(4000),
  }),
  /** Per-intent pack budget, output reserve and plan gate. */
  intents: z.record(z.enum(INTENTS), IntentTokensSchema).refine((r) => INTENTS.every((i) => r[i] !== undefined), 'every intent needs settings'),
  /** Plan gate applies when an intent that has it weighs at least this much in the route. */
  plan_gate_min_weight: z.number().min(0).max(1),
  cache: z.object({
    /** Put stable sections (protocol, repository rules) first and mark them cacheable. */
    stable_prefix: z.boolean(),
    /** Prompt-cache lifetime hint for providers that support it. */
    ttl: z.enum(['5m', '1h']),
  }),
  /** Advise the agent to summarise its transcript once this share of the input budget is used. */
  summarize_at: z.number().gt(0).lt(1),
}).refine((t) => Object.values(t.intents).every((i) => i.pack + i.output + t.reasoning < t.model.context_window * t.model.use_ratio), 'pack + output + reasoning must fit in the usable window for every intent');
export type TokenSettings = z.infer<typeof TokenSettingsSchema>;

/** Built-in defaults (Claude-class 200k window). Mirrors `.riaf/tokens.yaml` written by `riaf init`. */
export const DEFAULT_TOKEN_SETTINGS: TokenSettings = {
  version: 1,
  model: { name: 'claude-sonnet', context_window: 200_000, use_ratio: 0.85 },
  reasoning: 0,
  sections: { protocol: 800, plan: 900, notes: 700 },
  intents: {
    bugfix: { pack: 16_000, output: 8_192, plan_gate: false },
    feature: { pack: 16_000, output: 16_384, plan_gate: true },
    merge: { pack: 16_000, output: 8_192, plan_gate: false },
    review: { pack: 12_000, output: 4_096, plan_gate: false },
    refactor: { pack: 20_000, output: 16_384, plan_gate: true },
    onboarding: { pack: 8_000, output: 4_096, plan_gate: false },
    unknown: { pack: 8_000, output: 4_096, plan_gate: false },
  },
  plan_gate_min_weight: 0.3,
  cache: { stable_prefix: true, ttl: '5m' },
  summarize_at: 0.6,
};

/** Named starting points for the console's settings editor. */
export const TOKEN_PRESETS: Record<'economy' | 'balanced' | 'thorough', (t: TokenSettings) => TokenSettings> = {
  economy: (t) => scaleIntents(t, 0.5, 0.5),
  balanced: (t) => ({ ...t, intents: DEFAULT_TOKEN_SETTINGS.intents }),
  thorough: (t) => scaleIntents(t, 1.75, 1.5),
};

function scaleIntents(t: TokenSettings, pack: number, output: number): TokenSettings {
  const intents = Object.fromEntries(Object.entries(DEFAULT_TOKEN_SETTINGS.intents).map(([k, v]) => [k, {
    ...v, pack: Math.round((v.pack * pack) / 500) * 500, output: Math.round((v.output * output) / 256) * 256,
  }])) as TokenSettings['intents'];
  return { ...t, intents };
}
