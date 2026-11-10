import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TokenSettingsSchema } from '@riaf/kernel';
import { parse } from 'yaml';
import { memoryIo } from '../src/io.js';
import { runCli } from '../src/run.js';

const REPO = resolve(__dirname, '../../..');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'riaf-cli-prompt-')));
cpSync(join(REPO, 'fixtures/repos/toll-ts'), root, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('riaf prompt and tokens.yaml', () => {
  it('init writes valid token settings', async () => {
    expect(await runCli(['init', '--host', 'claude', '--in-process', '--command', 'riaf', '--no-hooks'], memoryIo(root))).toBe(0);
    expect(existsSync(join(root, '.riaf/tokens.yaml'))).toBe(true);
    expect(TokenSettingsSchema.safeParse(parse(readFileSync(join(root, '.riaf/tokens.yaml'), 'utf8'))).success).toBe(true);
  });

  it('prints the detailed agent prompt, its token plan, or JSON', async () => {
    const io = memoryIo(root);
    expect(await runCli(['prompt', 'Fix ReadingDeduper.accept: it keeps the blurrier read', '--in-process'], io)).toBe(0);
    const text = io.stdout.join('\n');
    expect(text).toMatch(/^# RIAF agent prompt · pack pk-/);
    for (const h of ['## Task', '## Plan', '## Token and tool budget', '## Context pack', '## Before you finish']) expect(text).toContain(h);
    expect(io.stderr.join('\n')).toMatch(/^prompt pr_\w+: \d+ tokens, headroom \d+/);

    const plan = memoryIo(root);
    expect(await runCli(['prompt', 'Fix ReadingDeduper.accept: it keeps the blurrier read', '--in-process', '--plan', '--quiet', '--host', 'copilot'], plan)).toBe(0);
    expect(plan.stdout[0]).toMatch(/^model claude-sonnet: window 200000, usable 170000/);
    expect(plan.stdout.join('\n')).toMatch(/\[cache\] How to work in this repository/);

    const json = memoryIo(root);
    expect(await runCli(['prompt', 'Add a GET /disputes/next endpoint', '--in-process', '--json'], json)).toBe(0);
    expect(JSON.parse(json.stdout.join('\n')).plan.planGate).toBe(true);
    expect(await runCli(['prompt', '--in-process'], memoryIo(root))).toBe(2);
  });
});
