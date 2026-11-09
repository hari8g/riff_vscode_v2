import { hashWith, type ToolCall } from '@riaf/kernel';

/** Tool-call normalisation: one stable key per semantically identical call. */

/** Repo-relative path from an absolute or relative tool argument. */
export function relPath(root: string, p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined;
  const r = root.endsWith('/') ? root : `${root}/`;
  const out = p.startsWith(r) ? p.slice(r.length) : p.replace(/^\.\//, '');
  return out.startsWith('/') ? undefined : out;
}

const KEY_FIELDS: Record<string, readonly string[]> = {
  Read: ['file_path', 'offset', 'limit'],
  Grep: ['pattern', 'path', 'glob', 'type', 'output_mode', '-i', 'multiline'],
  Glob: ['pattern', 'path'],
  Edit: ['file_path', 'old_string', 'new_string'],
  Write: ['file_path', 'content'],
  Bash: ['command'],
};

/** A stable key for the call's semantics (tool + the arguments that change its result). */
export function callKey(root: string, call: Pick<ToolCall, 'tool' | 'args'>): string {
  const fields = KEY_FIELDS[call.tool];
  const args = call.args;
  const picked = fields
    ? fields.map((f) => [f, f === 'file_path' || f === 'path' ? relPath(root, args[f]) ?? args[f] : args[f]] as const).filter(([, v]) => v !== undefined)
    : Object.entries(args).sort(([a], [b]) => (a < b ? -1 : 1));
  return hashWith('tool-call', call.tool, JSON.stringify(picked));
}

/** True for shell commands that run tests (used to detect the verify phase). */
export function isTestCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && /\b(vitest|jest|pytest|go test|mvn( -q)? test|gradle test|ctest|cargo test|npm (run )?test|pnpm (run )?test|yarn test|dotnet test)\b/.test(cmd);
}

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
