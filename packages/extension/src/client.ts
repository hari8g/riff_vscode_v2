import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DaemonClient } from '@riaf/daemon/client';

/**
 * Connects to the repository's daemon, starting the bundled one when none runs. Inside VS Code,
 * process.execPath is the Electron binary, so the daemon runs with ELECTRON_RUN_AS_NODE=1 — no Node
 * installation and no download is needed.
 */
export async function connectDaemon(root: string, extensionDir: string): Promise<DaemonClient> {
  const cli = join(extensionDir, 'dist', 'riaf', 'riaf.mjs');
  const spawn = existsSync(cli) ? { command: process.execPath, args: [cli, 'serve', '--detached', '--root', root], env: { ELECTRON_RUN_AS_NODE: '1' } } : undefined;
  return DaemonClient.connect(root, { ...(spawn ? { spawn } : {}), startTimeoutMs: 30_000 });
}

/** Path of the bundled CLI (used by "Open in Claude Code" and the init command). */
export function bundledCli(extensionDir: string): string {
  return join(extensionDir, 'dist', 'riaf', 'riaf.mjs');
}
