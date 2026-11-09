import { RiafError, type ClassifyOptions, type ClassifyResult, type CompleteOptions, type CompleteResult, type EmbedResult, type ModelJob, type ModelMessage, type ModelPort } from '@riaf/kernel';
import { classifyMessages, toClassifyResult } from './classify.js';
import { postJson, type FetchLike } from './http.js';

/** One file's worth of adapters per provider; each implements ModelPort and nothing else. */

export interface AdapterBase {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

const split = (messages: ModelMessage[]) => ({ system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'), rest: messages.filter((m) => m.role !== 'system') });

/** Anthropic Messages API. */
export class AnthropicAdapter implements ModelPort {
  readonly id: string;
  readonly supports: ReadonlySet<ModelJob> = new Set(['summarize', 'classify', 'chat']);
  constructor(private readonly cfg: AdapterBase & { apiKey: string; version?: string }) {
    this.id = `anthropic:${cfg.model}`;
  }

  async complete(messages: ModelMessage[], o: CompleteOptions = {}): Promise<CompleteResult> {
    const { system, rest } = split(messages);
    const r = await postJson<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }; model: string }>(
      `${this.cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      { model: this.cfg.model, max_tokens: o.maxTokens ?? 1024, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(system ? { system: o.cacheKey ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system } : {}), messages: rest.map((m) => ({ role: m.role, content: m.content })) },
      { headers: { 'x-api-key': this.cfg.apiKey, 'anthropic-version': this.cfg.version ?? '2023-06-01' }, ...(this.cfg.timeoutMs ? { timeoutMs: this.cfg.timeoutMs } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(this.cfg.fetch ? { fetch: this.cfg.fetch } : {}) },
    );
    return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), usage: { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, ...(r.usage.cache_read_input_tokens ? { cachedInputTokens: r.usage.cache_read_input_tokens } : {}) }, model: r.model };
  }

  async classify(text: string, o: ClassifyOptions): Promise<ClassifyResult> {
    return toClassifyResult(await this.complete(classifyMessages(text, o.labels), { maxTokens: 200, temperature: 0, ...(o.signal ? { signal: o.signal } : {}) }), o.labels);
  }

  async embed(): Promise<EmbedResult> {
    throw new RiafError('model_failure', 'the Anthropic API has no embedding endpoint; configure an embedding adapter (Ollama or an OpenAI-compatible gateway)');
  }
}

/** OpenAI-compatible chat/completions + embeddings (the corporate SSO gateway, vLLM, LM Studio…). */
export class OpenAICompatAdapter implements ModelPort {
  readonly id: string;
  readonly supports: ReadonlySet<ModelJob>;
  constructor(private readonly cfg: AdapterBase & { baseUrl: string; apiKey?: string; token?: () => Promise<string>; embedModel?: string; headers?: Record<string, string> }) {
    this.id = `openai:${cfg.model}`;
    this.supports = new Set<ModelJob>(['summarize', 'classify', 'chat', ...(cfg.embedModel ? (['embed'] as const) : [])]);
  }

  private async headers(): Promise<Record<string, string>> {
    const bearer = this.cfg.token ? await this.cfg.token() : this.cfg.apiKey;
    return { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(this.cfg.headers ?? {}) };
  }

  async complete(messages: ModelMessage[], o: CompleteOptions = {}): Promise<CompleteResult> {
    const r = await postJson<{ choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } }; model: string }>(
      `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
      { model: this.cfg.model, messages, max_tokens: o.maxTokens ?? 1024, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}) },
      { headers: await this.headers(), ...(this.cfg.timeoutMs ? { timeoutMs: this.cfg.timeoutMs } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(this.cfg.fetch ? { fetch: this.cfg.fetch } : {}) },
    );
    const u = r.usage;
    return { text: r.choices[0]?.message.content ?? '', usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, ...(u?.prompt_tokens_details?.cached_tokens ? { cachedInputTokens: u.prompt_tokens_details.cached_tokens } : {}) }, model: r.model };
  }

  async classify(text: string, o: ClassifyOptions): Promise<ClassifyResult> {
    return toClassifyResult(await this.complete(classifyMessages(text, o.labels), { maxTokens: 200, temperature: 0, ...(o.signal ? { signal: o.signal } : {}) }), o.labels);
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<EmbedResult> {
    if (!this.cfg.embedModel) throw new RiafError('model_failure', `${this.id} has no embedding model configured`);
    const r = await postJson<{ data: { embedding: number[]; index: number }[]; model: string }>(`${this.cfg.baseUrl.replace(/\/$/, '')}/embeddings`, { model: this.cfg.embedModel, input: texts }, { headers: await this.headers(), ...(signal ? { signal } : {}), ...(this.cfg.fetch ? { fetch: this.cfg.fetch } : {}) });
    const vectors = [...r.data].sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
    return { vectors, dimensions: vectors[0]?.length ?? 0, model: r.model };
  }
}

