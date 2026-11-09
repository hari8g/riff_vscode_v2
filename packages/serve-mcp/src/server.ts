import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { INTENTS, RiafError, type RpcMethod, type RpcParams, type RpcResult } from '@riaf/kernel';
import { formatImpact, formatJump, formatWikiPage, formatWikiTree } from './format.js';

/** What the MCP server needs from the daemon: the client SDK or an in-process core. */
export interface RpcCaller {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  /** Session id stamped on packs so riaf://pack/current returns this session's pack. */
  sessionId?: string;
  /** Budget used when riaf_pack is called without one. */
  defaultBudget?: number;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const failure = (e: unknown) => ({ content: [{ type: 'text' as const, text: `RIAF error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

export const TOOL_NAMES = ['riaf_pack', 'riaf_jump', 'riaf_impact', 'riaf_history', 'riaf_wiki'] as const;

/** Builds the RIAF MCP server: five tools and three resources, all delegating to the daemon. */
export function createMcpServer(rpc: RpcCaller, opts: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: opts.name ?? 'riaf', version: opts.version ?? '0.3.0' }, {
    instructions: 'RIAF compiles a budgeted, provenance-stamped context pack for a coding task. Call riaf_pack first with the user request; follow its suggested lookups before grepping or reading whole files. Use riaf_jump for definitions and references, riaf_impact before changing a public symbol.',
  });
  const guard = <A>(fn: (a: A) => Promise<{ content: { type: 'text'; text: string }[] }>) => async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return failure(e);
    }
  };

  server.registerTool('riaf_pack', {
    title: 'Compile a context pack',
    description: 'Compiles the context a model needs for a coding request (bug fix, feature, refactor, review, merge, onboarding): the relevant code bodies, the test to mimic, callers, conventions and history, within a token budget. Call this first.',
    inputSchema: {
      request: z.string().min(1).describe('The task in the user’s words'),
      budget: z.number().int().positive().max(64000).optional().describe('Token budget (default from policies)'),
      intent: z.enum(INTENTS).optional().describe('Hint when the user said what kind of task it is'),
      activeFile: z.string().optional().describe('Repo-relative path of the file in focus'),
      stackTrace: z.string().optional(),
      failingTests: z.array(z.string()).optional(),
    },
  }, guard(async (a) => {
    const ide = { ...(a.activeFile ? { activeFile: a.activeFile } : {}), ...(a.stackTrace ? { stackTrace: a.stackTrace } : {}), ...(a.failingTests ? { failingTests: a.failingTests } : {}), interactive: true };
    const r = await rpc.call('pack.compile', {
      request: { text: a.request, ide, ...(a.intent ? { intentHint: a.intent } : {}) },
      target: 'claude', ...(a.budget ?? opts.defaultBudget ? { budget: a.budget ?? opts.defaultBudget! } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    });
    return text(r.rendered);
  }));

  server.registerTool('riaf_jump', {
    title: 'Jump to a symbol',
    description: 'Definition, signature, doc and every reference of a symbol (qualified name like `Class.method`, bare name, symbol id, or `path:line`), with recent commits when history is indexed.',
    inputSchema: { symbol: z.string().min(1) },
  }, guard(async (a) => text(formatJump(await rpc.call('graph.jump', { query: a.symbol })))));

  server.registerTool('riaf_impact', {
    title: 'Blast radius of a change',
    description: 'What depends on the given symbols (callers, overriders, type users, importers), which tests exercise them, and what usually changes with them. Call before changing a public symbol.',
    inputSchema: { symbols: z.array(z.string().min(1)).min(1), hops: z.number().int().min(1).max(4).optional() },
  }, guard(async (a) => {
    const ids: string[] = [];
    for (const q of a.symbols) {
      const j = await rpc.call('graph.jump', { query: q });
      if (!j.definition) throw new RiafError('not_found', `no symbol matched ${q}`);
      ids.push(j.definition.symbol);
    }
    return text(formatImpact(ids, await rpc.call('graph.impact', { symbols: ids, ...(a.hops ? { hops: a.hops } : {}) })));
  }));

  server.registerTool('riaf_history', {
    title: 'History of a symbol',
    description: 'Commits, reverts, incidents and ADRs touching a symbol or path: why the code is the way it is.',
    inputSchema: { symbol: z.string().min(1) },
  }, guard(async (a) => {
    const info = await rpc.call('daemon.info', {});
    if (!info.methods.includes('history.timeline')) {
      const j = await rpc.call('graph.jump', { query: a.symbol });
      return text(`History is not indexed in this daemon (protocol ${info.protocol}). ${j.definition ? `\`${j.definition.symbol}\` is defined at \`${j.definition.path}:${j.definition.startLine}\`; use \`git log -L ${j.definition.startLine},${j.definition.endLine}:${j.definition.path}\` meanwhile.` : ''}`);
    }
    const r = await (rpc as unknown as { call(m: string, p: unknown): Promise<{ text: string }> }).call('history.timeline', { query: a.symbol, render: true });
    return text(r.text);
  }));

  server.registerTool('riaf_wiki', {
    title: 'Repository wiki',
    description: 'Summaries of the repository, a directory or a file (with its symbols). Omit `node` for the top-level structure.',
    inputSchema: { node: z.string().optional().describe('`src/pricing/`, `src/pricing/engine.ts`, or empty for the tree') },
  }, guard(async (a) => text(a.node ? formatWikiPage(await rpc.call('wiki.page', { node: a.node })) : formatWikiTree((await rpc.call('wiki.structure', { depth: 2 })).tree))));

  server.registerResource('current-pack', 'riaf://pack/current', { title: 'Current RIAF pack', description: 'The most recent context pack of this session', mimeType: 'text/markdown' }, async (uri) => {
    const r = await rpc.call('pack.get', { target: 'claude', ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) });
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: r.rendered ?? 'No pack compiled yet in this session. Call riaf_pack.' }] };
  });
  server.registerResource('runbook', 'riaf://runbook', { title: 'Run-book', description: 'Commands, layout, conventions and constraints (≤ 60 lines)', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: (await rpc.call('runbook.get', {})).text }],
  }));
  server.registerResource('architecture', 'riaf://architecture', { title: 'Architecture', description: 'Directory structure with summaries', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: formatWikiTree((await rpc.call('wiki.structure', { depth: 3 })).tree) }],
  }));
  return server;
}
