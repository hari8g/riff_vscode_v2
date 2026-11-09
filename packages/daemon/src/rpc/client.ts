import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { RiafError, RPC_PROTOCOL_VERSION, type RpcMethod, type RpcParams, type RpcResult } from '@riaf/kernel';
import { daemonInfoPath, socketPathFor } from '../paths.js';
import { encodeLine, fromWireError, LineDecoder, type WireError } from './protocol.js';

/** Contents of `.riaf/daemon.json`. */
export interface DaemonInfoFile {
  pid: number;
  socket: string;
  protocol: string;
  version: string;
  root: string;
  startedAt: string;
}

/** Anything that can answer RPC calls: a socket connection or an in-process core. */
export interface RpcCaller {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  close(): Promise<void>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** A JSON-RPC connection to one daemon socket. */
export class SocketClient implements RpcCaller {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly socket: Socket, private readonly timeoutMs: number) {
    const decoder = new LineDecoder();
    socket.on('data', (chunk) => {
      for (const line of decoder.push(chunk)) this.onLine(line);
    });
    socket.on('close', () => this.failAll(new RiafError('rpc_failure', 'daemon connection closed')));
    socket.on('error', (e) => this.failAll(new RiafError('rpc_failure', `daemon connection error: ${e.message}`)));
  }

  /** Connects to `path`; rejects when nothing listens there. */
  static connect(path: string, timeoutMs = 60_000): Promise<SocketClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      socket.once('connect', () => {
        socket.off('error', reject);
        resolve(new SocketClient(socket, timeoutMs));
      });
      socket.once('error', reject);
    });
  }

  private onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: WireError };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(fromWireError(msg.error));
    else p.resolve(msg.result);
  }

  private failAll(e: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }

  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RiafError('rpc_failure', `${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.write(encodeLine({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async close(): Promise<void> {
    this.socket.end();
    this.socket.destroy();
  }
}

/** Reads `.riaf/daemon.json`, or undefined when no daemon has registered. */
export function readDaemonInfo(root: string): DaemonInfoFile | undefined {
  const p = daemonInfoPath(root);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DaemonInfoFile;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ConnectOptions {
  /** Start a daemon when none answers. Default true. */
  autoStart?: boolean;
  /** Command used to start the daemon; defaults to `node <@riaf/daemon>/dist/bin.js --root <root>`. */
  spawn?: { command: string; args: string[]; env?: NodeJS.ProcessEnv };
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

/** The default daemon launcher: this package's own bin. */
export function defaultSpawn(root: string): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  return { command: process.execPath, args: [fileURLToPath(new URL('../bin.js', import.meta.url)), '--root', root] };
}

/**
 * The client SDK every consumer uses: connects to the repository's daemon (auto-starting it when
 * needed), checks the protocol major, and exposes typed `call`.
 */
export class DaemonClient implements RpcCaller {
  private methods = new Set<string>();

  private constructor(private conn: SocketClient, readonly root: string, readonly info: RpcResult<'daemon.info'>) {
    this.methods = new Set(info.methods);
  }

  static async connect(root: string, opts: ConnectOptions = {}): Promise<DaemonClient> {
    const tryConnect = async (): Promise<SocketClient | undefined> => {
      const info = readDaemonInfo(root);
      const path = info?.socket ?? socketPathFor(root);
      try {
        return await SocketClient.connect(path, opts.requestTimeoutMs);
      } catch {
        return undefined;
      }
    };
    let conn = await tryConnect();
    if (!conn && (opts.autoStart ?? true)) {
      const stale = readDaemonInfo(root);
      if (stale && pidAlive(stale.pid)) {
        // a daemon is alive but not answering yet (still opening the store): wait for it below
      } else {
        const s = opts.spawn ?? defaultSpawn(root);
        const child = spawn(s.command, s.args, { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, ...(s.env ?? {}) } });
        child.unref();
      }
      const deadline = Date.now() + (opts.startTimeoutMs ?? 20_000);
      while (!conn && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        conn = await tryConnect();
      }
    }
    if (!conn) throw new RiafError('rpc_failure', `no RIAF daemon for ${root} (start one with \`riaf serve\`)`);
    const info = await conn.call('daemon.info', {});
    const major = (v: string) => v.split('.')[0];
    if (major(info.protocol) !== major(RPC_PROTOCOL_VERSION)) {
      await conn.close();
      throw new RiafError('rpc_failure', `daemon speaks protocol ${info.protocol}, client ${RPC_PROTOCOL_VERSION}; restart the daemon`);
    }
    return new DaemonClient(conn, root, info);
  }

  /** True when the connected daemon serves `method`. */
  supports(method: RpcMethod): boolean {
    return this.methods.has(method);
  }

  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    if (!this.methods.has(method)) return Promise.reject(new RiafError('rpc_failure', `method ${method} is not available in daemon ${this.info.version}`));
    return this.conn.call(method, params);
  }

  close(): Promise<void> {
    return this.conn.close();
  }
}
