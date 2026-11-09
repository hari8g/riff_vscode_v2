import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Where a repository's daemon keeps its state. Everything lives under `<root>/.riaf/`. */
export function riafDir(root: string): string {
  return join(resolve(root), '.riaf');
}

/** `<root>/.riaf/daemon.json`: pid, socket and protocol of the running daemon. */
export function daemonInfoPath(root: string): string {
  return join(riafDir(root), 'daemon.json');
}

export function daemonLogPath(root: string): string {
  return join(riafDir(root), 'daemon.log');
}

/**
 * Socket path for a repository. Unix domain sockets are limited to ~104 bytes on macOS, so deep
 * checkouts fall back to a per-repo socket in the temp dir; Windows uses a named pipe.
 */
export function socketPathFor(root: string, platform: NodeJS.Platform = process.platform): string {
  const abs = resolve(root);
  const tag = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  if (platform === 'win32') return `\\\\.\\pipe\\riaf-${tag}`;
  const local = join(riafDir(abs), 'daemon.sock');
  return Buffer.byteLength(local) < 100 ? local : join(tmpdir(), `riaf-${tag}.sock`);
}
