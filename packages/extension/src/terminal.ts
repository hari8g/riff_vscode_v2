import { spawn, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

/**
 * Starts Claude Code in a real terminal, in the repository, with a RIAF prompt — so it starts
 * working at once and the console can follow the session it writes.
 *
 * The command always changes into the repository first: Claude Code works on the folder it is started
 * in, finds `.riaf/prompts/<id>.md` there, and logs its session under that folder, which is how the
 * console links the run back to the prompt.
 */

export type Platform = 'darwin' | 'linux' | 'win32';

/** POSIX shell single-quoting. */
export const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
/** cmd.exe double-quoting (inner quotes doubled, % escaped). */
const cmdQuote = (s: string) => `"${s.replace(/"/g, '""').replace(/%/g, '%%')}"`;

/**
 * The command that runs Claude Code on `text` inside `root`. `claudePath`, when known, puts its folder
 * first on PATH so a terminal that has not loaded the user's shell profile still finds it (and the
 * Node it runs on, which nvm and Homebrew install next to it).
 */
export function claudeCommand(root: string, text: string, opts: { platform?: Platform; claudePath?: string } = {}): string {
  const platform = opts.platform ?? (process.platform as Platform);
  if (platform === 'win32') return `cd /d ${cmdQuote(root)} && claude ${cmdQuote(text)}`;
  const path = opts.claudePath ? `PATH=${shQuote(dirname(opts.claudePath))}:"$PATH" ` : '';
  return `cd ${shQuote(root)} && ${path}claude ${shQuote(text)}`;
}

/** AppleScript string literal. */
const asString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** How to open a new terminal window running `command`, per platform (`undefined` where none is known). */
export function terminalLaunch(command: string, platform: Platform = process.platform as Platform, app = process.env['RIAF_TERMINAL']): { file: string; args: string[] } | undefined {
  switch (platform) {
    case 'darwin':
      if (app === 'iTerm' || app === 'iTerm2') {
        return { file: 'osascript', args: ['-e', 'tell application "iTerm"', '-e', 'activate', '-e', 'set w to (create window with default profile)', '-e', `tell current session of w to write text ${asString(command)}`, '-e', 'end tell'] };
      }
      return { file: 'osascript', args: ['-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${asString(command)}`, '-e', 'end tell'] };
    case 'linux':
      return { file: app || 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${command}; exec bash`] };
    case 'win32':
      return { file: 'cmd.exe', args: ['/c', 'start', '"Claude Code (RIAF)"', 'cmd', '/k', command] };
    default:
      return undefined;
  }
}

/** Absolute path of the `claude` CLI on this machine's PATH, if installed. */
export function findClaude(platform: Platform = process.platform as Platform): string | undefined {
  const r = spawnSync(platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const p = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : '';
  return p || undefined;
}

export interface LaunchResult {
  launched: boolean;
  /** The command, for copying when no terminal could be opened. */
  command: string;
  reason?: string;
}

/** Opens a terminal window in `root` running Claude Code on `text`. Never throws. */
export async function openClaudeTerminal(root: string, text: string, platform: Platform = process.platform as Platform): Promise<LaunchResult> {
  const claudePath = findClaude(platform);
  const command = claudeCommand(root, text, { platform, ...(claudePath ? { claudePath } : {}) });
  if (!claudePath) return { launched: false, command, reason: 'Claude Code (the `claude` command) is not installed or not on PATH' };
  const how = terminalLaunch(command, platform);
  if (!how) return { launched: false, command, reason: `no terminal launcher for ${platform}` };
  return new Promise((done) => {
    try {
      const child = spawn(how.file, how.args, { detached: true, stdio: 'ignore', ...(platform === 'win32' ? { shell: false, windowsVerbatimArguments: true } : {}) });
      child.once('error', (e) => done({ launched: false, command, reason: e.message }));
      child.once('spawn', () => { child.unref(); done({ launched: true, command }); });
    } catch (e) {
      done({ launched: false, command, reason: (e as Error).message });
    }
  });
}
