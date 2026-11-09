import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Locates the git directory of `root` (handles `.git` files used by worktrees and submodules). */
export function gitDir(root: string): string | undefined {
  const p = join(root, '.git');
  if (!existsSync(p)) return undefined;
  if (statSync(p).isDirectory()) return p;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(p, 'utf8'));
  return m ? (m[1]!.startsWith('/') ? m[1]!.trim() : join(root, m[1]!.trim())) : undefined;
}

/** The commit HEAD points at, read from the git directory without spawning git. */
export function gitHead(root: string): string | undefined {
  const dir = gitDir(root);
  if (!dir) return undefined;
  try {
    const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return undefined;
    const loose = join(dir, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    const packed = join(dir, 'packed-refs');
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        const [sha, name] = line.split(' ');
        if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
      }
    }
  } catch {
    // unreadable git dir: report no head
  }
  return undefined;
}
