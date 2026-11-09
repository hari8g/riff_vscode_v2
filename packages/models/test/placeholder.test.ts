import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/models', () => {
  it('is scaffolded for M3', () => {
    expect(PACKAGE).toBe('@riaf/models');
    expect(MILESTONE).toBe('M3');
  });
});
