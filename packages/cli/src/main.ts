#!/usr/bin/env node
import { processIo } from './io.js';
import { runCli } from './run.js';

const code = await runCli(process.argv.slice(2), processIo());
if (process.argv[2] !== 'serve' && !(process.argv[2] === 'mcp' && process.argv.includes('--http'))) process.exit(code);
