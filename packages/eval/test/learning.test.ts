import { describe, expect, it } from 'vitest';
import { simulateLearning } from '../src/runners/simulated.js';
import { loadTasks } from '../src/tasks.js';
import { availableToolchains } from '../src/testrun.js';
import { defaultPaths } from '../src/workspace.js';

const paths = defaultPaths(__dirname);
const tools = availableToolchains();

describe('M5 learning loop (offline simulation)', () => {
  it.skipIf(!tools.vitest || !tools.pytest || !tools.cc || !tools.javac)('distils skills from passing sessions and reuses them in at least 3 of 30 tasks', async () => {
    const sessions = await simulateLearning(loadTasks(paths.tasks), paths);
    expect(sessions).toHaveLength(30);
    const passed = sessions.filter((s) => s.passed).length;
    const reused = sessions.filter((s) => s.skillsInPack.length > 0).map((s) => s.taskId);
    if (process.env.RIAF_CALIBRATE) console.log({ passed, reused, distilled: sessions.reduce((a, s) => a + s.skillsDistilled, 0) });
    expect(passed).toBe(27); // every task with tests passes after its gold edit
    expect(reused.length).toBeGreaterThanOrEqual(3);
  }, 600_000);
});
