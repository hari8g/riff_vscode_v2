import type { Store } from '@riaf/store';

/**
 * Conventions and invariants mined from the index. M3 covers structural conventions (test layout and
 * naming, file naming, error idioms); M4 adds co-change rules promoted from history when their
 * confidence is above 0.8. Each convention carries evidence counts so the compiler can weigh it.
 */

export interface Convention {
  id: string;
  text: string;
  /** Share of observations that follow the convention. */
  confidence: number;
  evidence: number;
  /** Symbols or paths the convention applies to (empty: repository-wide). */
  entities: string[];
  source: 'structure' | 'history';
}

const CASES: [string, RegExp][] = [['kebab-case', /^[a-z0-9]+(-[a-z0-9]+)+$/], ['snake_case', /^[a-z0-9]+(_[a-z0-9]+)+$/], ['camelCase', /^[a-z]+[A-Z][A-Za-z0-9]*$/], ['PascalCase', /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/]];

/** Mines structural conventions. `extra` lets later layers (history) contribute their own. */
export function mineConventions(store: Store, extra: readonly Convention[] = []): Convention[] {
  const out: Convention[] = [];
  const blobs = store.merkle.listBlobs().filter((b) => b.lang);
  const byLang = new Map<string, string[]>();
  for (const b of blobs) byLang.set(b.lang!, [...(byLang.get(b.lang!) ?? []), b.path]);
  for (const [lang, paths] of byLang) {
    const bases = paths.map((p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '')).filter((b) => /[-_A-Z]/.test(b) || b.length > 0);
    const counts = CASES.map(([name, re]) => [name, bases.filter((b) => re.test(b)).length] as const).sort((a, b) => b[1] - a[1]);
    const multi = bases.filter((b) => /[-_]|[a-z][A-Z]/.test(b)).length;
    if (multi >= 3 && counts[0]![1] / multi >= 0.8) out.push({ id: `naming:${lang}`, text: `${lang} file names use ${counts[0]![0]}`, confidence: counts[0]![1] / multi, evidence: multi, entities: [], source: 'structure' });
    const tests = paths.filter((p) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.|_test\.|^test_|\/test_[^/]+$|Test\.java$/.test(p));
    if (tests.length >= 2) {
      const inDir = tests.filter((p) => /(^|\/)(test|tests|__tests__)\//.test(p)).length;
      const dirName = tests.map((p) => /(^|\/)(test|tests|__tests__)\//.exec(p)?.[2]).find(Boolean);
      const suffix = tests.filter((p) => /\.test\.[jt]sx?$/.test(p)).length;
      const prefix = tests.filter((p) => /(^|\/)test_[^/]+\.py$/.test(p)).length;
      const javaSuffix = tests.filter((p) => /Test\.java$/.test(p)).length;
      const shape = suffix >= tests.length * 0.8 ? '`*.test.ts` files' : prefix >= tests.length * 0.8 ? '`test_*.py` files' : javaSuffix >= tests.length * 0.8 ? '`*Test.java` classes' : 'test files';
      const where = inDir >= tests.length * 0.8 ? `under \`${dirName}/\`` : 'next to the code they test';
      out.push({ id: `tests:${lang}`, text: `${lang} tests are ${shape} ${where}`, confidence: Math.max(inDir, tests.length - inDir) / tests.length, evidence: tests.length, entities: [], source: 'structure' });
    }
  }
  // error idioms: how code signals failure, from chunk text
  let throwsError = 0;
  let resultTypes = 0;
  let raisesValue = 0;
  for (const b of blobs) {
    for (const c of store.chunks.byPath(b.path)) {
      throwsError += (c.content.match(/throw new \w*Error\(/g) ?? []).length;
      resultTypes += (c.content.match(/\bResult<|\bok\(|\berr\(/g) ?? []).length;
      raisesValue += (c.content.match(/raise (ValueError|TypeError|KeyError|IOError|RuntimeError)\(/g) ?? []).length;
    }
  }
  if (throwsError >= 3 && throwsError > resultTypes * 2) out.push({ id: 'errors:throw', text: 'errors are signalled with `throw new Error(...)` (no Result type)', confidence: throwsError / (throwsError + resultTypes), evidence: throwsError, entities: [], source: 'structure' });
  if (raisesValue >= 2) out.push({ id: 'errors:raise', text: 'Python code raises built-in exceptions (`ValueError`, `IOError`) on bad input', confidence: 1, evidence: raisesValue, entities: [], source: 'structure' });
  return [...out, ...extra].sort((a, b) => b.confidence * Math.log1p(b.evidence) - a.confidence * Math.log1p(a.evidence));
}
