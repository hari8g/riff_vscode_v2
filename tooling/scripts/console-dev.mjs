#!/usr/bin/env node
/**
 * Serves the RIAF console in a browser against a real daemon core, for design work and demos.
 *   node tooling/scripts/console-dev.mjs [repoDir] [--port 5199] [--no-seed]
 * Without repoDir it indexes a copy of fixtures/repos/toll-ts with its synthetic git history and seeds
 * a few packs and governed sessions so every page has data. Requires `pnpm build`.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 5199;
const seed = !args.includes('--no-seed');
const repoArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');

const { DaemonCore } = await import(join(root, 'packages/daemon/dist/index.js'));
const { handleConsole } = await import(join(root, 'packages/extension/out-tsc/consoleHost.js'));
const { silentLogger } = await import(join(root, 'packages/kernel/dist/index.js'));

let repo = repoArg ? resolve(repoArg) : undefined;
if (!repo) {
  repo = join(mkdtempSync(join(tmpdir(), 'riaf-console-')), 'toll-ts');
  const { makeFixtureHistory } = await import(join(root, 'packages/eval/dist/index.js'));
  makeFixtureHistory(join(root, 'fixtures/repos/toll-ts'), repo);
  mkdirSync(join(repo, '.riaf'), { recursive: true });
  for (const f of ['policies.yaml', 'governance.yaml']) writeFileSync(join(repo, '.riaf', f), readFileSync(join(root, '.riaf', f)));
}
const core = await DaemonCore.open({ root: repo, storePath: ':memory:', logger: silentLogger });
console.log(`indexing ${repo}…`);
await core.index('console-dev');

if (seed) {
  const requests = [
    'Fix the off-by-one in Gantry.lane: the last lane of every gantry fails',
    'Add a GET /disputes/next endpoint that returns the oldest open dispute',
    'Rename Ledger.post to Ledger.record everywhere',
    'How does a gantry camera reading end up as a charge in the ledger?',
    'Fix the null check in TollSession.close() and then add a config flag so ops can disable it',
    'the session thing',
  ];
  for (const [k, text] of requests.entries()) {
    const session = `demo-${k}`;
    const { pack } = await core.call('pack.compile', { request: { text, ide: { interactive: k !== 5 } }, target: 'json', sessionId: session });
    const call = async (tool, a, result) => {
      await core.call('govern.toolCall', { sessionId: session, phase: 'explore', tool, args: a, at: new Date().toISOString() });
      await core.call('govern.event', { sessionId: session, kind: 'tool.result', payload: { tool, args: a, result } });
    };
    const files = [...new Set(pack.items.filter((i) => i.tier === 2 && i.source.path).map((i) => i.source.path))].slice(0, 3);
    for (const f of files) await call('Read', { file_path: join(repo, f) }, 'contents');
    if (files[0]) await call('Read', { file_path: join(repo, files[0]) }, 'contents');
    await call('Grep', { pattern: 'charge-on-close' }, '');
    await call('Glob', { pattern: 'src/**/*.ts' }, '');
    if (files[0] && k < 4) {
      await call('Edit', { file_path: join(repo, files[0]), old_string: 'a', new_string: 'b' }, 'ok');
      await call('Bash', { command: 'npx vitest run' }, '13 passed');
    }
    await core.call('govern.event', { sessionId: session, kind: 'session.end', payload: {} });
  }
}

const html = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RIAF Console</title><link rel="stylesheet" href="/console.css"></head>
<body data-repo="${repo}" data-mps="/mps-logo.png" data-mlff="/mlff-mark.svg"><div id="root"></div>
<script>
  // stands in for VS Code's webview API: requests go to the dev server, answers come back as message events
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => fetch('/rpc', { method: 'POST', body: JSON.stringify(m) }).then((r) => r.json()).then((d) => window.postMessage({ ...d, id: m.id }, '*')),
    getState: () => { try { return JSON.parse(sessionStorage.getItem('riaf.state') || '{}'); } catch { return {}; } },
    setState: (s) => sessionStorage.setItem('riaf.state', JSON.stringify(s)),
  });
</script>
<script src="/console.js"></script></body></html>`;

const webview = join(root, 'packages/extension/dist/webview');
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      for await (const c of req) body += c;
      const msg = JSON.parse(body);
      const out = await handleConsole({
        rpc: core,
        writeRiafFile: async (name, text) => writeFileSync(join(repo, '.riaf', name), text),
        modelSettings: () => ({ summarize: { provider: 'ollama', model: 'qwen2.5:7b' }, classify: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://gateway.internal/v1', apiKeyEnv: 'GATEWAY_TOKEN' } }),
        runCommand: async (cmd) => console.log(`(dev) would run VS Code command ${cmd}`),
      }, msg).catch((e) => ({ type: 'error', message: e.message }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      return;
    }
    const assets = { '/console.js': 'text/javascript', '/console.css': 'text/css', '/mps-logo.png': 'image/png', '/mlff-mark.svg': 'image/svg+xml' };
    const file = assets[req.url] ? join(webview, req.url.slice(1)) : undefined;
    if (file && existsSync(file)) {
      res.writeHead(200, { 'content-type': assets[req.url], 'cache-control': 'no-store' }).end(readFileSync(file));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(html());
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`RIAF console on http://127.0.0.1:${port}/  (repo ${repo})`));
