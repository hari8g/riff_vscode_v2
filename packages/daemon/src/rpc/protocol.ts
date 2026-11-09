import { RiafError, type ErrorCode } from '@riaf/kernel';

/**
 * Wire format: JSON-RPC 2.0, one message per line (newline-delimited JSON). Simpler than LSP framing
 * and safe because JSON.stringify never emits raw newlines.
 */

export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Handler raised a RiafError; `data.code` carries the RIAF error code. */
  application: -32000,
  /** The method exists in the contract but this daemon does not serve it yet. */
  notAvailable: -32001,
} as const;

export interface WireError {
  code: number;
  message: string;
  data?: { riafCode?: ErrorCode; details?: Record<string, unknown> } | unknown;
}

/** Splits a byte stream into complete lines. */
export class LineDecoder {
  private buf = '';
  push(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    return lines.filter((l) => l.trim().length > 0);
  }
}

export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/** Converts a wire error back into a RiafError on the client side. */
export function fromWireError(e: WireError): RiafError {
  const data = (e.data ?? {}) as { riafCode?: ErrorCode; details?: Record<string, unknown> };
  return new RiafError(data.riafCode ?? 'rpc_failure', e.message, { rpcCode: e.code, ...(data.details ?? {}) });
}
