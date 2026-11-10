import { describe, expect, it } from 'vitest';
import { claudeCommand, shQuote, terminalLaunch } from '../src/terminal.js';

describe('starting Claude Code in a terminal', () => {
  it('always changes into the repository and quotes the prompt safely', () => {
    const cmd = claudeCommand('/work/my repo', "[RIAF pr_1] Don't $break `this`", { platform: 'darwin', claudePath: '/Users/me/.nvm/versions/node/v20/bin/claude' });
    expect(cmd).toBe(`cd '/work/my repo' && PATH='/Users/me/.nvm/versions/node/v20/bin':"$PATH" claude '[RIAF pr_1] Don'\\''t $break \`this\`'`);
    expect(claudeCommand('/r', 'x', { platform: 'linux' })).toBe("cd '/r' && claude 'x'");
    expect(claudeCommand('C:\\r', 'say "hi" 100%', { platform: 'win32' })).toBe('cd /d "C:\\r" && claude "say ""hi"" 100%%"');
    expect(shQuote("a'b")).toBe("'a'\\''b'");
  });

  it('opens Terminal (or iTerm) on macOS, a terminal emulator on Linux and cmd on Windows', () => {
    const mac = terminalLaunch('cd \'/r\' && claude "x"', 'darwin', undefined)!;
    expect(mac.file).toBe('osascript');
    expect(mac.args).toContain('tell application "Terminal"');
    expect(mac.args).toContain('do script "cd \'/r\' && claude \\"x\\""');
    expect(terminalLaunch('c', 'darwin', 'iTerm')!.args.join(' ')).toContain('tell application "iTerm"');
    expect(terminalLaunch('c', 'linux', undefined)).toEqual({ file: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', 'c; exec bash'] });
    expect(terminalLaunch('c', 'win32', undefined)!.file).toBe('cmd.exe');
  });
});
