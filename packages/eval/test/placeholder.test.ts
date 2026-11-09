import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/eval', () => {
  it('is scaffolded for M2', () => {
    expect(PACKAGE).toBe('@riaf/eval');
    expect(MILESTONE).toBe('M2');
  });
});
