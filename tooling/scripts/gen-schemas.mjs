#!/usr/bin/env node
/**
 * Exports the kernel's zod contracts to docs/contracts/*.schema.json.
 *   node tooling/scripts/gen-schemas.mjs           # write
 *   node tooling/scripts/gen-schemas.mjs --check   # fail if the files on disk differ (CI)
 * Requires `pnpm build` first (reads packages/kernel/dist).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, 'docs/contracts');
const check = process.argv.includes('--check');

const kernel = await import(resolve(root, 'packages/kernel/dist/index.js'));

const contracts = {
  'intent-vector': kernel.IntentVectorSchema,
  'route-request': kernel.RouteRequestSchema,
  'task-unit': kernel.TaskUnitSchema,
  'composed-policy': kernel.ComposedPolicySchema,
  'policies-file': kernel.PoliciesFileSchema,
  'governance-file': kernel.GovernanceFileSchema,
  'token-settings': kernel.TokenSettingsSchema,
  'agent-prompt': kernel.AgentPromptSchema,
  'pack': kernel.PackSchema,
  'tool-call': kernel.ToolCallSchema,
  'tool-decision': kernel.ToolDecisionSchema,
};

mkdirSync(outDir, { recursive: true });
let drift = 0;
const write = (name, schema) => {
  const json = JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), null, 2) + '\n';
  const file = resolve(outDir, `${name}.schema.json`);
  if (check) {
    const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (cur !== json) {
      console.error(`drift: docs/contracts/${name}.schema.json is out of date (run pnpm schemas)`);
      drift++;
    }
  } else {
    writeFileSync(file, json);
    console.log(`wrote docs/contracts/${name}.schema.json`);
  }
};
for (const [name, schema] of Object.entries(contracts)) write(name, schema);

// The RPC table: one schema per method with params and result.
const rpc = {};
for (const [method, { params, result }] of Object.entries(kernel.RPC)) {
  rpc[method] = {
    params: z.toJSONSchema(params, { io: 'input', unrepresentable: 'any' }),
    result: z.toJSONSchema(result, { io: 'output', unrepresentable: 'any' }),
  };
}
const rpcJson = JSON.stringify(rpc, null, 2) + '\n';
const rpcFile = resolve(outDir, 'rpc.schema.json');
if (check) {
  if ((existsSync(rpcFile) ? readFileSync(rpcFile, 'utf8') : '') !== rpcJson) {
    console.error('drift: docs/contracts/rpc.schema.json is out of date (run pnpm schemas)');
    drift++;
  }
} else {
  writeFileSync(rpcFile, rpcJson);
  console.log('wrote docs/contracts/rpc.schema.json');
}

if (drift > 0) process.exit(1);
