import { describe, expect, it } from 'vitest';
import { hashBlob, hashTree, hashWith, shortHash } from '../src/hash.js';

describe('hashing', () => {
  it('hashes blobs deterministically', () => {
    expect(hashBlob('hello')).toBe(hashBlob('hello'));
    expect(hashBlob('hello')).not.toBe(hashBlob('hello!'));
    expect(hashBlob('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates domains so equal inputs in different domains differ', () => {
    expect(hashWith('summary', 'x')).not.toBe(hashWith('chunk', 'x'));
    expect(hashWith('d', 'a', 'b')).not.toBe(hashWith('d', 'ab'));
  });

  it('tree hashes are order-independent and change with any child', () => {
    const a = hashBlob('a');
    const b = hashBlob('b');
    const t1 = hashTree([{ name: 'a.ts', hash: a }, { name: 'b.ts', hash: b }]);
    const t2 = hashTree([{ name: 'b.ts', hash: b }, { name: 'a.ts', hash: a }]);
    expect(t1).toBe(t2);
    const t3 = hashTree([{ name: 'a.ts', hash: a }, { name: 'b.ts', hash: hashBlob('b2') }]);
    expect(t3).not.toBe(t1);
    const t4 = hashTree([{ name: 'a.ts', hash: a }, { name: 'c.ts', hash: b }]);
    expect(t4).not.toBe(t1);
  });

  it('short hashes keep a prefix', () => {
    const h = hashBlob('x');
    expect(shortHash(h)).toBe(h.slice(0, 12));
  });
});
