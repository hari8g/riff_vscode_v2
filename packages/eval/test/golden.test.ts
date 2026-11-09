import { describe, expect, it } from 'vitest';
import { checkGolden } from '../src/golden.js';
import { compileTaskPack, GOLDEN_TASKS } from '../src/runners/compiler.js';
import { loadTasks } from '../src/tasks.js';
import { defaultPaths } from '../src/workspace.js';

const paths = defaultPaths(__dirname);
const tasks = loadTasks(paths.tasks);
const approve = process.env.RIAF_APPROVE_GOLDEN === '1';

// Golden packs pin the compiler's output for 12 (repo, task) pairs. A diff here means compiler
// behaviour changed: re-approve with `RIAF_APPROVE_GOLDEN=1 pnpm vitest run packages/eval/test/golden.test.ts`
// (or `riaf eval --approve-golden`) and say why in the commit.
describe('golden packs', () => {
  for (const id of GOLDEN_TASKS) {
    it(`${id} is byte-stable`, async () => {
      const pack = await compileTaskPack(tasks.find((t) => t.id === id)!, { paths });
      const d = checkGolden(paths.goldenPacks, id, pack, approve);
      expect(d.status === 'same' || approve, `${id} drifted:\n${d.diff.join('\n')}`).toBe(true);
    }, 60_000);
  }
});
