import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Synthetic git histories for the fixture repositories (the plan's make-fixture-history). Replays a
 * deterministic sequence of commits whose final tree is byte-identical to the fixture directory, and
 * returns a manifest of known answers for the history layer's tests:
 *   - files grow block by block through `feat` commits, authored by three synthetic people;
 *   - files introduced early use tab indentation until one bulk `style:` reformat commit;
 *   - bug-introducing commits followed later by `fix(TICKET)` commits restoring the line;
 *   - a `perf` change that is reverted with git's standard revert message;
 *   - two co-changing file pairs touched together repeatedly;
 *   - docs filler commits so the history reaches the requested length.
 */

export interface HistoryCommit {
  sha: string;
  message: string;
  kind: 'init' | 'feat' | 'style' | 'bug' | 'fix' | 'perf' | 'revert' | 'cochange' | 'docs';
  author: string;
  files: string[];
  at: string;
}

export interface HistoryManifest {
  repo: string;
  head: string;
  commits: HistoryCommit[];
  reformat: string;
  /** Bug introduced by `bug`, fixed by `fix`, on 1-based `line` of `path` in the final tree. */
  bugs: { bug: string; fix: string; path: string; line: number; ticket: string }[];
  reverts: { commit: string; revert: string; path: string; line: number }[];
  cochange: { a: string; b: string; commits: string[] }[];
}

export interface HistoryOptions {
  commits?: number;
  seed?: number;
  /** ISO date of the first commit; later commits are 6 hours apart. */
  start?: string;
}

const AUTHORS = [
  { name: 'Asha Rao', email: 'asha@example.invalid' },
  { name: 'Ben Okafor', email: 'ben@example.invalid' },
  { name: 'Chen Wei', email: 'chen@example.invalid' },
];
const CONFIG_FILES = /(^|\/)(README\.md|package\.json|tsconfig\.json|pom\.xml|pyproject\.toml|CMakeLists\.txt|go\.mod|\.gitignore)$/;
const SOURCE = /\.(ts|tsx|js|py|java|c|h|cpp|hpp|go|cs)$/;
const TEST = /(^|\/)(test|tests)\/|Test\.java$|_test\.(py|go)$|\.test\.ts$/;

function walk(root: string): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n === '.git' || n === '.riaf' || n === 'node_modules') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) rec(p);
      else out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  rec(root);
  return out;
}

/** Splits text into blocks at blank lines, merged to at most `max` blocks. */
function blocks(text: string, max: number): string[][] {
  const lines = text.split('\n');
  const raw: string[][] = [[]];
  for (const l of lines) {
    raw[raw.length - 1]!.push(l);
    if (l.trim() === '') raw.push([]);
  }
  const nonEmpty = raw.filter((b) => b.length > 0);
  if (nonEmpty.length <= max) return nonEmpty;
  const per = Math.ceil(nonEmpty.length / max);
  const out: string[][] = [];
  for (let i = 0; i < nonEmpty.length; i += per) out.push(nonEmpty.slice(i, i + per).flat());
  return out;
}

function indentUnit(path: string): number {
  return /\.(ts|tsx|js)$/.test(path) ? 2 : 4;
}

/** Legacy formatting: leading indentation in units of `unit` spaces becomes tabs. */
function toTabs(text: string, unit: number): string {
  return text.split('\n').map((l) => {
    const m = /^( +)/.exec(l);
    if (!m) return l;
    const n = m[1]!.length;
    return '\t'.repeat(Math.floor(n / unit)) + ' '.repeat(n % unit) + l.slice(n);
  }).join('\n');
}

const MUTATIONS: [RegExp, string][] = [
  [/ <= /, ' < '], [/ >= /, ' > '], [/ === /, ' !== '], [/ !== /, ' === '], [/ == /, ' != '], [/ != /, ' == '], [/ < /, ' <= '], [/ > /, ' >= '],
];

function mutate(line: string): string | undefined {
  for (const [re, rep] of MUTATIONS) if (re.test(line)) return line.replace(re, rep);
  return undefined;
}

class Rng {
  constructor(private s: number) {}
  next(n: number): number {
    this.s = (this.s * 1103515245 + 12345) % 2147483648;
    return this.s % n;
  }
}

