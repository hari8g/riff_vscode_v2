import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { launchMessage, writeLaunchFile } from '../src/runs.js';
import { innerScript, launcherScript, shellCommand, shQuote, terminalApp, vscodeTerminal } from '../src/terminal.js';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-term-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// A repository whose path needs quoting, and a prompt full of characters shells mangle.
const root = join(tmp, "my repo's \"tracker\"");
mkdirSync(root, { recursive: true });
const rec = { promptId: 'pr_abc123def456', task: "Build a feature: don't break $HOME `pwd` — keep \"quotes\" & ünïcödé" };
const prompt = '# RIAF agent prompt\n\n## Task\n> it\'s a "test" with $VARS, `ticks`, \\backslashes\\ and\n\nnew lines\n';

/** A stand-in `claude` that records its first argument and where it was started. */
function fakeClaude(): { bin: string; out: string } {
  const dir = join(tmp, 'bin');
  mkdirSync(dir, { recursive: true });
  const out = join(tmp, 'received');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$1" > ${shQuote(out)}\npwd > ${shQuote(`${out}.cwd`)}\n`);
  chmodSync(bin, 0o755);
  return { bin, out };
}

describe('handing a prompt to Claude Code', () => {
  it('writes a launch file with the marker, the task and the whole prompt', () => {
    const lf = writeLaunchFile(root, rec, prompt);
    expect(lf.relative).toBe('.riaf/prompts/pr_abc123def456.launch.md');
    expect(readFileSync(lf.file, 'utf8')).toBe(launchMessage(rec, prompt));
    expect(lf.message.startsWith('[RIAF pr_abc123def456] Build a feature')).toBe(true);
    expect(lf.message).toContain('## Task');
  });

  it('starts Claude Code in the repository with the prompt delivered byte for byte (no typing, no quoting loss)', () => {
    const lf = writeLaunchFile(root, rec, prompt);
    const { bin, out } = fakeClaude();
    const spec = { root, promptId: rec.promptId, file: lf.file, relative: lf.relative };
    // the same script VS Code's terminal and the macOS / Linux launcher run; SHELL=true ends the trailing login shell at once
    execFileSync('/bin/sh', ['-c', innerScript(spec, bin)], { env: { PATH: '/usr/bin:/bin', SHELL: '/usr/bin/true' } });
    expect(readFileSync(out, 'utf8')).toBe(lf.message.replace(/\n+$/, ''));
    expect(readFileSync(`${out}.cwd`, 'utf8').trim()).toBe(root);
  });

  it('runs the same way from the generated launcher script and from the copyable shell command', () => {
    const lf = writeLaunchFile(root, rec, prompt);
    const { bin, out } = fakeClaude();
    const spec = { root, promptId: rec.promptId, file: lf.file, relative: lf.relative };
    const script = join(tmp, 'launch.command');
    writeFileSync(script, launcherScript(spec, bin, '/bin/sh'));
    chmodSync(script, 0o755);
    rmSync(out, { force: true });
    execFileSync(script, [], { env: { PATH: '/usr/bin:/bin', SHELL: '/usr/bin/true' }, stdio: 'ignore' });
    expect(readFileSync(out, 'utf8')).toBe(lf.message.replace(/\n+$/, ''));

    rmSync(out, { force: true });
    execFileSync('/bin/sh', ['-c', shellCommand(spec, 'darwin')], { env: { PATH: `${join(tmp, 'bin')}:/usr/bin:/bin` }, cwd: tmp });
    expect(readFileSync(out, 'utf8')).toBe(lf.message.replace(/\n+$/, ''));
    expect(shellCommand(spec, 'darwin')).toBe(`cd ${shQuote(root)} && claude "$(cat '.riaf/prompts/pr_abc123def456.launch.md')"`);
  });

  it('makes Claude Code the VS Code terminal process and opens terminal apps on the script', () => {
    const spec = { root, promptId: rec.promptId, file: join(root, '.riaf/prompts/x.launch.md'), relative: '.riaf/prompts/x.launch.md' };
    // claude found: straight from /bin/sh (no slow profile load first)
    const t = vscodeTerminal(spec, '/opt/bin/claude', '/bin/zsh', 'darwin');
    expect(t).toMatchObject({ name: 'Claude Code · pr_abc123def456', cwd: root, shellPath: '/bin/sh' });
    expect(t.shellArgs[0]).toBe('-c');
    expect(t.shellArgs[1]).toContain(`export PATH='/opt/bin':"$PATH"; claude "$(cat `);
    // claude not found from the editor's environment: a login shell that can find it
    const slow = vscodeTerminal(spec, undefined, '/bin/zsh', 'darwin');
    expect(slow.shellPath).toBe('/bin/zsh');
    expect(slow.shellArgs.slice(0, 3)).toEqual(['-l', '-i', '-c']);
    expect(launcherScript(spec, '/opt/bin/claude').split('\n')[2]).toMatch(/^cd /);
    expect(launcherScript(spec, undefined, '/bin/zsh').split('\n')[2]).toMatch(/^exec '\/bin\/zsh' -l -i -c 'cd /);
    expect(vscodeTerminal(spec, undefined, 'x', 'win32').shellPath).toBe('powershell.exe');
    const mac = terminalApp("/r/it's x.command", 'darwin', undefined);
    expect(mac.file).toBe('osascript');
    // opens an empty window, waits for its shell, then runs the launcher in it
    expect(mac.args).toContain('set t to do script ""');
    expect(mac.args).toContain('tell application "Terminal" to do script (item 1 of argv) in t');
    expect(mac.args.at(-1)).toBe(`exec '/r/it'\\''s x.command'`);
    expect(terminalApp('/r/x.command', 'darwin', 'iTerm').args).toContain('create window with default profile command (item 1 of argv)');
    expect(terminalApp('/r/x.sh', 'linux', undefined)).toEqual({ file: 'x-terminal-emulator', args: ['-e', '/r/x.sh'] });
  });
});
