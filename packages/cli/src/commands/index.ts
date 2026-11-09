import { bool, int, str, type ParsedArgs } from '../args.js';
import type { Io } from '../io.js';
import { openSession } from '../connect.js';
import { runHealthChecks, readDaemonInfo, SocketClient, startDaemon } from '@riaf/daemon';
import type { RpcResult } from '@riaf/kernel';

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

/** `riaf index [--full] [--stages a,b]` — runs the pipeline and prints per-stage counts. */
export async function cmdIndex(p: ParsedArgs, io: Io): Promise<number> {
  const s = await openSession(p, io.cwd);
  try {
    const stages = str(p, 'stages')?.split(',').filter(Boolean);
    const r = await s.rpc.call('index.rebuild', { full: bool(p, 'full'), wait: true, ...(stages ? { stages } : {}) });
    const st = await s.rpc.call('index.status', {});
    if (bool(p, 'json')) {
      io.out(JSON.stringify({ run: r.run, status: st }, null, 2));
      return 0;
    }
    for (const x of r.run?.stages ?? []) io.out(`${pad(x.stage, 8)} ${String(x.changed).padStart(6)} changed  ${Math.round(x.ms)} ms${x.error ? `  ERROR ${x.error}` : ''}`);
    io.out(`indexed ${st.blobs} files, ${st.symbols} symbols, ${st.edges} edges in ${Math.round(r.run?.ms ?? 0)} ms`);
    return r.run?.stages.some((x) => x.error) ? 1 : 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf status` — index health and stage progress. */
export async function cmdStatus(p: ParsedArgs, io: Io): Promise<number> {
  const s = await openSession(p, io.cwd);
  try {
    const st = await s.rpc.call('index.status', {});
    if (bool(p, 'json')) io.out(JSON.stringify(st, null, 2));
    else {
      io.out(`${st.repo}${st.head ? ` @ ${st.head.slice(0, 12)}` : ''}`);
      io.out(`${st.blobs} files · ${st.symbols} symbols · ${st.edges} edges · schema ${st.schemaVersion}`);
      for (const x of st.stages) io.out(`  ${pad(x.stage, 8)} pending ${String(x.pending).padStart(5)}  done ${String(x.done).padStart(6)}${x.lastMs !== undefined ? `  last ${Math.round(x.lastMs)} ms` : ''}${x.lastError ? `  ERROR ${x.lastError}` : ''}`);
    }
    return 0;
  } finally {
    await s.rpc.close();
  }
}

function printJump(io: Io, j: RpcResult<'graph.jump'>, limit: number): void {
  const d = j.definition;
  if (!d) {
    io.out('no symbol matched');
    return;
  }
  const id = d.symbol;
  const name = id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || d.path;
  io.out(`${name}  ${d.kind ?? ''}  ${d.path}:${d.startLine}-${d.endLine}`);
  io.out(`  ${d.signature}`);
  if (d.doc) io.out(`  ${d.doc.split('\n')[0]}`);
  if (j.alternatives.length) io.out(`  also: ${j.alternatives.slice(0, 5).join(', ')}`);
  io.out(`references (${j.references.length}):`);
  for (const r of j.references.slice(0, limit)) {
    const scope = r.symbol.slice(r.symbol.indexOf('#') + 1, r.symbol.lastIndexOf('@')) || '(file)';
    io.out(`  ${r.path}:${r.line}  ${pad(r.kind, 14)} ${scope}${r.confidence !== undefined && r.confidence < 0.9 ? `  (${r.confidence.toFixed(2)})` : ''}`);
  }
  if (j.references.length > limit) io.out(`  … ${j.references.length - limit} more`);
  for (const b of j.blame) io.out(`  blame ${b.commit.slice(0, 10)} ${b.at} ${b.summary ?? ''}`);
}

/** `riaf jump <symbol | Qualified.name | path:line>` — definition and references. */
export async function cmdJump(p: ParsedArgs, io: Io): Promise<number> {
  const query = p.positionals.join(' ');
  if (!query) {
    io.err('usage: riaf jump <symbol | Qualified.name | path:line>');
    return 2;
  }
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const j = await s.rpc.call('graph.jump', { query });
    if (bool(p, 'json')) io.out(JSON.stringify(j, null, 2));
    else printJump(io, j, int(p, 'limit', 25)!);
    return j.definition ? 0 : 1;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf impact <symbol...> [--hops 2]` — dependents, tests and co-change partners. */
export async function cmdImpact(p: ParsedArgs, io: Io): Promise<number> {
  if (p.positionals.length === 0) {
    io.err('usage: riaf impact <symbol | Qualified.name | path:line>... [--hops N]');
    return 2;
  }
  const s = await openSession(p, io.cwd);
  try {
    await s.ensureIndexed();
    const ids: string[] = [];
    for (const q of p.positionals) {
      const j = await s.rpc.call('graph.jump', { query: q });
      if (!j.definition) {
        io.err(`no symbol matched ${q}`);
        return 1;
      }
      ids.push(j.definition.symbol);
    }
    const r = await s.rpc.call('graph.impact', { symbols: ids, hops: int(p, 'hops', 2)! });
    if (bool(p, 'json')) {
      io.out(JSON.stringify(r, null, 2));
      return 0;
    }
    io.out(`impact of ${ids.join(', ')}`);
    io.out(`dependents (${r.closure.length}):`);
    for (const c of r.closure.slice(0, int(p, 'limit', 40)!)) io.out(`  ${'  '.repeat(c.distance - 1)}${c.symbol}  ${c.via}`);
    io.out(`tests (${r.tests.length}):`);
    for (const t of r.tests) io.out(`  ${t}`);
    if (r.coChange.length) {
      io.out(`co-change partners (${r.coChange.length}):`);
      for (const c of r.coChange.slice(0, 15)) io.out(`  ${c.symbol}  support ${c.support}`);
    }
    return 0;
  } finally {
    await s.rpc.close();
  }
}

/** `riaf doctor` — environment, grammars, index, policies, LSP servers, daemon. */
export async function cmdDoctor(p: ParsedArgs, io: Io): Promise<number> {
  const root = (await import('../connect.js')).findRoot(str(p, 'root') ?? io.cwd);
  let running = false;
  const info = readDaemonInfo(root);
  if (info) {
    try {
      const c = await SocketClient.connect(info.socket, 2000);
      running = true;
      await c.close();
    } catch {
      running = false;
    }
  }
  const checks = await runHealthChecks(root, { daemonRunning: running });
  if (bool(p, 'json')) io.out(JSON.stringify(checks, null, 2));
  else {
    const glyph = { ok: io.tty ? '✓' : 'ok  ', warn: io.tty ? '!' : 'warn', fail: io.tty ? '✗' : 'FAIL' } as const;
    for (const c of checks) io.out(`${glyph[c.level]} ${pad(c.check, 20)} ${c.detail}${c.fix ? `\n${' '.repeat(26)}fix: ${c.fix}` : ''}`);
  }
  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}

/** `riaf serve [--detached] [--no-watch] [--lsp]` — runs the daemon in the foreground. */
export async function cmdServe(p: ParsedArgs, io: Io): Promise<number> {
  const root = (await import('../connect.js')).findRoot(str(p, 'root') ?? io.cwd);
  const h = await startDaemon({
    root, watch: bool(p, 'watch', true), poll: bool(p, 'poll'), lsp: bool(p, 'lsp'),
    logToFile: bool(p, 'detached'), idleMinutes: int(p, 'idle-minutes', 0)!, exitOnStop: true,
  });
  if (!bool(p, 'detached')) io.err(`riaf daemon serving ${root} on ${h.socket} (Ctrl-C to stop)`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void h.stop());
  await new Promise<never>(() => undefined);
  return 0;
}
