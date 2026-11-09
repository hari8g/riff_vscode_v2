#!/usr/bin/env node
/**
 * Fails when an eval report regresses against a reference summary: more than 2 points of file recall
 * lost, or more than 10% more tokens, for any runner present in both.
 *   node tooling/scripts/eval-gate.mjs <report.json> <reference.json>
 */
import { readFileSync } from 'node:fs';

const [reportFile, refFile] = process.argv.slice(2);
if (!reportFile || !refFile) {
  console.error('usage: eval-gate.mjs <report.json> <reference.json>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const ref = JSON.parse(readFileSync(refFile, 'utf8'));
let failed = 0;
for (const s of report.summaries) {
  const r = ref.summaries.find((x) => x.runner === s.runner);
  if (!r) continue;
  const recallDrop = (r.recall - s.recall) * 100;
  const tokenGrowth = r.meanTokens ? s.meanTokens / r.meanTokens - 1 : 0;
  const line = `${s.runner}: recall ${(s.recall * 100).toFixed(1)}% (ref ${(r.recall * 100).toFixed(1)}%), tokens ${Math.round(s.meanTokens)} (ref ${Math.round(r.meanTokens)})`;
  if (recallDrop > 2 || tokenGrowth > 0.1) {
    console.error(`REGRESSION ${line}`);
    failed++;
  } else console.log(`ok ${line}`);
}
process.exit(failed ? 1 : 0);
