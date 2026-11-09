import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/daemon', () => {
  it('is scaffolded for M1', () => {
    expect(PACKAGE).toBe('@riaf/daemon');
    expect(MILESTONE).toBe('M1');
  });
});
