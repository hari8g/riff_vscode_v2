import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/parse', () => {
  it('is scaffolded for M1', () => {
    expect(PACKAGE).toBe('@riaf/parse');
    expect(MILESTONE).toBe('M1');
  });
});
