import type { Rpc } from './tools.js';

/** Messages between the console webview and the extension; the data side is pure and tested. */

export type ConsoleRequest =
  | { type: 'load'; page: 'overview' | 'repository' | 'policies' | 'sessions' | 'adapters' }
  | { type: 'validatePolicies'; policies: string; governance: string }
  | { type: 'savePolicies'; policies: string; governance: string }
  | { type: 'wikiPage'; node: string };

export interface ConsoleDeps {
  rpc: Rpc;
  /** Writes `.riaf/<name>` (policies are saved only after validation). */
  writeRiafFile(name: string, text: string): Promise<void>;
  /** Adapter settings as configured in VS Code (`riaf.models`). */
  modelSettings(): Record<string, unknown>;
}

/** Answers one console request with the payload the page renders. */
export async function handleConsole(deps: ConsoleDeps, req: ConsoleRequest): Promise<{ type: string; [k: string]: unknown }> {
  const { rpc } = deps;
  switch (req.type) {
    case 'load':
      switch (req.page) {
        case 'overview': {
          const [status, telemetry] = await Promise.all([rpc.call('index.status', {}), rpc.call('telemetry.query', {})]);
          return { type: 'overview', status, telemetry };
        }
        case 'repository': {
          const [tree, runbook] = await Promise.all([rpc.call('wiki.structure', { depth: 3 }), rpc.call('runbook.get', {})]);
          return { type: 'repository', tree: tree.tree, runbook: runbook.text };
        }
        case 'policies':
          return { type: 'policies', ...(await rpc.call('policies.get', {})) };
        case 'sessions': {
          const t = await rpc.call('telemetry.query', {});
          return { type: 'sessions', telemetry: t };
        }
        case 'adapters': {
          const info = await rpc.call('daemon.info', {});
          return { type: 'adapters', daemon: info, models: deps.modelSettings() };
        }
      }
      break;
    case 'validatePolicies':
      return { type: 'validation', ...(await rpc.call('policies.validate', { policies: req.policies, governance: req.governance })) };
    case 'savePolicies': {
      const v = await rpc.call('policies.validate', { policies: req.policies, governance: req.governance });
      if (!v.ok) return { type: 'validation', ...v };
      await deps.writeRiafFile('policies.yaml', req.policies);
      await deps.writeRiafFile('governance.yaml', req.governance);
      return { type: 'saved', ok: true };
    }
    case 'wikiPage':
      return { type: 'wikiPage', page: await rpc.call('wiki.page', { node: req.node }) };
  }
  return { type: 'error', message: 'unknown request' };
}
