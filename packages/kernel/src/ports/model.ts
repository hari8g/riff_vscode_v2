/**
 * ModelPort — the only way any layer talks to a language model.
 * Adapters live in @riaf/models; the daemon wires one per job class.
 */

export type ModelJob = 'summarize' | 'classify' | 'embed' | 'chat';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  /** Stable key for prompt caching across calls with the same prefix. */
  cacheKey?: string;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  model: string;
}

export interface ClassifyOptions {
  labels: readonly string[];
  signal?: AbortSignal;
}

export interface ClassifyResult {
  /** Probability per label, summing to 1. */
  distribution: Record<string, number>;
  model: string;
}

export interface EmbedResult {
  vectors: Float32Array[];
  dimensions: number;
  model: string;
}

export interface ModelPort {
  readonly id: string;
  readonly supports: ReadonlySet<ModelJob>;
  complete(messages: ModelMessage[], options?: CompleteOptions): Promise<CompleteResult>;
  classify(text: string, options: ClassifyOptions): Promise<ClassifyResult>;
  embed(texts: string[], signal?: AbortSignal): Promise<EmbedResult>;
}

/** Resolves which adapter serves which job; configured from settings in the daemon. */
export interface ModelRouter {
  for(job: ModelJob): ModelPort | undefined;
}
