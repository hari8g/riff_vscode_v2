import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/semantic', () => {
  it('is scaffolded for M3', () => {
    expect(PACKAGE).toBe('@riaf/semantic');
    expect(MILESTONE).toBe('M3');
  });
});
