import { RiafError, type ModelJob, type ModelPort, type ModelRouter } from '@riaf/kernel';
import { AnthropicAdapter, OllamaAdapter, OpenAICompatAdapter } from './adapters.js';
import { CachedModel } from './cache.js';
import type { FetchLike } from './http.js';

/** Settings shape for model selection (`riaf.models` in VS Code, `.riaf/models.json` for the daemon). */
export interface AdapterConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  baseUrl?: string;
  /** Name of the environment variable holding the API key (never the key itself). */
  apiKeyEnv?: string;
  embedModel?: string;
}

export type ModelSettings = Partial<Record<ModelJob, AdapterConfig>>;

/** Builds one adapter from config; throws when its API key variable is unset. */
export function createAdapter(c: AdapterConfig, env: NodeJS.ProcessEnv = process.env, fetch?: FetchLike): ModelPort {
  const key = c.apiKeyEnv ? env[c.apiKeyEnv] : undefined;
  if (c.apiKeyEnv && !key) throw new RiafError('model_failure', `environment variable ${c.apiKeyEnv} is not set for ${c.provider}:${c.model}`);
  const f = fetch ? { fetch } : {};
  switch (c.provider) {
    case 'anthropic':
      return new AnthropicAdapter({ model: c.model, apiKey: key ?? '', ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}), ...f });
    case 'openai':
      return new OpenAICompatAdapter({ model: c.model, baseUrl: c.baseUrl ?? 'https://api.openai.com/v1', ...(key ? { apiKey: key } : {}), ...(c.embedModel ? { embedModel: c.embedModel } : {}), ...f });
    case 'ollama':
      return new OllamaAdapter({ model: c.model, ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}), ...(c.embedModel ? { embedModel: c.embedModel } : {}), ...f });
  }
}

/** A ModelRouter from settings: one cached adapter per configured job (identical configs share one). */
export function createModelRouter(settings: ModelSettings, env: NodeJS.ProcessEnv = process.env, fetch?: FetchLike): ModelRouter {
  const byConfig = new Map<string, ModelPort>();
  const jobs = new Map<ModelJob, ModelPort>();
  for (const [job, cfg] of Object.entries(settings) as [ModelJob, AdapterConfig][]) {
    const k = JSON.stringify(cfg);
    let port = byConfig.get(k);
    if (!port) {
      port = new CachedModel(createAdapter(cfg, env, fetch));
      byConfig.set(k, port);
    }
    jobs.set(job, port);
  }
  return { for: (job) => jobs.get(job) };
}
