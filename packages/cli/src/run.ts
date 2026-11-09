import { RiafError } from '@riaf/kernel';
import { parseArgs } from './args.js';
import { cmdDoctor, cmdImpact, cmdIndex, cmdJump, cmdServe, cmdStatus } from './commands/index.js';
import { cmdEval } from './commands/eval.js';
import { cmdInit, cmdMcp, cmdPack, cmdRunbook, cmdWiki } from './commands/m3.js';
import type { Io } from './io.js';

export const CLI_VERSION = '0.3.0';

const BOOLEANS = new Set(['json', 'full', 'in-process', 'lsp', 'detached', 'watch', 'poll', 'help', 'version', 'quiet', 'write', 'force', 'interactive', 'golden', 'approve-golden']);

export const USAGE = `riaf ${CLI_VERSION} — repository intelligence for frontier models

usage: riaf <command> [options]

commands:
  index [--full] [--stages a,b]     index the repository (incremental by default)
  status                            index health and stage progress
  jump <symbol|Name.member|path:line>   definition and references
  impact <symbol>... [--hops N]     dependents, tests and co-change partners
  pack "<request>" [--budget N] [--render claude|copilot|fragment|json|agentsmd] [--intent X]
                                    compile a context pack for a task
  wiki [node]                       repository structure, or one directory / file page
  runbook [--write]                 print or regenerate .riaf/runbook.md
  init [--host claude|copilot|both] write .riaf/, the run-book, CLAUDE.md/AGENTS.md import, MCP config
  mcp [--http PORT]                 serve the RIAF MCP tools (stdio for Claude Code)
  doctor                            check environment, grammars, index, policies, LSP servers
  serve [--detached] [--lsp]        run the repository daemon in the foreground
  eval [--runner scripted,compiler,claude] [--golden|--approve-golden]
                                    run the eval task set (reports/eval/report.{md,json}) or check golden packs

global options:
  --root <dir>      repository root (default: nearest ancestor with .git or .riaf)
  --in-process      do not use the daemon; open the index in this process
  --json            machine-readable output
`;

type Command = (p: ReturnType<typeof parseArgs>, io: Io) => Promise<number>;
const COMMANDS: Record<string, Command> = { index: cmdIndex, status: cmdStatus, jump: cmdJump, impact: cmdImpact, doctor: cmdDoctor, serve: cmdServe, eval: cmdEval, pack: cmdPack, wiki: cmdWiki, runbook: cmdRunbook, init: cmdInit, mcp: cmdMcp };

/** Runs the CLI with `argv` (without node and script) and returns the exit code. */
export async function runCli(argv: readonly string[], io: Io): Promise<number> {
  const p = parseArgs(argv, BOOLEANS);
  if (p.flags.get('version')) {
    io.out(CLI_VERSION);
    return 0;
  }
  if (!p.command || p.flags.get('help') || p.command === 'help') {
    io.out(USAGE);
    return p.command || p.flags.get('help') ? 0 : 2;
  }
  const cmd = COMMANDS[p.command];
  if (!cmd) {
    io.err(`unknown command: ${p.command}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await cmd(p, io);
  } catch (e) {
    io.err(e instanceof RiafError ? `riaf: ${e.message} [${e.code}]` : `riaf: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
