import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('riaf', () => {
  it('is scaffolded for M1', () => {
    expect(PACKAGE).toBe('riaf');
    expect(MILESTONE).toBe('M1');
  });
});
