import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { RiafError, type DocumentSymbol, type Location, type LspPort, type SourceRange } from '@riaf/kernel';

/**
 * A minimal LSP client over stdio: Content-Length framing, request/response correlation, the
 * initialize handshake, didOpen on demand, and the four queries LspPort needs. Server-initiated
 * requests (workspace/configuration and friends) get an empty answer so servers do not stall.
 */

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface LspClientOptions {
  command: string;
  args: readonly string[];
  languageId: string;
  /** Absolute repository root. */
  root: string;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface LspLocation { uri: string; range: SourceRange }
interface LspLocationLink { targetUri: string; targetRange: SourceRange; targetSelectionRange?: SourceRange }
interface LspDocumentSymbol { name: string; kind: number; range: SourceRange; selectionRange: SourceRange; children?: LspDocumentSymbol[] }
interface LspSymbolInformation { name: string; kind: number; location: LspLocation }

const SYMBOL_KIND_NAMES = [
  '', 'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum',
  'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key',
  'null', 'enummember', 'struct', 'event', 'operator', 'typeparameter',
];

/** Encodes one JSON-RPC message with LSP framing. */
export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Incremental decoder for LSP-framed messages. */
export class FrameDecoder {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const headerEnd = this.buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = this.buf.subarray(0, headerEnd).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      if (this.buf.length < headerEnd + 4 + len) break;
      const body = this.buf.subarray(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      this.buf = this.buf.subarray(headerEnd + 4 + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        // skip malformed message
      }
    }
    return out;
  }
}

export class LspClient implements LspPort {
  readonly languageId: string;
  private proc: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly opened = new Set<string>();
  private ready: Promise<void> | undefined;
  private readonly timeout: number;

  constructor(private readonly opts: LspClientOptions) {
    this.languageId = opts.languageId;
    this.timeout = opts.requestTimeoutMs ?? 15_000;
  }

  private uri(path: string): string {
    return pathToFileURL(join(this.opts.root, path)).href;
  }

  private pathOf(uri: string): string {
    const abs = fileURLToPath(uri);
    const root = this.opts.root.endsWith('/') ? this.opts.root : `${this.opts.root}/`;
    return abs.startsWith(root) ? abs.slice(root.length).replace(/\\/g, '/') : abs;
  }

  private send(message: object): void {
    this.proc?.stdin.write(frame({ jsonrpc: '2.0', ...message }));
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RiafError('rpc_failure', `LSP ${method} timed out after ${this.timeout} ms`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  private onMessage(msg: { id?: number | string; method?: string; result?: unknown; error?: { message: string } }): void {
    if (msg.method !== undefined && msg.id !== undefined) {
      // server → client request: answer with null / empty config so the server proceeds
      this.send({ id: msg.id, result: msg.method === 'workspace/configuration' ? [] : null });
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new RiafError('rpc_failure', msg.error.message));
    else p.resolve(msg.result);
  }

  /** Starts the server and performs the initialize handshake (idempotent). */
  start(): Promise<void> {
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const proc = spawn(this.opts.command, [...this.opts.args], { cwd: this.opts.root, env: this.opts.env ?? process.env, stdio: 'pipe' });
        this.proc = proc;
        const decoder = new FrameDecoder();
        proc.stdout.on('data', (c: Buffer) => {
          for (const m of decoder.push(c)) this.onMessage(m as never);
        });
        proc.stderr.on('data', () => undefined);
        proc.on('error', (e) => reject(new RiafError('rpc_failure', `cannot start ${this.opts.command}: ${e.message}`)));
        proc.on('exit', () => {
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new RiafError('rpc_failure', 'LSP server exited'));
          }
          this.pending.clear();
        });
        this.request('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(this.opts.root).href,
          workspaceFolders: [{ uri: pathToFileURL(this.opts.root).href, name: 'root' }],
          capabilities: {
            textDocument: {
              definition: { linkSupport: true },
              references: {},
              hover: { contentFormat: ['plaintext', 'markdown'] },
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            },
            workspace: { configuration: true, workspaceFolders: true },
          },
        }).then(() => {
          this.notify('initialized', {});
          resolve();
        }, reject);
      });
    }
    return this.ready;
  }

  private async open(path: string): Promise<void> {
    await this.start();
    if (this.opened.has(path)) return;
    const text = readFileSync(join(this.opts.root, path), 'utf8');
    this.notify('textDocument/didOpen', { textDocument: { uri: this.uri(path), languageId: this.languageId, version: 1, text } });
    this.opened.add(path);
  }

  private toLocations(res: unknown): Location[] {
    if (!res) return [];
    const list = (Array.isArray(res) ? res : [res]) as (LspLocation | LspLocationLink)[];
    return list.map((l) => ('targetUri' in l
      ? { path: this.pathOf(l.targetUri), range: l.targetSelectionRange ?? l.targetRange }
      : { path: this.pathOf(l.uri), range: l.range }));
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.start();
      return true;
    } catch {
      return false;
    }
  }

  async definition(loc: Location): Promise<Location[]> {
    await this.open(loc.path);
    return this.toLocations(await this.request('textDocument/definition', { textDocument: { uri: this.uri(loc.path) }, position: loc.range.start }));
  }

  async references(loc: Location, includeDeclaration = false): Promise<Location[]> {
    await this.open(loc.path);
    return this.toLocations(await this.request('textDocument/references', {
      textDocument: { uri: this.uri(loc.path) }, position: loc.range.start, context: { includeDeclaration },
    }));
  }

  async documentSymbols(path: string): Promise<DocumentSymbol[]> {
    await this.open(path);
    const res = (await this.request<(LspDocumentSymbol | LspSymbolInformation)[] | null>('textDocument/documentSymbol', { textDocument: { uri: this.uri(path) } })) ?? [];
    const conv = (s: LspDocumentSymbol): DocumentSymbol => ({
      name: s.name, kind: SYMBOL_KIND_NAMES[s.kind] ?? 'unknown', range: s.range, selectionRange: s.selectionRange,
      ...(s.children ? { children: s.children.map(conv) } : {}),
    });
    return res.map((s) => ('location' in s
      ? { name: s.name, kind: SYMBOL_KIND_NAMES[s.kind] ?? 'unknown', range: s.location.range, selectionRange: s.location.range }
      : conv(s)));
  }

  async hover(loc: Location): Promise<string | undefined> {
    await this.open(loc.path);
    const res = await this.request<{ contents: string | { value: string } | (string | { value: string })[] } | null>('textDocument/hover', {
      textDocument: { uri: this.uri(loc.path) }, position: loc.range.start,
    });
    if (!res) return undefined;
    const c = res.contents;
    const parts = Array.isArray(c) ? c : [c];
    return parts.map((p) => (typeof p === 'string' ? p : p.value)).join('\n') || undefined;
  }

  async dispose(): Promise<void> {
    if (!this.proc) return;
    try {
      await Promise.race([this.request('shutdown', null), new Promise((r) => setTimeout(r, 1000))]);
      this.notify('exit', null);
    } catch {
      // server already gone
    }
    this.proc.kill();
    this.proc = undefined;
    this.ready = undefined;
    this.opened.clear();
  }
}
