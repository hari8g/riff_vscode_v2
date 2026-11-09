import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeFixtureHistory } from '../src/fixtureHistory.js';

const FIX = resolve(__dirname, '../../../fixtures/repos');
const tmp = mkdtempSync(join(tmpdir(), 'riaf-hist-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('makeFixtureHistory', () => {
  for (const name of ['toll-ts', 'fleet-java', 'telemetry-py', 'embedded-c']) {
    it(`${name}: 200 deterministic commits ending at the fixture tree with known bugs, reverts, reformat and co-change`, () => {
      const out = join(tmp, name);
      const m = makeFixtureHistory(join(FIX, name), out);
      expect(m.commits).toHaveLength(200);
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
        const again = makeFixtureHistory(join(FIX, name), join(tmp, `${name}-2`));
        expect(again.head).toBe(m.head);
      }
    });
  }
});
