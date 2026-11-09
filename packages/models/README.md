# @riaf/models — ModelPort adapters

Allowed imports: `@riaf/kernel`. Only the daemon (and the extension, for Copilot) wires these into ports.

- `adapters.ts` — `AnthropicAdapter` (Messages API, prompt caching via `cacheKey`), `OpenAICompatAdapter` (chat/completions + embeddings, API key or an SSO token provider), `OllamaAdapter` (local chat + embeddings), `CopilotAdapter` (VS Code LM API, injected by the extension).
- `http.ts` — JSON POST with timeouts, 429/5xx retries honouring `retry-after`, and proxies from `HTTPS_PROXY`/`HTTP_PROXY` with `NO_PROXY` (undici `ProxyAgent`, pure JS).
- `cache.ts` — memoising wrapper for completions and per-text embeddings. `pricing.ts` — USD cost by model. `select.ts` — `createModelRouter(settings)`: one cached adapter per job (`summarize`, `classify`, `embed`, `chat`). API keys are referenced by environment variable name, never stored.
