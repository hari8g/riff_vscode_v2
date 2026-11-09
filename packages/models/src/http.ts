import { ProxyAgent, type Dispatcher } from 'undici';
import { RiafError } from '@riaf/kernel';

/**
 * JSON over HTTP for the adapters: timeouts, retries with backoff on 429/5xx, and corporate proxies
 * (HTTPS_PROXY / HTTP_PROXY with NO_PROXY), carried over from v1's proxiedFetch. Pure JS (undici).
 */

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; dispatcher?: Dispatcher }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; headers: { get(name: string): string | null } }>;

const agents = new Map<string, ProxyAgent>();

/** The proxy dispatcher for `url`, honouring NO_PROXY; undefined when no proxy applies. */
export function proxyFor(url: string, env: NodeJS.ProcessEnv = process.env): Dispatcher | undefined {
  const u = new URL(url);
  const noProxy = (env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (noProxy.some((n) => n === '*' || u.hostname === n || u.hostname.endsWith(n.startsWith('.') ? n : `.${n}`))) return undefined;
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') return undefined;
  const proxy = u.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy : env.HTTP_PROXY ?? env.http_proxy;
  if (!proxy) return undefined;
  let a = agents.get(proxy);
  if (!a) {
    a = new ProxyAgent(proxy);
    agents.set(proxy, a);
  }
  return a;
}

export interface PostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  fetch?: FetchLike;
}

/** POSTs JSON and parses the JSON response; throws a RiafError('model_failure') with the body on failure. */
export async function postJson<T>(url: string, body: unknown, opts: PostOptions = {}): Promise<T> {
  const f = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const dispatcher = proxyFor(url);
      const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) }, body: JSON.stringify(body), signal: ctl.signal, ...(dispatcher ? { dispatcher } : {}) });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : 250 * 2 ** attempt));
        continue;
      }
      throw new RiafError('model_failure', `${url} answered ${res.status}: ${text.slice(0, 300)}`, { status: res.status });
    } catch (e) {
      lastErr = e;
      if (e instanceof RiafError || opts.signal?.aborted || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr instanceof RiafError ? lastErr : new RiafError('model_failure', `${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
