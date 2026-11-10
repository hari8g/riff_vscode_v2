import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { HistoryManifest } from '../src/fixtureHistory.js';

const REPO = resolve(__dirname, '../../..');
/**
 * Builds a history in a child process: makeFixtureHistory runs ~200 synchronous git commands, and doing
 * that inside the test worker blocks its event loop long enough to trip Vitest's worker RPC timeout.
 */
const generate = async (name: string, out: string) =>
  JSON.parse((await promisify(execFile)(process.execPath, [join(REPO, 'tooling/scripts/make-fixture-history.mjs'), name, out], { maxBuffer: 16 * 1024 * 1024 })).stdout) as Omit<HistoryManifest, 'commits'> & { commits: number };
const tmp = mkdtempSync(join(tmpdir(), 'riaf-hist-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('makeFixtureHistory', () => {
  for (const name of ['toll-ts', 'fleet-java', 'telemetry-py', 'embedded-c']) {
    it(`${name}: 200 deterministic commits ending at the fixture tree with known bugs, reverts, reformat and co-change`, async () => {
      const out = join(tmp, name);
      const m = await generate(name, out);
      expect(m.commits).toBe(200);
      const git = (...a: string[]) => execFileSync('git', a, { cwd: out, encoding: 'utf8' }).trim();
      expect(git('rev-list', '--count', 'HEAD')).toBe('200');
      expect(git('status', '--porcelain')).toBe('');
      expect(m.bugs.length).toBeGreaterThanOrEqual(2);
      expect(m.reverts).toHaveLength(1);
      expect(git('log', '-1', '--format=%B', m.reverts[0]!.revert)).toContain(`This reverts commit ${m.reverts[0]!.commit}.`);
      expect(m.reformat).toMatch(/^[0-9a-f]{40}$/);
      expect(Number(git('show', '--numstat', '--format=', m.reformat).split('\n').length)).toBeGreaterThan(2);
      expect(m.cochange[0]!.commits).toHaveLength(6);
      for (const b of m.bugs) {
        // the fix commit touched exactly the bug line
        expect(git('show', '--format=', '--unified=0', b.fix)).toMatch(new RegExp(`@@ -${b.line}(,1)? \\+${b.line}(,1)? @@`));
      }
      if (name === 'telemetry-py') {
        // deterministic: same input → same commit ids
        const again = await generate(name, join(tmp, `${name}-2`));
        expect(again.head).toBe(m.head);
      }
    });
  }
});
