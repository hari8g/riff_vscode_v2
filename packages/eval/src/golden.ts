import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Golden packs: the compiler's output for fixed (repo, task) pairs, stored canonically and diffed in
 * CI. A change must be re-approved explicitly (`riaf eval --approve-golden`) with a reason in the
 * commit, so silent drift in the compiler cannot land.
 */

/** Fields that legitimately differ between runs and are dropped before comparison. */
const VOLATILE = new Set(['packId', 'createdAt', 'ms', 'commit']);

/** Canonical JSON: volatile fields removed, object keys sorted, stable indentation. */
export function canonicalize(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (VOLATILE.has(k)) continue;
        out[k] = norm((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2) + '\n';
}

export interface GoldenDiff {
  name: string;
  status: 'same' | 'changed' | 'new';
  /** Line diff (expected `-`, actual `+`), capped. */
  diff: string[];
}

/** Minimal line diff via longest common subsequence (golden packs are small). */
export function lineDiff(expected: string, actual: string, cap = 80): string[] {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while ((i < n || j < m) && out.length < cap) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out;
}

/** Compares `actual` with the stored golden `name`; writes it when `approve` is set. */
export function checkGolden(dir: string, name: string, actual: unknown, approve = false): GoldenDiff {
  const file = join(dir, `${name}.json`);
  const text = canonicalize(actual);
  if (approve) {
    mkdirSync(dir, { recursive: true });
    const status = existsSync(file) ? (readFileSync(file, 'utf8') === text ? 'same' : 'changed') : 'new';
    writeFileSync(file, text);
    return { name, status, diff: [] };
  }
  if (!existsSync(file)) return { name, status: 'new', diff: [] };
  const expected = readFileSync(file, 'utf8');
  return expected === text ? { name, status: 'same', diff: [] } : { name, status: 'changed', diff: lineDiff(expected, text) };
}
