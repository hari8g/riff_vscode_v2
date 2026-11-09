import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RiafError } from '@riaf/kernel';

/**
 * Thin git access: one process per call, parsed from machine formats (record/field separators,
 * porcelain blame). Never writes to the repository.
 */

const RS = '\u001e';
const FS = '\u001f';

/** Runs git synchronously; throws a RiafError with git's stderr on failure. */
export function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new RiafError('git_failure', `git ${args[0]} failed: ${(err.stderr ?? err.message).trim().split('\n')[0]}`);
  }
}

/** Runs git asynchronously (blame batches); resolves stdout or rejects with a RiafError. */
export function gitAsync(root: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new RiafError('git_failure', `git ${args[0]} failed: ${(stderr || err.message).trim().split('\n')[0]}`));
      else resolve(stdout);
    });
  });
}

/** True when `root` is a git work tree with at least one commit (no process spawned for plain repos). */
export function hasHistory(root: string): boolean {
  if (gitDirOf(root)) return headSha(root) !== undefined;
  try {
    git(root, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Locates the git directory (handles `.git` files of worktrees and submodules). */
function gitDirOf(root: string): string | undefined {
  const p = join(root, '.git');
  if (!existsSync(p)) return undefined;
  if (statSync(p).isDirectory()) return p;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(p, 'utf8'));
  return m ? (m[1]!.trim().startsWith('/') ? m[1]!.trim() : join(root, m[1]!.trim())) : undefined;
}

/** HEAD read from the git directory without spawning git (falls back to `git rev-parse`). */
export function headSha(root: string): string | undefined {
  const dir = gitDirOf(root);
  if (dir) {
    try {
      const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(head)) return head;
      const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
      if (ref) {
        const loose = join(dir, ref);
        if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
        const packed = join(dir, 'packed-refs');
        if (existsSync(packed)) {
          for (const line of readFileSync(packed, 'utf8').split('\n')) {
            const [sha, name] = line.split(' ');
            if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
          }
        }
        return undefined; // unborn branch: no commits yet
      }
    } catch {
      // fall through to git
    }
  }
  try {
    return git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return undefined;
  }
}

/** True when `ancestor` is an ancestor of `head` (history was not rewritten). */
export function isAncestor(root: string, ancestor: string, head: string): boolean {
  try {
    git(root, ['merge-base', '--is-ancestor', ancestor, head]);
    return true;
  } catch {
    return false;
  }
}

export interface RawCommit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  at: string;
  subject: string;
  body: string;
  files: { path: string; added: number; deleted: number }[];
}

/** Parses `git log` output produced with LOG_FORMAT and --numstat. */
export function parseLog(out: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const rec of out.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.split(FS);
    if (parts.length < 8) continue;
    const [sha, parents, author, email, at, subject, body, rest] = parts as [string, string, string, string, string, string, string, string];
    const files: RawCommit['files'] = [];
    for (const line of rest.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (m) files.push({ path: m[3]!, added: m[1] === '-' ? 0 : Number(m[1]), deleted: m[2] === '-' ? 0 : Number(m[2]) });
    }
    commits.push({ sha: sha.trim(), parents: parents.trim() ? parents.trim().split(' ') : [], author, email, at, subject, body: body.trim(), files });
  }
  return commits;
}

export const LOG_FORMAT = `${RS}%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%s${FS}%b${FS}`;

/** Commits reachable from HEAD and not from `since` (all when `since` is undefined), oldest first. */
export function mineLog(root: string, since?: string, maxCount?: number): RawCommit[] {
  const range = since ? [`${since}..HEAD`] : ['HEAD'];
  const out = git(root, ['log', '--no-color', '--no-renames', '--numstat', `--format=${LOG_FORMAT}`, ...(maxCount ? [`--max-count=${maxCount}`] : []), ...range]);
  return parseLog(out).reverse();
}

/** Parses `git blame --porcelain` into the commit that owns each 1-based line. */
export function parseBlame(out: string): Map<number, string> {
  const owner = new Map<number, string>();
  let current: { sha: string; line: number } | undefined;
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (m) {
      current = { sha: m[1]!, line: Number(m[2]) };
      continue;
    }
    if (line.startsWith('\t') && current) {
      owner.set(current.line, current.sha);
      current = undefined;
    }
  }
  return owner;
}

/** Blames the working-tree file (so line numbers match the index), ignoring whitespace and noise revs. */
export async function blameFile(root: string, path: string, ignoreRevs: readonly string[] = []): Promise<Map<number, string>> {
  const args = ['blame', '--porcelain', '-w', ...ignoreRevs.flatMap((r) => ['--ignore-rev', r])];
  if (existsSync(join(root, '.git-blame-ignore-revs'))) args.push('--ignore-revs-file', '.git-blame-ignore-revs');
  args.push('--', path);
  try {
    return parseBlame(await gitAsync(root, args));
  } catch {
    return new Map(); // untracked file or not in HEAD yet: no history
  }
}
