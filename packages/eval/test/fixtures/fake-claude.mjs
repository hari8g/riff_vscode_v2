#!/usr/bin/env node
// Stands in for `claude -p ... --output-format stream-json`: reads one file, applies the toll-002 fix, reports usage.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
emit({ type: 'system', subtype: 'init' });
const file = join(root, 'src/pricing/peak.ts');
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'endHour' } }] } });
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: file } }] } });
writeFileSync(file, readFileSync(file, 'utf8').replace('hour <= w.endHour', 'hour < w.endHour'));
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }, { type: 'text', text: 'done' }] } });
emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } });
