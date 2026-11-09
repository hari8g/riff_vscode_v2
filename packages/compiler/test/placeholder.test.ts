import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/compiler', () => {
  it('is scaffolded for M3', () => {
    expect(PACKAGE).toBe('@riaf/compiler');
    expect(MILESTONE).toBe('M3');
  });
});
