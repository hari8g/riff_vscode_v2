import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { answerQuestion, isLens, resetAskCache, understand } from './askHost.js';
import type { LiveEvent, LiveSession } from './claudeLive.js';
import { suggestTasks } from './suggest.js';
import { BENCHMARKS, live } from './savings.js';
import { TOKEN_PRESETS } from '@riaf/kernel';
import { tokensYaml } from '@riaf/daemon';
import type { Rpc } from './tools.js';

/** Messages between the console webview and the extension; the data side is pure and tested. */

export type ConsoleRequest =
  | { type: 'load'; page: 'overview' | 'repository' | 'policies' | 'sessions' | 'adapters' | 'savings' | 'health' }
  | { type: 'prompt'; text: string; host?: 'claude' | 'copilot' | 'generic'; budget?: number }
  | { type: 'tokens' }
  | { type: 'validateTokens'; text?: string; settings?: unknown }
  | { type: 'saveTokens'; text?: string; settings?: unknown }
  | { type: 'validatePolicies'; policies: string; governance: string }
  | { type: 'savePolicies'; policies: string; governance: string }
  | { type: 'wikiPage'; node: string }
  | { type: 'route'; text: string; activeFile?: string }
  | { type: 'compile'; text: string; budget?: number; activeFile?: string; intent?: string }
  | { type: 'render'; packId: string; target: 'claude' | 'copilot' | 'fragment' | 'json' | 'agentsmd' }
  | { type: 'jump'; query: string }
  | { type: 'impact'; query: string }
  | { type: 'history'; query: string }
  | { type: 'understand'; text: string; lens?: string }
  | { type: 'ask'; text: string; lens?: string }
  | { type: 'reindex' }
  | { type: 'handoff'; to: 'copilot' | 'claude'; text: string; packId: string }
  | { type: 'repos' }
  | { type: 'openRepo'; path?: string; browse?: boolean }
  | { type: 'live' }
  | { type: 'liveSession'; session: string }
  | { type: 'suggestTasks' };

/** Switching repositories: the host keeps the current one, a recent list, and (in VS Code) a folder dialog. */
export interface RepoHost {
  current(): string;
  recent(): string[];
  /** Shows a folder picker; undefined when cancelled. Absent where no native dialog exists (dev server). */
  browse?(): Promise<string | undefined>;
  /** Makes `root` the console's repository with a freshly started daemon. */
  open(root: string): Promise<void>;
  /** True when the page must reload itself after a switch (the host does not re-render it). */
  reloadOnSwitch: boolean;
}

export interface ConsoleDeps {
  rpc: Rpc;
  /** Writes `.riaf/<name>` (policies are saved only after validation). */
  writeRiafFile(name: string, text: string): Promise<void>;
  /** Adapter settings as configured in VS Code (`riaf.models`). */
  modelSettings(): Record<string, unknown>;
  /** Runs a VS Code command (hand-off to Copilot or Claude Code); absent outside VS Code. */
  runCommand?(command: string, ...args: unknown[]): Promise<void>;
  repo?: RepoHost;
  /** What Claude Code is doing in this repository (its transcripts, tailed). */
  live?(): { dir: string; found: boolean; sessions: LiveSession[]; events: LiveEvent[] };
  /** Every event of one Claude Code session (for its workflow). */
  liveSession?(session: string): LiveEvent[];
}

/** Resolves a typed repository path (`~` and relative paths allowed) and checks it is a folder. */
export function normalizeRepoPath(input: string, home = homedir()): string {
  const t = input.trim().replace(/^["']|["']$/g, '');
  if (!t) throw new Error('type the path of a repository folder');
  const p = t === '~' ? home : t.startsWith('~/') ? resolve(home, t.slice(2)) : isAbsolute(t) ? resolve(t) : resolve(home, t);
  if (!existsSync(p)) throw new Error(`no folder at ${p}`);
  if (!statSync(p).isDirectory()) throw new Error(`${p} is a file, not a folder`);
  return p;
}

/** Answers one console request with the payload the page renders. */
export async function handleConsole(deps: ConsoleDeps, req: ConsoleRequest): Promise<{ type: string; [k: string]: unknown }> {
  const { rpc } = deps;
  switch (req.type) {
    case 'repos':
      return { type: 'repos', current: deps.repo?.current() ?? '', recent: deps.repo?.recent() ?? [], canBrowse: !!deps.repo?.browse };
    case 'openRepo': {
      if (!deps.repo) return { type: 'error', message: 'this console cannot switch repositories' };
      const picked = req.browse ? await deps.repo.browse?.() : req.path;
      if (picked === undefined) return { type: 'repoOpened', cancelled: true };
      const root = normalizeRepoPath(picked);
      resetAskCache();
      await deps.repo.open(root);
      return { type: 'repoOpened', root, reload: deps.repo.reloadOnSwitch };
    }
    case 'live':
      return { type: 'live', ...(deps.live?.() ?? { dir: '', found: false, sessions: [], events: [] }) };
    case 'liveSession':
      return { type: 'liveSession', session: req.session, events: deps.liveSession?.(req.session) ?? [] };
    case 'suggestTasks':
      return { type: 'suggestions', tasks: await suggestTasks(rpc) };
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
        case 'health': {
          const [insights, files, areas, glossary] = await Promise.all([
            rpc.call('graph.insights', { top: 8 }), rpc.call('history.hotspots', { top: 10 }),
            rpc.call('history.hotspots', { top: 8, byDirectory: true }), rpc.call('semantic.glossary', { top: 40 }),
          ]);
          return { type: 'health', insights, hotspots: files.hotspots, areas: areas.hotspots, glossary: glossary.terms };
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
    case 'prompt': {
      const r = await rpc.call('prompt.build', { request: { text: req.text, ide: { interactive: true } }, host: req.host ?? 'claude', sessionId: 'console', ...(req.budget ? { budget: req.budget } : {}) });
      return { type: 'prompt', pack: r.pack, prompt: r.prompt };
    }
    case 'tokens': {
      const t = await rpc.call('tokens.get', {});
      const presets = Object.fromEntries(Object.entries(TOKEN_PRESETS).map(([k, f]) => [k, f(t.settings)]));
      return { type: 'tokens', ...t, presets };
    }
    case 'validateTokens':
    case 'saveTokens': {
      const text = req.text ?? tokensYaml(req.settings as never);
      const v = await rpc.call('tokens.validate', { text });
      if (req.type === 'validateTokens' || !v.ok) return { type: 'tokenValidation', ...v, text };
      await deps.writeRiafFile('tokens.yaml', text);
      return { type: 'tokensSaved', ok: true, settings: v.settings, text };
    }
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
    case 'understand':
      return { type: 'understood', ...(await understand(rpc, req.text, isLens(req.lens) ? req.lens : undefined)) };
    case 'ask':
      return { type: 'answered', ...(await answerQuestion(rpc, req.text, isLens(req.lens) ? req.lens : undefined)) };
    case 'reindex': {
      resetAskCache();
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
