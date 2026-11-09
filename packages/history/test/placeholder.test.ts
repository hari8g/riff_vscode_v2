import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/history', () => {
  it('is scaffolded for M4', () => {
    expect(PACKAGE).toBe('@riaf/history');
    expect(MILESTONE).toBe('M4');
  });
});
