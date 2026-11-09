import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectServers, grammarPath, LANGUAGES, loadLanguage } from '@riaf/parse';
import { CURRENT_SCHEMA_VERSION, Store } from '@riaf/store';
import { loadPolicies } from './policies.js';

/** Health checks behind `riaf doctor`. Each check is independent and never throws. */

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  check: string;
  level: CheckLevel;
  detail: string;
  fix?: string;
}

async function guard(check: string, fn: () => Promise<HealthCheck> | HealthCheck): Promise<HealthCheck> {
  try {
    return await fn();
  } catch (e) {
    return { check, level: 'fail', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs every check for `root`. `daemonRunning` is supplied by the caller (the CLI probes the socket). */
export async function runHealthChecks(root: string, opts: { daemonRunning?: boolean } = {}): Promise<HealthCheck[]> {
  const checks: Promise<HealthCheck>[] = [];
  checks.push(guard('node', () => {
    const major = Number(process.versions.node.split('.')[0]);
    return major >= 20 ? { check: 'node', level: 'ok', detail: `Node ${process.versions.node}` } : { check: 'node', level: 'fail', detail: `Node ${process.versions.node}`, fix: 'install Node 20 or newer' };
  }));
  checks.push(guard('sqlite-wasm', async () => {
    const s = await Store.open();
    const v = s.schemaVersion;
    await s.close();
    return { check: 'sqlite-wasm', level: v === CURRENT_SCHEMA_VERSION ? 'ok' : 'fail', detail: `in-memory store at schema ${v}` };
  }));
  for (const lang of LANGUAGES) {
    checks.push(guard(`grammar:${lang}`, async () => {
      const p = grammarPath(lang);
      await loadLanguage(lang);
      return { check: `grammar:${lang}`, level: 'ok', detail: p };
    }));
  }
  checks.push(guard('index', async () => {
    const db = join(root, '.riaf', 'index.sqlite');
    if (!existsSync(db)) return { check: 'index', level: 'warn', detail: 'no index yet', fix: 'run `riaf index`' };
    const s = await Store.open({ path: db });
    const st = s.stats();
    await s.close();
    const current = st.schemaVersion === CURRENT_SCHEMA_VERSION;
    return { check: 'index', level: current ? 'ok' : 'warn', detail: `${st.blobs} files, ${st.symbols} symbols, ${st.edges} edges, schema ${st.schemaVersion}`, ...(current ? {} : { fix: 'restart the daemon to migrate' }) };
  }));
  checks.push(guard('policies', () => {
    const l = loadPolicies(root);
    if (!l.policiesText) return { check: 'policies', level: 'warn', detail: '.riaf/policies.yaml missing (defaults apply)', fix: 'run `riaf init`' };
    return l.diagnostics.length
      ? { check: 'policies', level: 'fail', detail: l.diagnostics.map((d) => `${d.file}:${d.path} ${d.message}`).join('; ') }
      : { check: 'policies', level: 'ok', detail: l.version };
  }));
  for (const d of detectServers()) {
    checks.push(guard(`lsp:${d.spec.family}`, () => (d.command
      ? { check: `lsp:${d.spec.family}`, level: 'ok', detail: d.command }
      : { check: `lsp:${d.spec.family}`, level: 'warn', detail: 'not installed (LSP enrichment unavailable for this language)', fix: d.spec.install })));
  }
  if (opts.daemonRunning !== undefined) {
    checks.push(guard('daemon', () => (opts.daemonRunning
      ? { check: 'daemon', level: 'ok', detail: 'running' }
      : { check: 'daemon', level: 'warn', detail: 'not running (clients auto-start it)', fix: 'run `riaf serve` to start it in the foreground' })));
  }
  return Promise.all(checks);
}
