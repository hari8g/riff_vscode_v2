import { createServer, type Server, type Socket } from 'node:net';
import { rmSync } from 'node:fs';
import { RPC, RiafError, toRiafError, type Logger, type RpcMethod, type RpcParams, type RpcResult } from '@riaf/kernel';
import { encodeLine, JSONRPC_ERRORS, LineDecoder, type WireError } from './protocol.js';

/** One handler per RPC method; params arrive already validated and defaulted by the method's schema. */
export type RpcHandlers = { [M in RpcMethod]?: (params: RpcParams<M> & Record<string, unknown>) => Promise<RpcResult<M>> | RpcResult<M> };

export interface DispatchOptions {
  /** Validate results against the contract too (tests and debug builds). */
  validateResults?: boolean;
  logger?: Logger;
}

type Outcome = { result: unknown } | { error: WireError };

/** Validates and dispatches one decoded request. Used by the socket server and by in-process clients. */
export async function dispatch(handlers: RpcHandlers, method: string, params: unknown, opts: DispatchOptions = {}): Promise<Outcome> {
  const contract = (RPC as Record<string, { params: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: unknown[] } } }; result: { safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } } } }>)[method];
  if (!contract) return { error: { code: JSONRPC_ERRORS.methodNotFound, message: `unknown method ${method}` } };
  const handler = (handlers as Record<string, ((p: unknown) => unknown) | undefined>)[method];
  if (!handler) return { error: { code: JSONRPC_ERRORS.notAvailable, message: `method ${method} is not available in this daemon yet` } };
  const parsed = contract.params.safeParse(params ?? {});
  if (!parsed.success) return { error: { code: JSONRPC_ERRORS.invalidParams, message: `invalid params for ${method}`, data: { issues: parsed.error?.issues } } };
  try {
    const result = await handler(parsed.data);
    if (opts.validateResults) {
      const ok = contract.result.safeParse(result);
      if (!ok.success) return { error: { code: JSONRPC_ERRORS.internal, message: `result of ${method} violates the contract`, data: { issues: ok.error?.issues } } };
    }
    return { result };
  } catch (e) {
    const err = toRiafError(e);
    opts.logger?.warn('rpc handler failed', { method, code: err.code, message: err.message });
    return { error: { code: JSONRPC_ERRORS.application, message: err.message, data: { riafCode: err.code, ...(err.details ? { details: err.details } : {}) } } };
  }
}

/** JSON-RPC server over a unix socket or Windows named pipe. */
export class RpcServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly handlers: RpcHandlers, private readonly opts: DispatchOptions = {}) {}

  listen(path: string): Promise<void> {
    if (process.platform !== 'win32') rmSync(path, { force: true });
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.onConnection(socket));
      server.once('error', reject);
      server.listen(path, () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
  }

  private onConnection(socket: Socket): void {
    this.sockets.add(socket);
    socket.setNoDelay(true);
    const decoder = new LineDecoder();
    socket.on('data', (chunk) => {
      for (const line of decoder.push(chunk)) void this.onLine(socket, line);
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }

  private async onLine(socket: Socket, line: string): Promise<void> {
    let msg: { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      socket.write(encodeLine({ jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.parse, message: 'parse error' } }));
      return;
    }
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      socket.write(encodeLine({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: JSONRPC_ERRORS.invalidRequest, message: 'invalid request' } }));
      return;
    }
    const out = await dispatch(this.handlers, msg.method, msg.params, this.opts);
    if (msg.id === undefined) return; // notification
    if (!socket.destroyed) socket.write(encodeLine({ jsonrpc: '2.0', id: msg.id, ...out }));
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = undefined;
  }
}

export { RiafError };