/** Ollama: local small models for summaries, classification and embeddings. */
export class OllamaAdapter implements ModelPort {
  readonly id: string;
  readonly supports: ReadonlySet<ModelJob> = new Set(['summarize', 'classify', 'embed', 'chat']);
  constructor(private readonly cfg: AdapterBase & { embedModel?: string }) {
    this.id = `ollama:${cfg.model}`;
  }

  private url(p: string) {
    return `${(this.cfg.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')}${p}`;
  }

  async complete(messages: ModelMessage[], o: CompleteOptions = {}): Promise<CompleteResult> {
    const r = await postJson<{ message: { content: string }; prompt_eval_count?: number; eval_count?: number; model: string }>(this.url('/api/chat'), {
      model: this.cfg.model, messages, stream: false, options: { ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.maxTokens ? { num_predict: o.maxTokens } : {}) },
    }, { ...(this.cfg.timeoutMs ? { timeoutMs: this.cfg.timeoutMs } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(this.cfg.fetch ? { fetch: this.cfg.fetch } : {}), retries: 1 });
    return { text: r.message.content, usage: { inputTokens: r.prompt_eval_count ?? 0, outputTokens: r.eval_count ?? 0 }, model: r.model };
  }

  async classify(text: string, o: ClassifyOptions): Promise<ClassifyResult> {
    return toClassifyResult(await this.complete(classifyMessages(text, o.labels), { maxTokens: 200, temperature: 0, ...(o.signal ? { signal: o.signal } : {}) }), o.labels);
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<EmbedResult> {
    const r = await postJson<{ embeddings: number[][]; model: string }>(this.url('/api/embed'), { model: this.cfg.embedModel ?? this.cfg.model, input: texts }, { ...(signal ? { signal } : {}), ...(this.cfg.fetch ? { fetch: this.cfg.fetch } : {}), retries: 1 });
    const vectors = r.embeddings.map((e) => Float32Array.from(e));
    return { vectors, dimensions: vectors[0]?.length ?? 0, model: r.model };
  }
}

/** The subset of the VS Code Language Model API the Copilot adapter needs (injected by the extension). */
export interface VsCodeLm {
  selectChatModels(selector: { vendor?: string; family?: string }): Promise<{ id: string; family: string; sendRequest(messages: { role: 'user' | 'assistant'; content: string }[], options: object, token?: unknown): Promise<{ text: AsyncIterable<string> }>; countTokens(text: string): Promise<number> }[]>;
}

/** Copilot through the VS Code LM API — only usable inside the extension host. */
export class CopilotAdapter implements ModelPort {
  readonly id: string;
  readonly supports: ReadonlySet<ModelJob> = new Set(['summarize', 'classify', 'chat']);
  constructor(private readonly lm: VsCodeLm, private readonly family = 'gpt-4o') {
    this.id = `copilot:${family}`;
  }

  async complete(messages: ModelMessage[]): Promise<CompleteResult> {
    const [model] = await this.lm.selectChatModels({ vendor: 'copilot', family: this.family });
    if (!model) throw new RiafError('model_failure', `no Copilot model of family ${this.family} is available`);
    // the LM API has no system role: fold system text into the first user message
    const { system, rest } = split(messages);
    const msgs = rest.map((m, i) => ({ role: m.role as 'user' | 'assistant', content: i === 0 && system ? `${system}\n\n${m.content}` : m.content }));
    const res = await model.sendRequest(msgs, {});
    let text = '';
    for await (const part of res.text) text += part;
    const inputTokens = await model.countTokens(msgs.map((m) => m.content).join('\n'));
    return { text, usage: { inputTokens, outputTokens: await model.countTokens(text) }, model: model.id };
  }

  async classify(text: string, o: ClassifyOptions): Promise<ClassifyResult> {
    return toClassifyResult(await this.complete(classifyMessages(text, o.labels)), o.labels);
  }

  async embed(): Promise<EmbedResult> {
    throw new RiafError('model_failure', 'the VS Code LM API has no embeddings');
  }
}
