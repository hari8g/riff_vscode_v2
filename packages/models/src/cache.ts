import { hashWith, type ClassifyOptions, type ClassifyResult, type CompleteOptions, type CompleteResult, type EmbedResult, type ModelMessage, type ModelPort } from '@riaf/kernel';

/** A memoising wrapper: identical completions, classifications and embeddings are served from memory. */
export class CachedModel implements ModelPort {
  readonly id: string;
  readonly supports;
  private readonly completions = new Map<string, CompleteResult>();
  private readonly embeddings = new Map<string, Float32Array>();
  hits = 0;
  misses = 0;

  constructor(private readonly inner: ModelPort, private readonly maxEntries = 2000) {
    this.id = inner.id;
    this.supports = inner.supports;
  }

  private remember<V>(m: Map<string, V>, k: string, v: V): void {
    if (m.size >= this.maxEntries) m.delete(m.keys().next().value as string);
    m.set(k, v);
  }

  async complete(messages: ModelMessage[], o: CompleteOptions = {}): Promise<CompleteResult> {
    const k = hashWith('complete', this.id, JSON.stringify(messages), String(o.maxTokens ?? ''), String(o.temperature ?? ''));
    const hit = this.completions.get(k);
    if (hit) {
      this.hits++;
      return { ...hit, usage: { ...hit.usage, cachedInputTokens: hit.usage.inputTokens } };
    }
    this.misses++;
    const r = await this.inner.complete(messages, o);
    this.remember(this.completions, k, r);
    return r;
  }

  classify(text: string, o: ClassifyOptions): Promise<ClassifyResult> {
    return this.inner.classify(text, o);
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<EmbedResult> {
    const missing = texts.filter((t) => !this.embeddings.has(hashWith('embed', this.id, t)));
    let dims = 0;
    let model = this.id;
    if (missing.length) {
      this.misses += missing.length;
      const r = await this.inner.embed(missing, signal);
      dims = r.dimensions;
      model = r.model;
      missing.forEach((t, i) => this.remember(this.embeddings, hashWith('embed', this.id, t), r.vectors[i]!));
    }
    this.hits += texts.length - missing.length;
    const vectors = texts.map((t) => this.embeddings.get(hashWith('embed', this.id, t))!);
    return { vectors, dimensions: dims || vectors[0]?.length || 0, model };
  }
}
