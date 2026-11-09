import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createLogger, RPC_PROTOCOL_VERSION, type Logger, type LogLevel } from '@riaf/kernel';
import { DAEMON_VERSION, DaemonCore, type DaemonCoreOptions } from './core.js';
import { daemonInfoPath, daemonLogPath, riafDir, socketPathFor } from './paths.js';
import { readDaemonInfo, SocketClient, type DaemonInfoFile } from './rpc/client.js';
import { RpcServer } from './rpc/server.js';
import { RepoWatcher } from './watcher.js';

export interface StartDaemonOptions extends Omit<DaemonCoreOptions, 'afterRun' | 'logger'> {
  watch?: boolean;
  /** Poll instead of fs.watch (network drives, tests). */
  poll?: boolean;
  logLevel?: LogLevel;
  /** Write logs to .riaf/daemon.log instead of stderr (detached daemons). */
  logToFile?: boolean;
  /** Persist debounce after pipeline runs. */
  persistDebounceMs?: number;
  /** Exit the process when the daemon stops (bin entry). */
  exitOnStop?: boolean;
  /** Stop after this many idle minutes without RPC traffic (0 = never). */
  idleMinutes?: number;
}

export interface DaemonHandle {
  core: DaemonCore;
  socket: string;
  /** Resolves when the initial index run completes. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/** Starts the per-repository daemon: store, pipeline, watcher, RPC socket and `.riaf/daemon.json`. */
export async function startDaemon(opts: StartDaemonOptions): Promise<DaemonHandle> {
  const root = opts.root;
  mkdirSync(riafDir(root), { recursive: true });
  const existing = readDaemonInfo(root);
  if (existing) {
    try {
      const c = await SocketClient.connect(existing.socket, 2000);
      await c.close();
      throw new Error(`a RIAF daemon is already running for ${root} (pid ${existing.pid})`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('a RIAF daemon')) throw e;
      // stale registration: take over
    }
  }
  const logger: Logger = opts.logToFile
    ? createLogger('riaf-daemon', opts.logLevel ?? 'info', (line) => appendFileSync(daemonLogPath(root), JSON.stringify(line) + '\n'))
    : createLogger('riaf-daemon', opts.logLevel ?? 'info');

  let persistTimer: NodeJS.Timeout | undefined;
  // the pipeline's afterRun hook is created before the core exists, so it reaches the core through a holder
  const holder: { core?: DaemonCore } = {};
  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      holder.core?.persist().catch((e) => logger.warn('persist failed', { error: String(e) }));
    }, opts.persistDebounceMs ?? 1000);
  };
  const core = await DaemonCore.open({ ...opts, logger, afterRun: (s) => {
    logger.info('pipeline run', { reason: s.reason, ms: Math.round(s.ms), stages: s.stages.map((x) => `${x.stage}:${x.changed}${x.error ? '!' : ''}`).join(' ') });
    schedulePersist();
  } });
  holder.core = core;

  let lastActivity = Date.now();
  const handlers = new Proxy(core.handlers, {
    get(target, prop, recv) {
      lastActivity = Date.now();
      return Reflect.get(target, prop, recv);
    },
  });
  const server = new RpcServer(handlers, { logger, validateResults: opts.validateResults ?? false });
  const socket = socketPathFor(root);
  await server.listen(socket);
  const info: DaemonInfoFile = { pid: process.pid, socket, protocol: RPC_PROTOCOL_VERSION, version: DAEMON_VERSION, root, startedAt: core.startedAt };
  writeFileSync(daemonInfoPath(root), JSON.stringify(info, null, 2));

  const watcher = opts.watch === false ? undefined : new RepoWatcher(root, (reasons) => void core.index([...reasons].join(',')), { poll: opts.poll ?? false });
  const mode = watcher?.start();
  logger.info('daemon started', { root, socket, pid: process.pid, watch: mode ?? 'off' });

  let idleTimer: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (!stopping) {
      stopping = (async () => {
        watcher?.stop();
        if (idleTimer) clearInterval(idleTimer);
        if (persistTimer) clearTimeout(persistTimer);
        await server.close();
        await core.close();
        const cur = readDaemonInfo(root);
        if (cur?.pid === process.pid) rmSync(daemonInfoPath(root), { force: true });
        if (process.platform !== 'win32') rmSync(socket, { force: true });
        logger.info('daemon stopped', { root });
        if (opts.exitOnStop) process.exit(0);
      })();
    }
    return stopping;
  };
  core.onShutdown = () => void stop();
  if (opts.idleMinutes && opts.idleMinutes > 0) {
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > opts.idleMinutes! * 60_000 && !core.scheduler.busy) void stop();
    }, 30_000);
    idleTimer.unref();
  }
  const ready = core.index('startup').then(() => undefined);
  return { core, socket, ready, stop };
}
