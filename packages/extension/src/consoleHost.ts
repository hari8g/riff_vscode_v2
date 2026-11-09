import { BENCHMARKS, live } from './savings.js';
import type { Rpc } from './tools.js';

/** Messages between the console webview and the extension; the data side is pure and tested. */

export type ConsoleRequest =
  | { type: 'load'; page: 'overview' | 'repository' | 'policies' | 'sessions' | 'adapters' | 'savings' }
  | { type: 'validatePolicies'; policies: string; governance: string }
  | { type: 'savePolicies'; policies: string; governance: string }
  | { type: 'wikiPage'; node: string }
  | { type: 'route'; text: string; activeFile?: string }
  | { type: 'compile'; text: string; budget?: number; activeFile?: string; intent?: string }
  | { type: 'render'; packId: string; target: 'claude' | 'copilot' | 'fragment' | 'json' | 'agentsmd' }
  | { type: 'jump'; query: string }
  | { type: 'impact'; query: string }
  | { type: 'history'; query: string }
  | { type: 'reindex' }
  | { type: 'handoff'; to: 'copilot' | 'claude'; text: string; packId: string };

export interface ConsoleDeps {
  rpc: Rpc;
  /** Writes `.riaf/<name>` (policies are saved only after validation). */
  writeRiafFile(name: string, text: string): Promise<void>;
  /** Adapter settings as configured in VS Code (`riaf.models`). */
  modelSettings(): Record<string, unknown>;
  /** Runs a VS Code command (hand-off to Copilot or Claude Code); absent outside VS Code. */
  runCommand?(command: string, ...args: unknown[]): Promise<void>;
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
        case 'savings': {
          const t = await rpc.call('telemetry.query', {});
          return { type: 'savings', benchmarks: BENCHMARKS, live: live(t) };
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
    case 'route': {
      const policy = await rpc.call('route', { text: req.text, ide: { ...(req.activeFile ? { activeFile: req.activeFile } : {}), interactive: true } });
      return { type: 'route', policy };
    }
    case 'compile': {
      const r = await rpc.call('pack.compile', {
        request: { text: req.text, ide: { ...(req.activeFile ? { activeFile: req.activeFile } : {}), interactive: true }, ...(req.intent ? { intentHint: req.intent as never } : {}) },
        target: 'claude', sessionId: 'console', ...(req.budget ? { budget: req.budget } : {}),
      });
      return { type: 'compiled', pack: r.pack, rendered: r.rendered };
    }
    case 'render': {
      const r = await rpc.call('pack.get', { packId: req.packId, target: req.target });
      return { type: 'rendered', target: req.target, text: r.rendered ?? '' };
    }
    case 'jump':
      return { type: 'jump', result: await rpc.call('graph.jump', { query: req.query }) };
    case 'impact': {
      const j = await rpc.call('graph.jump', { query: req.query });
      if (!j.definition) return { type: 'impact', definition: null };
      const impact = await rpc.call('graph.impact', { symbols: [j.definition.symbol], hops: 2 });
      return { type: 'impact', definition: j.definition, references: j.references, impact };
    }
    case 'history':
      return { type: 'history', ...(await rpc.call('history.rationale', { query: req.query })) };
    case 'reindex': {
      const r = await rpc.call('index.rebuild', { wait: true });
      return { type: 'reindexed', run: r.run };
    }
    case 'handoff':
      if (!deps.runCommand) return { type: 'error', message: 'hand-off runs inside VS Code' };
      await deps.runCommand(req.to === 'copilot' ? 'riaf.handoffCopilot' : 'riaf.handoffClaude', req.text, req.packId);
      return { type: 'handedOff', to: req.to };
  }
  return { type: 'error', message: 'unknown request' };
}
