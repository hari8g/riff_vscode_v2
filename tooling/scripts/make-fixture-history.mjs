#!/usr/bin/env node
/**
 * Replays a fixture repository as a deterministic 200-commit git history (features, bug fixes,
 * a revert, a bulk reformat, co-changing pairs) and prints the manifest of known answers.
 *   node tooling/scripts/make-fixture-history.mjs <fixture-name> <outDir> [--commits 200]
 * Requires `pnpm build` (uses packages/eval/dist).
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [name, out] = process.argv.slice(2);
if (!name || !out) {
  console.error('usage: make-fixture-history.mjs <toll-ts|fleet-java|telemetry-py|embedded-c> <outDir> [--commits N]');
  process.exit(2);
}
const i = process.argv.indexOf('--commits');
const { makeFixtureHistory } = await import(join(root, 'packages/eval/dist/index.js'));
const manifest = makeFixtureHistory(join(root, 'fixtures/repos', name), resolve(out), i > 0 ? { commits: Number(process.argv[i + 1]) } : {});
console.log(JSON.stringify({ ...manifest, commits: manifest.commits.length }, null, 2));
