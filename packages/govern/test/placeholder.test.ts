import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/govern', () => {
  it('is scaffolded for M5', () => {
    expect(PACKAGE).toBe('@riaf/govern');
    expect(MILESTONE).toBe('M5');
  });
});
