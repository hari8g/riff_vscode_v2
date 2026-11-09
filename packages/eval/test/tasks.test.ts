import { afterAll, describe, expect, it } from 'vitest';
import { applyEdits, loadTasks, writeHidden } from '../src/tasks.js';
import { availableToolchains, runTaskTests } from '../src/testrun.js';
import { defaultPaths, prepareWorkspace, type Workspace } from '../src/workspace.js';

const paths = defaultPaths(__dirname);
const tasks = loadTasks(paths.tasks);
const tools = availableToolchains();
const spaces: Workspace[] = [];
afterAll(() => spaces.forEach((w) => w.dispose()));

describe('task set', () => {
  it('has 30 valid tasks over the four fixture repos with every intent family represented', () => {
    expect(tasks).toHaveLength(30);
    expect(new Set(tasks.map((t) => t.repo))).toEqual(new Set(['toll-ts', 'fleet-java', 'telemetry-py', 'embedded-c']));
    expect(new Set(tasks.map((t) => t.intent))).toEqual(new Set(['bugfix', 'feature', 'refactor', 'onboarding']));
    for (const t of tasks) if (t.intent !== 'onboarding') expect(t.test, t.id).toBeDefined();
  });
});

describe('every task: hidden tests fail after setup and pass after gold', () => {
  for (const t of tasks.filter((x) => x.test)) {
    const kind = t.test!.kind;
    it.skipIf(!tools[kind])(`${t.id} (${kind})`, () => {
      const ws = prepareWorkspace(t, paths, { git: false });
      spaces.push(ws);
      writeHidden(ws.root, t);
      const before = runTaskTests(t, ws.root, paths);
      expect(before.passed, `${t.id} should fail before gold:\n${before.output}`).toBe(false);
      applyEdits(ws.root, t.gold);
      const after = runTaskTests(t, ws.root, paths);
      expect(after.passed, `${t.id} should pass after gold:\n${after.command}\n${after.output}`).toBe(true);
    }, 120_000);
  }
});
