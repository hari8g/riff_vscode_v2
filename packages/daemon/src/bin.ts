#!/usr/bin/env node
import { resolve } from 'node:path';
import { startDaemon } from './main.js';

/** Entry point of a detached daemon: `node bin.js --root <repo> [--no-watch] [--poll] [--lsp] [--log-level debug]`. */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(value('--root') ?? process.cwd());
const handle = await startDaemon({
  root,
  watch: !flag('--no-watch'),
  poll: flag('--poll'),
  lsp: flag('--lsp'),
  logToFile: !flag('--foreground'),
  logLevel: (value('--log-level') as never) ?? 'info',
  idleMinutes: Number(value('--idle-minutes') ?? 0),
  exitOnStop: true,
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void handle.stop());