/** Builds the history repository for `fixtureDir` in `outDir` (which is replaced). */
export function makeFixtureHistory(fixtureDir: string, outDir: string, opts: HistoryOptions = {}): HistoryManifest {
  const target = opts.commits ?? 200;
  const rng = new Rng(opts.seed ?? 7);
  const startMs = Date.parse(opts.start ?? '2025-01-06T09:00:00Z');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const git = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync('git', args, { cwd: outDir, env: { ...process.env, ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: outDir }, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'commit.gpgsign', 'false']);

  const files = walk(fixtureDir);
  const finalText = new Map(files.map((f) => [f, readFileSync(join(fixtureDir, f), 'utf8')]));
  const current = new Map<string, string>(); // what is on disk now
  const manifest: HistoryManifest = { repo: fixtureDir, head: '', commits: [], reformat: '', bugs: [], reverts: [], cochange: [] };
  let n = 0;

  const write = (path: string, text: string | undefined) => {
    const abs = join(outDir, path);
    if (text === undefined) {
      rmSync(abs, { force: true });
      current.delete(path);
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    current.set(path, text);
  };
  const commit = (message: string, kind: HistoryCommit['kind'], touched: string[]): string => {
    const author = AUTHORS[n % AUTHORS.length]!;
    const at = new Date(startMs + n * 6 * 3600_000).toISOString();
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', message], {
      GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email, GIT_COMMITTER_DATE: at,
    });
    const sha = git(['rev-parse', 'HEAD']);
    manifest.commits.push({ sha, message: message.split('\n')[0]!, kind, author: author.name, files: [...new Set(touched)].sort(), at });
    n++;
    return sha;
  };

  // 1. init: configuration files
  const configs = files.filter((f) => CONFIG_FILES.test(f));
  for (const f of configs) write(f, finalText.get(f));
  commit('chore: initial project skeleton', 'init', configs);

  // 2. growth: every other file arrives block by block, round-robin, sources before tests
  const growing = files.filter((f) => !CONFIG_FILES.test(f)).sort((a, b) => Number(TEST.test(a)) - Number(TEST.test(b)) || (a < b ? -1 : 1));
  const plan = new Map(growing.map((f) => [f, blocks(finalText.get(f)!, 4)]));
  const done = new Map(growing.map((f) => [f, 0]));
  const legacy = new Set<string>();
  const totalGrowth = [...plan.values()].reduce((a, b) => a + b.length, 0);
  const reformatAt = Math.floor(totalGrowth * 0.45);
  let growthCount = 0;
  const render = (f: string) => {
    const k = done.get(f)!;
    const text = plan.get(f)!.slice(0, k).flat().join('\n');
    const full = k === plan.get(f)!.length ? finalText.get(f)! : text + '\n';
    return legacy.has(f) && SOURCE.test(f) ? toTabs(full, indentUnit(f)) : full;
  };
  const queue = [...growing];
  let reformatted = false;
  while (queue.length) {
    const f = queue.shift()!;
    const k = done.get(f)!;
    if (k === 0 && !reformatted) legacy.add(f);
    done.set(f, k + 1);
    write(f, render(f));
    const scope = f.split('/').slice(-2, -1)[0] ?? 'core';
    const base = f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    commit(k === 0 ? `feat(${scope}): add ${base}` : `feat(${scope}): extend ${base}`, 'feat', [f]);
    growthCount++;
    if (done.get(f)! < plan.get(f)!.length) queue.splice(Math.min(queue.length, 2 + rng.next(3)), 0, f);
    if (!reformatted && growthCount >= reformatAt) {
      const touched = [...legacy].filter((x) => SOURCE.test(x));
      legacy.clear();
      for (const x of touched) write(x, render(x));
      manifest.reformat = commit('style: reformat sources (tabs to spaces)', 'style', touched);
      reformatted = true;
    }
  }
  if (!reformatted) {
    const touched = [...legacy].filter((x) => SOURCE.test(x));
    legacy.clear();
    for (const x of touched) write(x, render(x));
    manifest.reformat = commit('style: reformat sources (tabs to spaces)', 'style', touched);
  }

  // 3. scenarios on the complete tree
  const sources = growing.filter((f) => SOURCE.test(f) && !TEST.test(f));
  const candidates: { path: string; line: number; text: string; mutated: string }[] = [];
  for (const f of sources) {
    finalText.get(f)!.split('\n').forEach((l, i) => {
      const m = mutate(l);
      if (m && !l.trim().startsWith('//') && !l.trim().startsWith('#') && !l.trim().startsWith('*')) candidates.push({ path: f, line: i + 1, text: l, mutated: m });
    });
  }
  const pick = <T>(arr: T[]): T => arr.splice(rng.next(arr.length), 1)[0]!;
  const prefix = (fixtureDir.replace(/\/$/, '').split('/').pop() ?? 'fx').split('-')[0]!.toUpperCase();
  const replaceLine = (path: string, line: number, text: string) => {
    const lines = current.get(path)!.split('\n');
    lines[line - 1] = text;
    write(path, lines.join('\n'));
  };
  const scenarios: (() => void)[] = [];
  const bugCount = Math.min(3, candidates.length);
  const usedPaths = new Set<string>();
  for (let b = 0; b < bugCount; b++) {
    const pool = candidates.filter((c) => !usedPaths.has(c.path));
    if (!pool.length) break;
    const c = pick(pool);
    candidates.splice(candidates.indexOf(c), 1);
    usedPaths.add(c.path);
    const ticket = `${prefix}-${100 + b * 7}`;
    const base = c.path.slice(c.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    scenarios.push(() => {
      replaceLine(c.path, c.line, c.mutated);
      const bug = commit(`refactor(${base}): simplify boundary checks`, 'bug', [c.path]);
      // a few unrelated commits land between the bug and its fix
      (c as { bugSha?: string }).bugSha = bug;
    });
    scenarios.push(() => {
      replaceLine(c.path, c.line, c.text);
      const fix = commit(b === bugCount - 1 ? `hotfix: rollback boundary change in ${base} (${ticket}, incident INC-${40 + b})` : `fix(${base}): restore boundary condition (${ticket})`, 'fix', [c.path]);
      manifest.bugs.push({ bug: (c as { bugSha?: string }).bugSha!, fix, path: c.path, line: c.line, ticket });
    });
  }
  // line-level edits do not interfere, so the revert may share a file with a bug (different line)
  const preferred = candidates.filter((c) => !usedPaths.has(c.path));
  const revertPool = preferred.length ? preferred : candidates;
  if (revertPool.length) {
    const c = pick(revertPool);
    usedPaths.add(c.path);
    const base = c.path.slice(c.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    let perf = '';
    scenarios.push(() => {
      replaceLine(c.path, c.line, c.mutated);
      perf = commit(`perf(${base}): tighten comparison in hot path`, 'perf', [c.path]);
    });
    scenarios.push(() => {
      replaceLine(c.path, c.line, c.text);
      const subject = `perf(${base}): tighten comparison in hot path`;
      const rev = commit(`Revert "${subject}"\n\nThis reverts commit ${perf}.`, 'revert', [c.path]);
      manifest.reverts.push({ commit: perf, revert: rev, path: c.path, line: c.line });
    });
  }
  // co-change pairs: a marker comment toggled in both files together
  const commentFor = (p: string) => (/\.py$/.test(p) ? '#' : '//');
  const pairs: [string, string][] = [];
  // co-change toggles reset files to their final text, so they stay off files with in-flight bugs
  const pairPool = sources.filter((f) => !usedPaths.has(f));
  for (let i = 0; i < 2 && pairPool.length >= 2; i++) pairs.push([pick(pairPool), pick(pairPool)]);
  for (const [a, b] of pairs) {
    const entry = { a, b, commits: [] as string[] };
    manifest.cochange.push(entry);
    for (let k = 0; k < 6; k++) {
      scenarios.push(() => {
        for (const p of [a, b]) {
          const t = current.get(p)!;
          write(p, k % 2 === 0 ? `${t.replace(/\n$/, '')}\n${commentFor(p)} sync: keep in step with ${p === a ? b : a}\n` : finalText.get(p)!);
        }
        entry.commits.push(commit(`chore(sync): keep ${a.split('/').pop()} and ${b.split('/').pop()} in step`, 'cochange', [a, b]));
      });
    }
  }
  // interleave: keep each scenario's internal order, spread bug→fix apart
  const ordered: (() => void)[] = [];
  const lanes = [scenarios.slice(0, bugCount * 2), scenarios.slice(bugCount * 2)];
  while (lanes.some((l) => l.length)) {
    for (const l of lanes) {
      const f = l.shift();
      if (f) ordered.push(f);
    }
  }
  for (const s of ordered) s();

  // 4. docs filler up to the requested length: README toggles in pairs (so it ends at its final
  // text), plus one empty CI-retrigger commit when the remainder is odd
  const readme = files.find((f) => /README\.md$/.test(f));
  const remaining = Math.max(0, target - n);
  const pairsOfDocs = readme ? Math.floor(remaining / 2) : 0;
  for (let i = 0; i < pairsOfDocs * 2; i++) {
    const t = finalText.get(readme!)!;
    write(readme!, i % 2 === 0 ? `${t.replace(/\n$/, '')}\n\n_Note ${i}: wording under review._\n` : t);
    commit(i % 2 === 0 ? 'docs: clarify README wording' : 'docs: settle README wording', 'docs', [readme!]);
  }
  while (n < target) commit('chore: retrigger CI', 'docs', []);

  // the final tree must equal the fixture
  for (const f of files) {
    if (current.get(f) !== finalText.get(f)) throw new Error(`history for ${fixtureDir} ends with ${f} differing from the fixture`);
  }
  manifest.head = git(['rev-parse', 'HEAD']);
  return manifest;
}
