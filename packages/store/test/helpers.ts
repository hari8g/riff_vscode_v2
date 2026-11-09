import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { estimateTokens, hashBlob } from '@riaf/kernel';
import type { BlobRecord } from '../src/merkle.js';
import type { ChunkRecord } from '../src/repo.js';

export const FIXTURE_ROOT = resolve(__dirname, '../../../fixtures/repos/toll-ts');

export interface FixtureFile {
  path: string;
  content: string;
  blob: BlobRecord;
}

/** Walks the toll-ts fixture and returns repo-relative files with their blob records. */
export function readFixture(root = FIXTURE_ROOT): FixtureFile[] {
  const out: FixtureFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.riaf') continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const content = readFileSync(full, 'utf8');
        const path = relative(root, full).replace(/\\/g, '/');
        out.push({ path, content, blob: { path, hash: hashBlob(content), size: st.size, mtimeMs: st.mtimeMs, lang: name.endsWith('.ts') ? 'typescript' : undefined } as BlobRecord });
      }
    }
  };
  walk(root);
  return out;
}

/** Naive fixed-size line chunker (the real AST chunker arrives with @riaf/parse in M1). */
export function lineChunks(file: FixtureFile, linesPerChunk = 25): ChunkRecord[] {
  const lines = file.content.split('\n');
  const chunks: ChunkRecord[] = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk);
    const content = slice.join('\n');
    chunks.push({
      id: `${file.path}:${i + 1}`,
      path: file.path,
      startLine: i + 1,
      endLine: i + slice.length,
      blobHash: file.blob.hash,
      tokens: estimateTokens(content),
      content,
    });
  }
  return chunks;
}
