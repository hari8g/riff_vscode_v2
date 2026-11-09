#!/usr/bin/env node
/**
 * Generates a synthetic multi-language repository for indexing benchmarks (M1 gate: 100k LOC cold
 * index under 60 s). Modules import and call each other so the graph stage has real work to do.
 *   node tooling/scripts/make-large-repo.mjs <outDir> [--loc 100000]
 * Mix: 60% TypeScript, 20% Python, 10% Java, 10% C. Deterministic for a given --loc.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('usage: make-large-repo.mjs <outDir> [--loc N]');
  process.exit(2);
}
const locArg = process.argv.indexOf('--loc');
const targetLoc = locArg > 0 ? Number(process.argv[locArg + 1]) : 100_000;

let seed = 42;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const METHODS = 8;
const BODY = 18; // lines per method body → ~200 lines per file

function ts(i, deps) {
  const imports = deps.map((d) => `import { Module${d} } from '../m${d % 20}/module${d}.js';`).join('\n');
  const methods = [];
  for (let m = 0; m < METHODS; m++) {
    const body = [];
    for (let l = 0; l < BODY; l++) {
      const d = deps[(m + l) % deps.length];
      body.push(l % 6 === 0 && d !== undefined ? `    acc += new Module${d}().step${(m + l) % METHODS}(acc + ${l});` : `    acc = (acc * ${l + 3} + ${m}) % 1000003;`);
    }
    methods.push(`  /** Step ${m} of module ${i}. */\n  step${m}(input: number): number {\n    let acc = input;\n${body.join('\n')}\n    return this.helper${m % 3}(acc);\n  }`);
  }
  const helpers = [0, 1, 2].map((h) => `  private helper${h}(x: number): number {\n    return x + ${h};\n  }`);
  return `${imports}\n\nexport interface Shape${i} { id: number; label: string }\n\n/** Synthetic module ${i}. */\nexport class Module${i} {\n${[...methods, ...helpers].join('\n\n')}\n}\n\nexport function make${i}(): Module${i} {\n  return new Module${i}();\n}\n`;
}

function py(i, deps) {
  const imports = deps.map((d) => `from pkg.m${d % 20}.module${d} import Module${d}`).join('\n');
  const methods = [];
  for (let m = 0; m < METHODS; m++) {
    const body = [];
    for (let l = 0; l < BODY; l++) {
      const d = deps[(m + l) % deps.length];
      body.push(l % 6 === 0 && d !== undefined ? `        acc += Module${d}().step${(m + l) % METHODS}(acc + ${l})` : `        acc = (acc * ${l + 3} + ${m}) % 1000003`);
    }
    methods.push(`    def step${m}(self, value):\n        """Step ${m} of module ${i}."""\n        acc = value\n${body.join('\n')}\n        return self._helper(acc)`);
  }
  return `${imports}\n\n\nclass Module${i}:\n${methods.join('\n\n')}\n\n    def _helper(self, x):\n        return x + 1\n\n\ndef make${i}():\n    return Module${i}()\n`;
}

function java(i, deps) {
  const methods = [];
  for (let m = 0; m < METHODS; m++) {
    const body = [];
    for (let l = 0; l < BODY; l++) {
      const d = deps[(m + l) % deps.length];
      body.push(l % 6 === 0 && d !== undefined ? `        acc += new Module${d}().step${(m + l) % METHODS}(acc + ${l});` : `        acc = (acc * ${l + 3} + ${m}) % 1000003;`);
    }
    methods.push(`    /** Step ${m} of module ${i}. */\n    public long step${m}(long input) {\n        long acc = input;\n${body.join('\n')}\n        return acc;\n    }`);
  }
  return `package com.bench;\n\npublic class Module${i} {\n${methods.join('\n\n')}\n}\n`;
}

function c(i, deps) {
  const fns = [];
  for (let m = 0; m < METHODS; m++) {
    const body = [];
    for (let l = 0; l < BODY; l++) {
      const d = deps[(m + l) % deps.length];
      body.push(l % 6 === 0 && d !== undefined ? `    acc += module${d}_step${(m + l) % METHODS}(acc + ${l});` : `    acc = (acc * ${l + 3} + ${m}) % 1000003;`);
    }
    fns.push(`/* Step ${m} of module ${i}. */\nlong module${i}_step${m}(long input) {\n    long acc = input;\n${body.join('\n')}\n    return acc;\n}`);
  }
  const includes = deps.map((d) => `#include "module${d}.h"`).join('\n');
  return { c: `#include "module${i}.h"\n${includes}\n\n${fns.join('\n\n')}\n`, h: `#ifndef MODULE${i}_H\n#define MODULE${i}_H\n${Array.from({ length: METHODS }, (_, m) => `long module${i}_step${m}(long input);`).join('\n')}\n#endif\n` };
}

let loc = 0;
let i = 0;
const byLang = { ts: [], py: [], java: [], c: [] };
while (loc < targetLoc) {
  const r = i % 10;
  const lang = r < 6 ? 'ts' : r < 8 ? 'py' : r < 9 ? 'java' : 'c';
  const pool = byLang[lang];
  const deps = pool.length ? [...new Set([pool[rand(pool.length)], pool[rand(pool.length)], pool[rand(pool.length)]])] : [];
  let files;
  if (lang === 'ts') files = { [`src/m${i % 20}/module${i}.ts`]: ts(i, deps) };
  else if (lang === 'py') files = { [`pkg/m${i % 20}/module${i}.py`]: py(i, deps), [`pkg/m${i % 20}/__init__.py`]: '' };
  else if (lang === 'java') files = { [`java/src/main/java/com/bench/Module${i}.java`]: java(i, deps) };
  else {
    const g = c(i, deps);
    files = { [`firmware/src/module${i}.c`]: g.c, [`firmware/include/module${i}.h`]: g.h };
  }
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(out, p, '..'), { recursive: true });
    writeFileSync(join(out, p), text);
    loc += text.split('\n').length;
  }
  pool.push(i);
  i++;
}
writeFileSync(join(out, 'CMakeLists.txt'), 'add_library(fw firmware/src/module0.c)\ntarget_include_directories(fw PUBLIC firmware/include)\n');
writeFileSync(join(out, 'pyproject.toml'), '[project]\nname = "pkg"\n');
console.log(JSON.stringify({ out, files: i, loc }));
