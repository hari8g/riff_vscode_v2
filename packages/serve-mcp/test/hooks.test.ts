import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '@riaf/daemon';
import { hookScript, hooksConfig, pluginFiles } from '../src/hooks.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-hooks-')));
cpSync(resolve(__dirname, '../../../fixtures/repos/toll-ts'), root, { recursive: true });
const script = join(root, 'riaf-hook.mjs');
let daemon: DaemonHandle;
beforeAll(async () => {
  writeFileSync(script, hookScript());
  daemon = await startDaemon({ root, watch: false, persistDebounceMs: 50 });
  await daemon.ready;
}, 60_000);
afterAll(async () => {
  await daemon.stop();
  rmSync(root, { recursive: true, force: true });
});

// the daemon runs in this process, so the hook must be spawned asynchronously (spawnSync would deadlock)
const hook = (event: string, input: Record<string, unknown>, cwd = root): Promise<any> => new Promise((resolveHook, reject) => {
  const child = spawn(process.execPath, [script, event], { env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.on('error', reject);
  child.on('close', (code) => {
    expect(code).toBe(0);
    resolveHook(out ? JSON.parse(out) : undefined);
  });
  child.stdin.end(JSON.stringify({ cwd, session_id: 'cc-1', ...input }));
});

describe('Claude Code hook script against a live daemon', () => {
  it('injects a pack on the first prompt and a short note while the task stays the same', async () => {
    const first = await hook('prompt', { prompt: 'Fix ReadingDeduper.accept: it keeps the blurrier read' });
    expect(first.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(first.hookSpecificOutput.additionalContext).toMatch(/^# RIAF agent prompt · pack pk-/);
    const index = readFileSync(join(root, '.riaf/prompts/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(index[0]).toMatchObject({ source: 'hook', task: 'Fix ReadingDeduper.accept: it keeps the blurrier read', host: 'claude' });
    expect(index[0].sessionId).toBeTruthy();
    expect(readFileSync(join(root, '.riaf/prompts', `${index[0].promptId}.md`), 'utf8')).toBe(first.hookSpecificOutput.additionalContext);
    const again = await hook('prompt', { prompt: 'also fix the dedupe window bug please' });
    expect(again.hookSpecificOutput.additionalContext).toMatch(/^RIAF: same task \(bugfix\)/);
  });

  it('links a session that starts with a console-exported prompt instead of compiling it again', async () => {
    const out = await hook('prompt', { session_id: 'cc-export', prompt: '[RIAF pr_abc123def456] Add a monthly pass discount\n\n# RIAF agent prompt · pack pk-1\n…' });
    expect(out).toBeUndefined();
    const lines = readFileSync(join(root, '.riaf/prompts/index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.at(-1)).toEqual({ promptId: 'pr_abc123def456', sessionId: 'cc-export' });
  });

  it('serves grep from the index, stays silent on ordinary calls, records results, and ends the session', async () => {
    const pre = await hook('pre', { tool_name: 'Grep', tool_input: { pattern: 'charge-on-close' } });
    expect(pre.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(pre.hookSpecificOutput.permissionDecisionReason).toMatch(/answered this search from its index/);
    expect(await hook('pre', { tool_name: 'Read', tool_input: { file_path: join(root, 'src/gantry/dedupe.ts') } })).toBeUndefined();
    expect(await hook('post', { tool_name: 'Read', tool_input: { file_path: join(root, 'src/gantry/dedupe.ts') }, tool_response: { file: { content: 'export class ReadingDeduper {}' } } })).toBeUndefined();
    expect(await hook('stop', {})).toBeUndefined();
    const t = await daemon.core.call('telemetry.query', {});
    expect(t.sessions).toBeGreaterThanOrEqual(1);
    expect(t.toolCalls.byDecision['serve:index']).toBeGreaterThanOrEqual(1);
    expect(daemon.core.store.govern.session('cc-1')?.endedAt).toBeDefined();
  });

  it('fails open when no daemon is reachable', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-hooks-none-')));
    try {
      expect(await hook('pre', { tool_name: 'Grep', tool_input: { pattern: 'x' } }, empty)).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('generates settings and an installable plugin bundle', () => {
    const cfg = hooksConfig('node hook.mjs') as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    expect(Object.keys(cfg)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    expect(cfg['PreToolUse']![0]!.matcher).toBe('Grep|Glob|Read|Bash');
    const files = pluginFiles({ version: '0.4.0', cliPath: '/x/riaf.js', commands: { 'riaf-pack.md': 'x' } });
    expect(Object.keys(files).sort()).toEqual(['.claude-plugin/plugin.json', '.mcp.json', 'commands/riaf-pack.md', 'hooks/hooks.json', 'hooks/riaf-hook.mjs']);
    expect(JSON.parse(files['hooks/hooks.json']!).hooks.Stop[0].hooks[0].command).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(existsSync(script) && readFileSync(script, 'utf8').includes("permissionDecision: 'deny'")).toBe(true);
    expect(readFileSync(script, 'utf8')).not.toMatch(/permissionDecision: 'allow'/);
  });
});
