import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, type McpServerOptions, type RpcCaller } from './server.js';

/** Serves MCP over stdio (what Claude Code launches from .mcp.json). Resolves when stdin closes. */
export async function serveStdio(rpc: RpcCaller, opts: McpServerOptions = {}): Promise<void> {
  const server = createMcpServer(rpc, { sessionId: opts.sessionId ?? `mcp-${randomUUID().slice(0, 8)}`, ...opts });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
  });
  await server.close();
}

/** Serves MCP over streamable HTTP on 127.0.0.1:`port` (stateless: a fresh server per request). */
export async function serveHttp(rpc: RpcCaller, port: number, opts: McpServerOptions = {}): Promise<Server> {
  const http = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const server = createMcpServer(rpc, opts);
    // stateless mode: no session id generator (the SDK's documented way is to pass undefined)
    const transport = new StreamableHTTPServerTransport({} as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  return http;
}
