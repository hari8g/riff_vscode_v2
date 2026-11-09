import type { RpcMethod, RpcParams, RpcResult } from '@riaf/kernel';

/** The daemon surface the extension uses (DaemonClient in production, DaemonCore in tests). */
export interface Rpc {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
}

/**
 * Copilot LM tools, one per MCP tool, with JSON schemas mirrored in package.json
 * (`contributes.languageModelTools`); a test keeps the two in sync.
 */
export const TOOL_DEFS = [
  {
    name: 'riaf_pack', displayName: 'RIAF context pack', toolReferenceName: 'riafPack',
    modelDescription: 'Compiles the context needed for a coding request in this repository: relevant code bodies, the test to mimic, callers, conventions and history, within a token budget. Call it first, before searching or reading files.',
    inputSchema: { type: 'object', properties: { request: { type: 'string', description: 'The task in the user’s words' }, budget: { type: 'number', description: 'Token budget' }, activeFile: { type: 'string', description: 'Repo-relative path of the file in focus' } }, required: ['request'] },
  },
  {
    name: 'riaf_jump', displayName: 'RIAF jump', toolReferenceName: 'riafJump',
    modelDescription: 'Definition, signature and every reference of a symbol (Class.method, bare name, or path:line).',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'riaf_impact', displayName: 'RIAF impact', toolReferenceName: 'riafImpact',
    modelDescription: 'What depends on the given symbols and which tests exercise them; call before changing a public symbol.',
    inputSchema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] },
  },
  {
    name: 'riaf_history', displayName: 'RIAF history', toolReferenceName: 'riafHistory',
    modelDescription: 'Commits, reverts, incidents and decisions behind a symbol: why the code is the way it is.',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'riaf_wiki', displayName: 'RIAF wiki', toolReferenceName: 'riafWiki',
    modelDescription: 'Summaries of the repository, a directory or a file. Omit node for the top-level structure.',
    inputSchema: { type: 'object', properties: { node: { type: 'string' } } },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]['name'];

const nameOf = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || id;

/** Runs one tool against the daemon and returns the text Copilot sees. */
export async function invokeTool(rpc: Rpc, name: ToolName, input: Record<string, unknown>, sessionId?: string): Promise<string> {
  switch (name) {
    case 'riaf_pack': {
      const r = await rpc.call('pack.compile', {
        request: { text: String(input['request'] ?? ''), ide: { ...(typeof input['activeFile'] === 'string' ? { activeFile: input['activeFile'] } : {}), interactive: true } },
        target: 'copilot', ...(typeof input['budget'] === 'number' ? { budget: input['budget'] } : {}), ...(sessionId ? { sessionId } : {}),
      });
      return r.rendered;
    }
    case 'riaf_jump': {
      const j = await rpc.call('graph.jump', { query: String(input['symbol'] ?? '') });
      if (!j.definition) return 'No symbol matched.';
      const d = j.definition;
      return [`${nameOf(d.symbol)} (${d.kind ?? 'symbol'}) at ${d.path}:${d.startLine}-${d.endLine}`, d.signature, ...(d.doc ? [d.doc.split('\n')[0]!] : []), `References (${j.references.length}):`, ...j.references.slice(0, 30).map((r) => `- ${r.path}:${r.line} ${r.kind} in ${nameOf(r.symbol)}`), ...j.blame.slice(0, 3).map((b) => `- commit ${b.commit.slice(0, 10)} ${b.at.slice(0, 10)} ${b.summary ?? ''}`)].join('\n');
    }
    case 'riaf_impact': {
      const ids: string[] = [];
      for (const q of (input['symbols'] as string[] | undefined) ?? []) {
        const j = await rpc.call('graph.jump', { query: q });
        if (j.definition) ids.push(j.definition.symbol);
      }
      if (!ids.length) return 'No symbol matched.';
      const r = await rpc.call('graph.impact', { symbols: ids });
      return [`Dependents (${r.closure.length}):`, ...r.closure.slice(0, 40).map((c) => `- ${c.symbol} (${c.via})`), `Tests (${r.tests.length}):`, ...r.tests.map((t) => `- ${t}`)].join('\n');
    }
    case 'riaf_history': {
      const why = await rpc.call('history.rationale', { query: String(input['symbol'] ?? '') });
      return why.text;
    }
    case 'riaf_wiki': {
      if (typeof input['node'] === 'string' && input['node']) {
        const p = await rpc.call('wiki.page', { node: input['node'] });
        return [`${p.id || '/'} (${p.level})`, p.summary, ...p.children.map((c) => `- ${c.id} — ${c.summary}`), ...p.symbols.map((s) => `- ${s.signature}`)].join('\n');
      }
      const t = await rpc.call('wiki.structure', { depth: 2 });
      const lines: string[] = [];
      const walk = (n: typeof t.tree, d: number) => {
        lines.push(`${'  '.repeat(d)}- ${n.id || '/'}${n.summary ? ` — ${n.summary}` : ''}`);
        for (const c of n.children) walk(c, d + 1);
      };
      walk(t.tree, 0);
      return lines.join('\n');
    }
  }
}
