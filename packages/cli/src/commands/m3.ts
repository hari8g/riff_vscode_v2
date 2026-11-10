import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { INTENTS, RENDER_TARGETS, type Intent, type RenderTarget } from '@riaf/kernel';
import { formatWikiPage, formatWikiTree, hookScript, hooksConfig, pluginFiles, serveHttp, serveStdio } from '@riaf/serve-mcp';
import { bool, int, str, type ParsedArgs } from '../args.js';
import { defaultTokensYaml } from '@riaf/daemon';
import { findRoot, openSession } from '../connect.js';
import type { Io } from '../io.js';
import { CONSTRAINTS_MD, GOVERNANCE_YAML, POLICIES_YAML, SLASH_COMMANDS } from '../templates.js';

/** `riaf pack "<request>" [--budget N] [--render claude|copilot|fragment|json|agentsmd] [--intent X] [--file F] [--stack-trace T]` */
export async function cmdPack(p: ParsedArgs, io: Io): Promise<number> {
  const text = p.positionals.join(' ').trim();
  if (!text) {
    io.err('usage: riaf pack "<request>" [--budget N] [--render claude|copilot|fragment|json|agentsmd] [--intent bugfix|feature|...]');
    return 2;
  }
  const target = (str(p, 'render') ?? (bool(p, 'json') ? 'json' : 'claude')) as RenderTarget;
  if (!RENDER_TARGETS.includes(target)) {
    io.err(`--render must be one of ${RENDER_TARGETS.join(', ')}`);
    return 2;
  }
  const intent = str(p, 'intent') as Intent | undefined;
  if (intent && !INTENTS.includes(intent)) {
    io.err(`--intent must be one of ${INTENTS.join(', ')}`);
    return 2;
  }
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const ide = { ...(str(p, 'file') ? { activeFile: str(p, 'file')! } : {}), ...(str(p, 'stack-trace') ? { stackTrace: str(p, 'stack-trace')! } : {}), interactive: bool(p, 'interactive', false) };
    const r = await s.rpc.call('pack.compile', { request: { text, ide, ...(intent ? { intentHint: intent } : {}) }, target, ...(int(p, 'budget') ? { budget: int(p, 'budget')! } : {}) });
    io.out(r.rendered);
    if (!bool(p, 'quiet') && target !== 'json') io.err(`pack ${r.pack.packId}: ${r.pack.items.length} items, ${r.pack.tokensUsed}/${r.pack.budget} tokens, branch ${r.pack.route.branch}`);
    return 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf prompt "<request>" [--host claude|copilot|generic] [--budget N] [--plan]` — the detailed agent prompt RIAF injects. */
export async function cmdPrompt(p: ParsedArgs, io: Io): Promise<number> {
  const text = p.positionals.join(' ').trim();
  const host = (str(p, 'host') ?? 'claude') as 'claude' | 'copilot' | 'generic';
  if (!text || !['claude', 'copilot', 'generic'].includes(host)) {
    io.err('usage: riaf prompt "<request>" [--host claude|copilot|generic] [--budget N] [--plan]');
    return 2;
  }
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const r = await s.rpc.call('prompt.build', { request: { text, ide: { interactive: bool(p, 'interactive', false) } }, host, ...(int(p, 'budget') ? { budget: int(p, 'budget')! } : {}) });
    const t = r.prompt.plan;
    if (bool(p, 'json')) io.out(JSON.stringify(r.prompt, null, 2));
    else if (bool(p, 'plan')) {
      io.out(`model ${t.model}: window ${t.contextWindow}, usable ${t.usable}`);
      io.out(`prompt ${t.prompt} (instructions ${t.frame}, cacheable ${t.cacheable}) · pack ${t.packUsed}/${t.packBudget} · reply ${t.output} · reasoning ${t.reasoning} · headroom ${t.headroom}`);
      io.out(`intent mix: ${t.intentMix.map((m) => `${m.intent} ${Math.round(m.weight * 100)}% (pack ${m.pack}, reply ${m.output}${m.planGate ? ', plan gate' : ''})`).join('; ')}`);
      io.out(`plan gate ${t.planGate ? 'on' : 'off'} · summarise at ${t.summarizeAt}`);
      for (const sec of r.prompt.sections) io.out(`  ${sec.cacheable ? '[cache]' : '       '} ${sec.title.padEnd(44)} ${String(sec.tokens).padStart(6)}`);
    } else io.out(r.prompt.text);
    if (!bool(p, 'quiet') && !bool(p, 'json')) io.err(`prompt ${r.prompt.promptId}: ${t.prompt} tokens, headroom ${t.headroom}, pack ${r.pack.packId}`);
    return 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf wiki [node]` — repository structure or one page. */
export async function cmdWiki(p: ParsedArgs, io: Io): Promise<number> {
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const node = p.positionals[0];
    if (node) {
      const page = await s.rpc.call('wiki.page', { node });
      io.out(bool(p, 'json') ? JSON.stringify(page, null, 2) : formatWikiPage(page));
    } else {
      const t = await s.rpc.call('wiki.structure', { depth: int(p, 'depth', 3)! });
      io.out(bool(p, 'json') ? JSON.stringify(t, null, 2) : formatWikiTree(t.tree));
    }
    return 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf runbook [--write]` — prints or regenerates `.riaf/runbook.md`. */
export async function cmdRunbook(p: ParsedArgs, io: Io): Promise<number> {
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const { text, lines } = await s.rpc.call('runbook.get', {});
    if (bool(p, 'write')) {
      mkdirSync(join(s.root, '.riaf'), { recursive: true });
      writeFileSync(join(s.root, '.riaf', 'runbook.md'), text);
      io.err(`wrote .riaf/runbook.md (${lines} lines)`);
    } else io.out(text);
    return 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf mcp [--http PORT]` — the MCP server Claude Code launches (stdio) or a local HTTP endpoint. */
export async function cmdMcp(p: ParsedArgs, io: Io): Promise<number> {
  const s = await openSession(p, io.cwd);
  await s.ensureIndexed();
  const port = int(p, 'http');
  if (port !== undefined) {
    const http = await serveHttp(s.rpc, port);
    io.err(`riaf MCP on http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`);
    await new Promise<never>(() => undefined);
  }
  await serveStdio(s.rpc);
  await s.rpc.close();
  return 0;
}

function writeIfAbsent(path: string, content: string, io: Io, force: boolean): void {
  if (existsSync(path) && !force) {
    io.err(`kept ${path} (exists)`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  io.err(`wrote ${path}`);
}

function mergeJson(path: string, mutate: (j: Record<string, unknown>) => void, io: Io): void {
  let j: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      io.err(`warning: ${path} is not valid JSON; leaving it unchanged`);
      return;
    }
  }
  mutate(j);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  io.err(`updated ${path}`);
}

function appendLineOnce(path: string, line: string, io: Io): void {
  const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (cur.split('\n').some((l) => l.trim() === line.trim())) return;
  writeFileSync(path, cur ? `${line}\n\n${cur}` : `${line}\n`);
  io.err(`${cur ? 'updated' : 'wrote'} ${path}`);
}

/**
 * `riaf init [--host claude|copilot|both] [--command riaf] [--force]` — writes `.riaf/` policies and
 * constraints, generates the run-book, imports it from CLAUDE.md / AGENTS.md, and registers the MCP
 * server for Claude Code (`.mcp.json` + slash commands) and/or VS Code Copilot (`.vscode/mcp.json`).
 */
export async function cmdInit(p: ParsedArgs, io: Io): Promise<number> {
  const root = resolve(str(p, 'root') ?? findRoot(io.cwd));
  const host = str(p, 'host') ?? 'claude';
  if (!['claude', 'copilot', 'both'].includes(host)) {
    io.err('--host must be claude, copilot or both');
    return 2;
  }
  const force = bool(p, 'force');
  writeIfAbsent(join(root, '.riaf/policies.yaml'), POLICIES_YAML, io, force);
  writeIfAbsent(join(root, '.riaf/governance.yaml'), GOVERNANCE_YAML, io, force);
  writeIfAbsent(join(root, '.riaf/tokens.yaml'), defaultTokensYaml(), io, force);
  writeIfAbsent(join(root, '.riaf/constraints.md'), CONSTRAINTS_MD, io, false);
  const gi = join(root, '.gitignore');
  const ignore = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!ignore.includes('.riaf/*.sqlite')) writeFileSync(gi, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}# riaf runtime state\n.riaf/*.sqlite\n.riaf/*.tmp-*\n.riaf/daemon.*\n`);
  // the MCP command: an installed `riaf`, or this very CLI through node
  const self = process.argv[1];
  const cmd = str(p, 'command');
  const server = cmd ? { command: cmd, args: ['mcp'] } : { command: process.execPath, args: [self ? resolve(self) : 'riaf', 'mcp'] };
  if (host === 'claude' || host === 'both') {
    mergeJson(join(root, '.mcp.json'), (j) => {
      const servers = (j['mcpServers'] as Record<string, unknown> | undefined) ?? {};
      servers['riaf'] = { type: 'stdio', ...server };
      j['mcpServers'] = servers;
    }, io);
    for (const [name, body] of Object.entries(SLASH_COMMANDS)) writeIfAbsent(join(root, '.claude/commands', name), body, io, force);
    appendLineOnce(join(root, 'CLAUDE.md'), '@.riaf/runbook.md', io);
    if (bool(p, 'hooks', true)) {
      const cliPath = self ? resolve(self) : '';
      mkdirSync(join(root, '.riaf/hooks'), { recursive: true });
      writeFileSync(join(root, '.riaf/hooks/riaf-hook.mjs'), hookScript({ cliPath }));
      io.err('wrote .riaf/hooks/riaf-hook.mjs');
      mergeJson(join(root, '.claude/settings.json'), (j) => {
        const hooks = (j['hooks'] as Record<string, unknown[]> | undefined) ?? {};
        for (const [event, entries] of Object.entries(hooksConfig('node "$CLAUDE_PROJECT_DIR/.riaf/hooks/riaf-hook.mjs"'))) {
          // replace RIAF's own entries, keep everyone else's
          const others = (hooks[event] ?? []).filter((e) => !JSON.stringify(e).includes('riaf-hook.mjs'));
          hooks[event] = [...others, ...(entries as unknown[])];
        }
        j['hooks'] = hooks;
      }, io);
    }
  }
  if (host === 'copilot' || host === 'both') {
    mergeJson(join(root, '.vscode/mcp.json'), (j) => {
      const servers = (j['servers'] as Record<string, unknown> | undefined) ?? {};
      servers['riaf'] = { type: 'stdio', ...server };
      j['servers'] = servers;
    }, io);
    appendLineOnce(join(root, 'AGENTS.md'), 'Read `.riaf/runbook.md` first; call the `riaf_pack` tool before exploring the code.', io);
  }
  // index and generate the run-book
  const s = await openSession(p, root);
  try {
    await s.ensureIndexed();
    const { text, lines } = await s.rpc.call('runbook.get', {});
    writeFileSync(join(root, '.riaf/runbook.md'), text);
    io.err(`wrote .riaf/runbook.md (${lines} lines)`);
  } finally {
    await s.rpc.close();
  }
  io.out(`RIAF initialised for ${host} in ${root}`);
  return 0;
}

/** `riaf history <symbol|path> [--why] [--limit N]` — timeline (blame per symbol) or rationale. */
export async function cmdHistory(p: ParsedArgs, io: Io): Promise<number> {
  const target = p.positionals.join(' ').trim();
  if (!target) {
    io.err('usage: riaf history <symbol | path> [--why] [--limit N]');
    return 2;
  }
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    if (bool(p, 'why')) {
      const r = await s.rpc.call('history.rationale', { query: target });
      io.out(bool(p, 'json') ? JSON.stringify(r, null, 2) : r.text);
      return r.symbol ? 0 : 1;
    }
    const isPath = /\.[a-z]{1,5}$/i.test(target) && !target.includes('#');
    const r = await s.rpc.call('history.timeline', { ...(isPath ? { path: target } : { query: target }), limit: int(p, 'limit', 20)! });
    io.out(bool(p, 'json') ? JSON.stringify(r, null, 2) : r.text);
    return r.kind === 'none' ? 1 : 0;
  } finally {
    await s.rpc.close();
  }
}

/** \`riaf plugin --out DIR\` — writes an installable Claude Code plugin (MCP server, hooks, slash commands). */
export async function cmdPlugin(p: ParsedArgs, io: Io): Promise<number> {
  const out = str(p, 'out');
  if (!out) {
    io.err('usage: riaf plugin --out <dir>');
    return 2;
  }
  const self = process.argv[1];
  const files = pluginFiles({ version: '0.4.0', cliPath: self ? resolve(self) : 'riaf', commands: SLASH_COMMANDS });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(out, rel)), { recursive: true });
    writeFileSync(join(out, rel), body);
  }
  io.out(`wrote the RIAF Claude Code plugin to ${resolve(out)} (${Object.keys(files).length} files); install it with \`/plugin\` in Claude Code`);
  return 0;
}
