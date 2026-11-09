import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { IdeStateSchema, IntentSchema, RiafError } from '@riaf/kernel';

/**
 * The eval task set: fixtures/tasks/<id>/task.yaml. Edits are exact find/replace pairs (each `find`
 * must occur exactly once), so a task is readable and verifiable without patch tooling. `setup` puts
 * the repository in the task's starting state; `gold` is the reference solution; `hidden` tests are
 * added after the agent finishes and must fail after setup and pass after gold.
 */

const EditSchema = z.union([
  z.object({ path: z.string().min(1), find: z.string().min(1), replace: z.string() }),
  z.object({ path: z.string().min(1), write: z.string() }),
]);
export type Edit = z.infer<typeof EditSchema>;

export const TEST_KINDS = ['vitest', 'pytest', 'cc', 'javac'] as const;

export const TaskSchema = z.object({
  id: z.string().regex(/^[a-z]+-\d{3}$/),
  repo: z.string().min(1),
  intent: IntentSchema,
  request: z.string().min(1),
  ide: IdeStateSchema.prefault({}),
  gold_files: z.array(z.string().min(1)).min(1),
  gold_symbols: z.array(z.string()).default([]),
  setup: z.array(EditSchema).default([]),
  gold: z.array(EditSchema).default([]),
  hidden: z.array(z.object({ path: z.string().min(1), content: z.string() })).default([]),
  test: z.object({
    kind: z.enum(TEST_KINDS),
    files: z.array(z.string().min(1)).min(1),
    sources: z.array(z.string()).optional(),
    main: z.string().optional(),
  }).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** Loads every task under `dir`, sorted by id; throws with the file name on a schema error. */
export function loadTasks(dir: string): Task[] {
  const out: Task[] = [];
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, 'task.yaml');
    if (!existsSync(file)) continue;
    const parsed = TaskSchema.safeParse(parse(readFileSync(file, 'utf8')));
    if (!parsed.success) throw new RiafError('invalid_input', `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (parsed.data.id !== id) throw new RiafError('invalid_input', `${file}: id ${parsed.data.id} does not match its directory`);
    out.push(parsed.data);
  }
  return out;
}

/** Applies edits in order under `root`; throws when a `find` is missing or ambiguous. */
export function applyEdits(root: string, edits: readonly Edit[]): void {
  for (const e of edits) {
    const abs = join(root, e.path);
    if ('write' in e) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, e.write);
      continue;
    }
    if (!existsSync(abs)) throw new RiafError('not_found', `edit target ${e.path} does not exist`);
    const text = readFileSync(abs, 'utf8');
    const first = text.indexOf(e.find);
    if (first < 0) throw new RiafError('not_found', `edit in ${e.path}: text not found: ${JSON.stringify(e.find.slice(0, 80))}`);
    if (text.indexOf(e.find, first + 1) >= 0) throw new RiafError('conflict', `edit in ${e.path}: text occurs more than once: ${JSON.stringify(e.find.slice(0, 80))}`);
    writeFileSync(abs, text.slice(0, first) + e.replace + text.slice(first + e.find.length));
  }
}

/** Writes a task's hidden tests into `root`. */
export function writeHidden(root: string, task: Task): void {
  for (const h of task.hidden) {
    const abs = join(root, h.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, h.content);
  }
}
