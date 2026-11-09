import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/intent', () => {
  it('is scaffolded for M3', () => {
    expect(PACKAGE).toBe('@riaf/intent');
    expect(MILESTONE).toBe('M3');
  });
});
