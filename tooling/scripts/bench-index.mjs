#!/usr/bin/env node
/**
 * M1 indexing benchmark: generates a synthetic repo (default 100k LOC), then measures a cold index,
 * a warm no-op run and a one-line edit through `riaf index --in-process`. Requires `pnpm build`.
 *   node tooling/scripts/bench-index.mjs [--loc 100000] [--keep]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const loc = process.argv.includes('--loc') ? process.argv[process.argv.indexOf('--loc') + 1] : '100000';
const dir = mkdtempSync(join(tmpdir(), 'riaf-bench-'));
const gen = JSON.parse(execFileSync(process.execPath, [join(root, 'tooling/scripts/make-large-repo.mjs'), dir, '--loc', loc], { encoding: 'utf8' }));
const cli = join(root, 'packages/cli/dist/main.js');
const run = (label) => {
  const t0 = performance.now();
  const out = JSON.parse(execFileSync(process.execPath, [cli, 'index', '--in-process', '--json', '--root', dir], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const ms = performance.now() - t0;
  const stages = Object.fromEntries(out.run.stages.map((s) => [s.stage, s.changed]));
  return { label, wallMs: Math.round(ms), pipelineMs: Math.round(out.run.ms), stages, symbols: out.status.symbols, edges: out.status.edges };
};
const results = [run('cold')];
results.push(run('warm'));
appendFileSync(join(dir, 'src/m3/module3.ts'), '\n// edit\n');
results.push(run('one-line edit'));
console.log(JSON.stringify({ loc: gen.loc, files: gen.files, node: process.versions.node, platform: `${process.platform}-${process.arch}`, results }, null, 2));
if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true });
