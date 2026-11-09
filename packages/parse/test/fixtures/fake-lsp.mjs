// A tiny LSP server for tests: answers initialize, references and documentSymbol deterministically.
let buf = Buffer.alloc(0);
const send = (m) => { const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...m })); process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`); process.stdout.write(b); };
process.stdin.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n'); if (h < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString())[1]);
    if (buf.length < h + 4 + len) return;
    const msg = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString()); buf = buf.subarray(h + 4 + len);
    const root = process.cwd();
    if (msg.method === 'initialize') { send({ method: 'workspace/configuration', id: 99, params: {} }); send({ id: msg.id, result: { capabilities: {} } }); }
    else if (msg.method === 'textDocument/references') send({ id: msg.id, result: [{ uri: `file://${root}/src/toll/session.ts`, range: { start: { line: 22, character: 9 }, end: { line: 22, character: 22 } } }] });
    else if (msg.method === 'textDocument/documentSymbol') send({ id: msg.id, result: [{ name: 'validatePlate', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } }, selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 29 } } }] });
    else if (msg.method === 'shutdown') send({ id: msg.id, result: null });
    else if (msg.method === 'exit') process.exit(0);
    else if (msg.id !== undefined && msg.method) send({ id: msg.id, result: null });
  }
});
