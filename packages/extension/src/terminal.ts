import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Starts Claude Code in a terminal, in the repository, with a RIAF prompt as its first message.
 *
 * Nothing is ever *typed* into a terminal. Typing (VS Code's `sendText`, or pasting) lands in whatever is
 * running there; when that was already a Claude Code session, Claude received the shell command itself as
 * its task. Instead, Claude Code is started as the terminal's own process (VS Code), or a terminal app
 * runs a generated launcher script (macOS / Linux), and the prompt is read from the launch file
 * `.riaf/prompts/<id>.launch.md` with `$(cat …)`, so no prompt text ever passes through shell quoting.
 */

export type Platform = 'darwin' | 'linux' | 'win32';

export interface LaunchSpec {
  /** Repository root: Claude Code works here and logs its session under it. */
  root: string;
  promptId: string;
  /** Absolute path of the launch file (marker, task and the full prompt). */
  file: string;
  /** The launch file relative to `root`, for the copyable command. */
  relative: string;
}

export interface LaunchResult {
  launched: boolean;
  /** How it was started, in words, for the console. */
  how?: string;
  /** A shell command that does the same, for copying into a shell. */
  command: string;
  reason?: string;
}

/** POSIX shell single-quoting. */
export const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** The command a person can paste into a shell (not into Claude Code). */
export function shellCommand(spec: Pick<LaunchSpec, 'root' | 'relative'>, platform: Platform = process.platform as Platform): string {
  if (platform === 'win32') return `cd /d "${spec.root}" && powershell -NoProfile -Command "claude (Get-Content -Raw '${spec.relative.replace(/\//g, '\\')}')"`;
  return `cd ${shQuote(spec.root)} && claude "$(cat ${shQuote(spec.relative)})"`;
}

/**
 * What the terminal runs: change into the repository, start Claude Code on the launch file, then leave a
 * normal login shell open when it exits. When the `claude` path is known it runs straight from `/bin/sh`
 * with Claude Code's folder first on PATH (nvm and Homebrew keep `node` beside it), so the user's shell
 * profile is not loaded first: new terminal windows can take a long time to start a login shell.
 */
export function innerScript(spec: Pick<LaunchSpec, 'root' | 'file'>, claudePath?: string): string {
  const path = claudePath ? `export PATH=${shQuote(dirname(claudePath))}:"$PATH"; ` : '';
  return `cd ${shQuote(spec.root)} || exit 1; ${path}claude "$(cat ${shQuote(spec.file)})"; exec "\${SHELL:-/bin/zsh}" -l`;
}

/** The user's login shell. */
export const loginShell = () => process.env['SHELL'] || '/bin/zsh';

/** The program and arguments that run `innerScript`: plain `/bin/sh` when `claude` was found, else a login shell that can find it. */
function runner(spec: LaunchSpec, claudePath: string | undefined, shell: string): { shellPath: string; shellArgs: string[] } {
  return claudePath ? { shellPath: '/bin/sh', shellArgs: ['-c', innerScript(spec, claudePath)] } : { shellPath: shell, shellArgs: ['-l', '-i', '-c', innerScript(spec)] };
}

/** VS Code terminal options that run Claude Code as the terminal's process (no `sendText`). */
export function vscodeTerminal(spec: LaunchSpec, claudePath?: string, shell = loginShell(), platform: Platform = process.platform as Platform): { name: string; cwd: string; shellPath: string; shellArgs: string[] } {
  const name = `Claude Code · ${spec.promptId}`;
  if (platform === 'win32') return { name, cwd: spec.root, shellPath: 'powershell.exe', shellArgs: ['-NoExit', '-Command', `claude (Get-Content -Raw -LiteralPath '${spec.file.replace(/'/g, "''")}')`] };
  return { name, cwd: spec.root, ...runner(spec, claudePath, shell) };
}

/** An executable launcher script (macOS / Linux) for a terminal app to run. */
export function launcherScript(spec: LaunchSpec, claudePath?: string, shell = loginShell()): string {
  const r = runner(spec, claudePath, shell);
  return [
    '#!/bin/sh',
    `# RIAF: start Claude Code on prompt ${spec.promptId} in ${spec.root}`,
    r.shellPath === '/bin/sh' ? innerScript(spec, claudePath) : `exec ${shQuote(r.shellPath)} ${r.shellArgs.slice(0, -1).join(' ')} ${shQuote(r.shellArgs.at(-1)!)}`,
    '',
  ].join('\n');
}

/** Absolute path of the `claude` CLI: from PATH, else as the login shell sees it (GUI apps often lack nvm's PATH). */
export function resolveClaude(platform: Platform = process.platform as Platform): string | undefined {
  const direct = spawnSync(platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const first = direct.status === 0 ? direct.stdout.split(/\r?\n/)[0]?.trim() : '';
  if (first) return first;
  if (platform === 'win32') return undefined;
  const viaShell = spawnSync(loginShell(), ['-l', '-i', '-c', 'command -v claude'], { encoding: 'utf8', timeout: 8000 });
  const found = viaShell.status === 0 ? viaShell.stdout.trim().split(/\r?\n/).pop()?.trim() : '';
  return found && found.startsWith('/') ? found : undefined;
}

/**
 * Terminal.app: open an empty window, wait until its login shell has started (the tab is not busy and its
 * contents have settled), and only then run the launcher in it. Text sent while the shell is still
 * starting can be swallowed by shell start-up (zsh plugins flush pending input), which is how a command
 * got lost. The script path arrives as an argument, so nothing needs AppleScript escaping.
 */
export const TERMINAL_APPLESCRIPT = [
  'on run argv',
  'tell application "Terminal"',
  'activate',
  'set t to do script ""',
  'end tell',
  'set prev to ""',
  'set steady to 0',
  'repeat 450 times',
  'delay 0.2',
  'tell application "Terminal"',
  'set b to busy of t',
  'set c to contents of t',
  'end tell',
  'if (not b) and c is not "" and c is prev then',
  'set steady to steady + 1',
  'if steady is greater than 3 then exit repeat',
  'else',
  'set steady to 0',
  'end if',
  'set prev to c',
  'end repeat',
  'tell application "Terminal" to do script (item 1 of argv) in t',
  'end run',
];

/** iTerm: the window's own command runs the launcher as its process (no typing at all). */
export const ITERM_APPLESCRIPT = [
  'on run argv',
  'tell application "iTerm"',
  'activate',
  'create window with default profile command (item 1 of argv)',
  'end tell',
  'end run',
];

const osa = (lines: readonly string[]) => lines.flatMap((l) => ['-e', l]);

/** How to open a terminal app on a launcher script, per platform. */
export function terminalApp(script: string, platform: Platform, app = process.env['RIAF_TERMINAL']): { file: string; args: string[] } {
  if (platform === 'darwin') {
    if (app === 'iTerm' || app === 'iTerm2') return { file: 'osascript', args: [...osa(ITERM_APPLESCRIPT), `/bin/sh ${shQuote(script)}`] };
    return { file: 'osascript', args: [...osa(TERMINAL_APPLESCRIPT), `exec ${shQuote(script)}`] };
  }
  if (platform === 'linux') return { file: app || 'x-terminal-emulator', args: ['-e', script] };
  return { file: 'cmd.exe', args: ['/c', 'start', '"Claude Code"', 'powershell', '-NoExit', '-File', script] };
}

/** Opens a terminal window running Claude Code on the launch file (browser console, CLI). Never throws. */
export async function openClaudeTerminal(spec: LaunchSpec, platform: Platform = process.platform as Platform): Promise<LaunchResult> {
  const command = shellCommand(spec, platform);
  const claudePath = resolveClaude(platform);
  if (!claudePath) return { launched: false, command, reason: 'Claude Code (the `claude` command) was not found on this machine' };
  let script: string;
  try {
    if (platform === 'win32') {
      script = spec.file.replace(/\.launch\.md$/, '.launch.ps1');
      writeFileSync(script, `Set-Location -LiteralPath '${spec.root.replace(/'/g, "''")}'\nclaude (Get-Content -Raw -LiteralPath '${spec.file.replace(/'/g, "''")}')\n`);
    } else {
      script = spec.file.replace(/\.launch\.md$/, platform === 'darwin' ? '.command' : '.sh');
      writeFileSync(script, launcherScript(spec, claudePath));
      chmodSync(script, 0o755);
    }
  } catch (e) {
    return { launched: false, command, reason: `could not write the launcher: ${(e as Error).message}` };
  }
  const how = terminalApp(script, platform);
  return new Promise((done) => {
    try {
      const child = spawn(how.file, how.args, { detached: true, stdio: 'ignore' });
      child.once('error', (e) => done({ launched: false, command, reason: e.message }));
      child.once('spawn', () => { child.unref(); done({ launched: true, command, how: platform === 'darwin' ? `a new ${process.env['RIAF_TERMINAL'] || 'Terminal'} window` : 'a new terminal window' }); });
    } catch (e) {
      done({ launched: false, command, reason: (e as Error).message });
    }
  });
}
