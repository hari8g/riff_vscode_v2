import { createHash } from 'node:crypto';
import type { BlobHash, TreeHash } from './ids.js';

/** SHA-256 of a blob's bytes or text, hex. Content-addresses every cached stage output. */
export function hashBlob(content: string | Uint8Array): BlobHash {
  return createHash('sha256').update(content).digest('hex') as BlobHash;
}

/** SHA-256 of a UTF-8 string with a domain prefix, so hashes of different kinds never collide. */
export function hashWith(domain: string, ...parts: string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('\u0000');
    h.update(p);
  }
  return h.digest('hex');
}

export interface MerkleChild {
  name: string;
  hash: BlobHash | TreeHash;
}

/**
 * Combines sorted child (name, hash) pairs into a directory hash — the Merkle step.
 * Order-independent: children are sorted by name before hashing, as git does for trees.
 */
export function hashTree(children: readonly MerkleChild[]): TreeHash {
  const sorted = [...children].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const h = createHash('sha256');
  h.update('tree');
  for (const c of sorted) {
    h.update('\u0000');
    h.update(c.name);
    h.update('\u0001');
    h.update(c.hash);
  }
  return h.digest('hex') as TreeHash;
}

/** Short prefix for logs and ids in human-facing output. */
export function shortHash(hash: string, n = 12): string {
  return hash.slice(0, n);
}
