import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { LanguageFamily } from '../languages.js';
import { LspClient } from './client.js';

/**
 * Knows how to find the common language servers on the machine. M1 ships detection only (no bundled
 * servers); `riaf doctor` reports which ones are missing.
 */

export interface LspServerSpec {
  family: LanguageFamily;
  languageId: string;
  /** Candidate executables, first found wins. */
  commands: readonly string[];
  args: readonly string[];
  install: string;
}

export const LSP_SERVERS: readonly LspServerSpec[] = [
  { family: 'ts', languageId: 'typescript', commands: ['typescript-language-server'], args: ['--stdio'], install: 'npm i -g typescript typescript-language-server' },
  { family: 'python', languageId: 'python', commands: ['pyright-langserver', 'pylsp'], args: ['--stdio'], install: 'npm i -g pyright' },
  { family: 'java', languageId: 'java', commands: ['jdtls'], args: [], install: 'install Eclipse JDT LS and put jdtls on PATH' },
  { family: 'go', languageId: 'go', commands: ['gopls'], args: [], install: 'go install golang.org/x/tools/gopls@latest' },
  { family: 'c', languageId: 'cpp', commands: ['clangd'], args: [], install: 'install clangd (LLVM)' },
  { family: 'csharp', languageId: 'csharp', commands: ['csharp-ls', 'OmniSharp'], args: [], install: 'dotnet tool install -g csharp-ls' },
];

/** Finds an executable on PATH (with PATHEXT on Windows). */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

export interface DetectedServer {
  spec: LspServerSpec;
  command?: string;
}

/** Reports, per language family, which server executable is available. */
export function detectServers(env: NodeJS.ProcessEnv = process.env): DetectedServer[] {
  return LSP_SERVERS.map((spec) => {
    const command = spec.commands.map((c) => which(c, env)).find((p) => p !== undefined);
    return command ? { spec, command } : { spec };
  });
}

/** Creates a client for `family` when its server is installed. */
export function clientFor(family: LanguageFamily, root: string, env: NodeJS.ProcessEnv = process.env): LspClient | undefined {
  const d = detectServers(env).find((s) => s.spec.family === family);
  if (!d?.command) return undefined;
  return new LspClient({ command: d.command, args: d.spec.args, languageId: d.spec.languageId, root, env });
}
