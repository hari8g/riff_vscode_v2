import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicAdapter, CachedModel, CopilotAdapter, costUsd, createModelRouter, OllamaAdapter, OpenAICompatAdapter, parseDistribution, proxyFor } from '../src/index.js';

let server: Server;
let base = '';
const seen: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
let fail429 = 0;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
    seen.push({ path: req.url!, headers: req.headers, body });
    const send = (o: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (fail429 > 0) { fail429--; res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
    if (req.url === '/v1/messages') return send({ content: [{ type: 'text', text: body['system'] ? '{"bugfix":0.8,"feature":0.2}' : 'hello' }], usage: { input_tokens: 10, output_tokens: 2 }, model: 'claude-haiku-5-5' });
    if (req.url === '/v1/chat/completions') return send({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 7, completion_tokens: 1 }, model: 'gpt-4o-mini' });
    if (req.url === '/v1/embeddings') return send({ data: (body['input'] as string[]).map((_, i) => ({ index: i, embedding: [i, 1, 0] })), model: 'emb' });
    if (req.url === '/api/chat') return send({ message: { content: 'summary' }, prompt_eval_count: 5, eval_count: 3, model: 'qwen' });
    if (req.url === '/api/embed') return send({ embeddings: (body['input'] as string[]).map(() => [0.5, 0.5]), model: 'nomic' });
    send({ error: 'nope' }, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('adapters against a mock server', () => {
  it('anthropic: messages API with system, headers and usage; classify parses JSON', async () => {
    const a = new AnthropicAdapter({ model: 'claude-haiku-5-5', apiKey: 'k', baseUrl: base });
    const r = await a.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
    expect(r).toEqual({ text: 'hello', usage: { inputTokens: 10, outputTokens: 2 }, model: 'claude-haiku-5-5' });
    const last = seen.at(-1)!;
    expect(last.headers['x-api-key']).toBe('k');
    expect(last.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    const c = await a.classify('fix it', { labels: ['bugfix', 'feature', 'review'] });
    expect(c.distribution).toEqual({ bugfix: 0.8, feature: 0.2, review: 0 });
    await expect(a.embed()).rejects.toThrow(/no embedding endpoint/);
  });

  it('openai-compatible: bearer from a token provider, completions and ordered embeddings', async () => {
    const o = new OpenAICompatAdapter({ model: 'gpt-4o-mini', baseUrl: `${base}/v1`, token: async () => 'sso-token', embedModel: 'emb' });
    expect((await o.complete([{ role: 'user', content: 'q' }])).text).toBe('ok');
    expect(seen.at(-1)!.headers['authorization']).toBe('Bearer sso-token');
    const e = await o.embed(['a', 'b']);
    expect(e.dimensions).toBe(3);
    expect(Array.from(e.vectors[1]!)).toEqual([1, 1, 0]);
  });

  it('ollama: chat and embed', async () => {
    const l = new OllamaAdapter({ model: 'qwen', baseUrl: base });
    expect(await l.complete([{ role: 'user', content: 'x' }])).toMatchObject({ text: 'summary', usage: { inputTokens: 5, outputTokens: 3 } });
    expect((await l.embed(['x'])).dimensions).toBe(2);
  });

  it('retries on 429 and fails with the body on other errors', async () => {
    fail429 = 2;
    const a = new AnthropicAdapter({ model: 'claude-haiku-5-5', apiKey: 'k', baseUrl: base });
    expect((await a.complete([{ role: 'user', content: 'hi' }])).text).toBe('hello');
    const bad = new OpenAICompatAdapter({ model: 'm', baseUrl: `${base}/nope` });
    await expect(bad.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/answered 404/);
  });

  it('copilot through an injected VS Code LM API folds the system prompt into the first message', async () => {
    const sent: unknown[] = [];
    const lm = { selectChatModels: async () => [{ id: 'copilot-gpt-4o', family: 'gpt-4o', sendRequest: async (m: unknown) => { sent.push(m); return { text: (async function* () { yield 'he'; yield 'llo'; })() }; }, countTokens: async (t: string) => t.length }] };
    const c = new CopilotAdapter(lm);
    const r = await c.complete([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]);
    expect(r.text).toBe('hello');
    expect(sent[0]).toEqual([{ role: 'user', content: 'be brief\n\nhi' }]);
  });
});

describe('cache, pricing, selection, proxies', () => {
  it('memoises completions and embeddings', async () => {
    const m = new CachedModel(new OllamaAdapter({ model: 'qwen', baseUrl: base }));
    const before = seen.length;
    await m.complete([{ role: 'user', content: 'same' }]);
    const again = await m.complete([{ role: 'user', content: 'same' }]);
    expect(again.usage.cachedInputTokens).toBe(5);
    await m.embed(['a', 'b']);
    await m.embed(['b', 'c']);
    expect(seen.length - before).toBe(3); // 1 chat + 2 embed calls (b served from cache)
    expect(m.hits).toBe(2);
  });

  it('prices hosted models and treats local ones as free', () => {
    expect(costUsd({ model: 'claude-sonnet-5-5', usage: { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 500_000 } })).toBeCloseTo(0.5 * 3 + 0.5 * 0.3 + 1.5, 6);
    expect(costUsd({ model: 'qwen2.5:7b', usage: { inputTokens: 10, outputTokens: 10 } })).toBe(0);
  });

  it('routes jobs to adapters from settings and refuses missing keys', () => {
    const r = createModelRouter({ summarize: { provider: 'ollama', model: 'qwen', baseUrl: base }, classify: { provider: 'ollama', model: 'qwen', baseUrl: base } });
    expect(r.for('summarize')).toBe(r.for('classify'));
    expect(r.for('embed')).toBeUndefined();
    expect(() => createModelRouter({ chat: { provider: 'anthropic', model: 'x', apiKeyEnv: 'RIAF_TEST_MISSING_KEY' } }, {})).toThrow(/RIAF_TEST_MISSING_KEY is not set/);
  });

  it('chooses a proxy per URL honouring NO_PROXY and localhost', () => {
    const env = { HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: '.internal.corp' };
    expect(proxyFor('https://api.anthropic.com/v1/messages', env)).toBeDefined();
    expect(proxyFor('https://gw.internal.corp/v1', env)).toBeUndefined();
    expect(proxyFor('http://127.0.0.1:11434/api/chat', env)).toBeUndefined();
    expect(parseDistribution('garbage', ['a', 'b'])).toEqual({ a: 0.5, b: 0.5 });
  });
});
