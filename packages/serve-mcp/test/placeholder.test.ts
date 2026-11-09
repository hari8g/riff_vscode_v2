import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('@riaf/serve-mcp', () => {
  it('is scaffolded for M3', () => {
    expect(PACKAGE).toBe('@riaf/serve-mcp');
    expect(MILESTONE).toBe('M3');
  });
});
