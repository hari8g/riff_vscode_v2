#!/usr/bin/env node
/**
 * Bundles the shippable artefacts with esbuild. Nothing is fetched at install or run time: the wasm
 * runtimes (sqlite3.wasm, tree-sitter.wasm) and the grammars sit next to each bundle.
 *   node tooling/esbuild/build.mjs cli [outDir] → dist-bundle/riaf.mjs (+ wasm, grammars)
 *   node tooling/esbuild/build.mjs extension  → packages/extension/dist (extension.cjs, webview, riaf CLI)
 * Requires `pnpm build` first only for type-checking; esbuild compiles TypeScript sources directly.
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'packages/parse/package.json'));
const GRAMMARS = ['typescript', 'tsx', 'javascript', 'python', 'java', 'go', 'c', 'cpp', 'c_sharp'];

/** Copies sqlite3.wasm, tree-sitter.wasm and the launch grammars into `dir`. */
export function copyRuntimeAssets(dir) {
  mkdirSync(join(dir, 'grammars'), { recursive: true });
  const sqliteDir = dirname(createRequire(join(root, 'packages/store/package.json')).resolve('@sqlite.org/sqlite-wasm/package.json'));
  copyFileSync(join(sqliteDir, 'dist/sqlite3.wasm'), join(dir, 'sqlite3.wasm'));
  copyFileSync(join(dirname(require.resolve('web-tree-sitter/package.json')), 'tree-sitter.wasm'), join(dir, 'tree-sitter.wasm'));
  const grammarSrc = existsSync(join(root, 'tooling/grammars/tree-sitter-typescript.wasm'))
    ? join(root, 'tooling/grammars')
    : join(dirname(createRequire(join(root, 'package.json')).resolve('tree-sitter-wasms/package.json')), 'out');
  for (const g of GRAMMARS) copyFileSync(join(grammarSrc, `tree-sitter-${g}.wasm`), join(dir, 'grammars', `tree-sitter-${g}.wasm`));
}

// ESM bundles still contain CommonJS (web-tree-sitter): give them require/__dirname/__filename
const banner = `import { createRequire as __riafCreateRequire } from 'node:module'; import { fileURLToPath as __riafToPath } from 'node:url'; import { dirname as __riafDirname } from 'node:path';
const require = __riafCreateRequire(import.meta.url); const __filename = __riafToPath(import.meta.url); const __dirname = __riafDirname(__filename);`;

async function buildCli(outDir = join(root, 'dist-bundle')) {
  rmSync(outDir, { recursive: true, force: true });
  await build({
    entryPoints: [join(root, 'packages/cli/src/main.ts')], outfile: join(outDir, 'riaf.mjs'), bundle: true, platform: 'node', target: 'node20',
    format: 'esm', banner: { js: banner }, sourcemap: false, minify: false, legalComments: 'none',
    external: ['better-sqlite3'], logLevel: 'warning', conditions: ['node'], mainFields: ['module', 'main'],
  });
  copyRuntimeAssets(outDir);
  return outDir;
}

async function buildExtension() {
  const ext = join(root, 'packages/extension');
  const out = join(ext, 'dist');
  rmSync(out, { recursive: true, force: true });
  await build({
    entryPoints: [join(ext, 'src/extension.ts')], outfile: join(out, 'extension.cjs'), bundle: true, platform: 'node', target: 'node20',
    format: 'cjs', external: ['vscode', 'better-sqlite3'], logLevel: 'warning', sourcemap: false,
    // CommonJS has no import.meta; give modules that read import.meta.url a file URL of the bundle
    define: { 'import.meta.url': '__riafImportMetaUrl' }, banner: { js: "const __riafImportMetaUrl = require('url').pathToFileURL(__filename).href;" },
  });
  await build({
    entryPoints: [join(ext, 'webview/main.tsx')], outfile: join(out, 'webview/console.js'), bundle: true, platform: 'browser', target: 'es2022',
    format: 'iife', jsx: 'automatic', minify: true, logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' },
  });
  copyFileSync(join(ext, 'webview/console.css'), join(out, 'webview/console.css'));
  // the daemon/CLI ship inside the extension so nothing is downloaded at install time
  await buildCli(join(out, 'riaf'));
  return out;
}

const what = process.argv[2] ?? 'cli';
if (what === 'cli') console.log(`built ${await buildCli(process.argv[3] ? resolve(process.argv[3]) : undefined)}`);
else if (what === 'extension') console.log(`built ${await buildExtension()}`);
else {
  console.error('usage: build.mjs cli|extension');
  process.exit(2);
}
