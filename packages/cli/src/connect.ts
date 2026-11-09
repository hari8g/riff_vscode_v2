import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DaemonClient, DaemonCore, type RpcCaller } from '@riaf/daemon';
import { silentLogger } from '@riaf/kernel';
import { bool, str, type ParsedArgs } from './args.js';

/** Finds the repository root: the nearest ancestor with `.git` or `.riaf`, else the start dir. */
export function findRoot(start: string): string {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, '.git')) || existsSync(join(d, '.riaf'))) return d;
    const up = dirname(d);
    if (up === d) return resolve(start);
    d = up;
  }
}

export interface Session {
  root: string;
  rpc: RpcCaller;
  inProcess: boolean;
  /** Runs the pipeline to completion first (in-process sessions start cold). */
  ensureIndexed(): Promise<void>;
}

/**
 * Connects to the repository's daemon (auto-starting one via `riaf serve --detached`), or opens the
 * index in-process with `--in-process` / RIAF_IN_PROCESS=1 (CI, benchmarks, machines without sockets).
 */
export async function openSession(p: ParsedArgs, cwd: string): Promise<Session> {
  const root = resolve(str(p, 'root') ?? findRoot(cwd));
  const inProcess = bool(p, 'in-process') || process.env.RIAF_IN_PROCESS === '1';
  if (inProcess) {
    const core = await DaemonCore.open({ root, logger: silentLogger, lsp: bool(p, 'lsp') });
    let indexed = false;
    return {
      root, rpc: core, inProcess: true,
      ensureIndexed: async () => {
        if (!indexed) await core.index('cli');
        indexed = true;
      },
    };
  }
  const self = process.argv[1];
  const spawn = self && existsSync(self) ? { command: process.execPath, args: [self, 'serve', '--root', root, '--detached', ...(bool(p, 'lsp') ? ['--lsp'] : [])] } : undefined;
  const client = await DaemonClient.connect(root, spawn ? { spawn } : {});
  return {
    root, rpc: client, inProcess: false,
    ensureIndexed: async () => {
      // the daemon indexes on startup and on change; make sure the first run has finished
      const st = await client.call('index.status', {});
      if (st.stages.some((s) => s.pending > 0) || st.blobs === 0) await client.call('index.rebuild', { wait: true });
    },
  };
}
