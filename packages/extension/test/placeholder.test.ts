import { describe, expect, it } from 'vitest';
import { MILESTONE, PACKAGE } from '../src/index.js';

describe('riaf-vscode-v2', () => {
  it('is scaffolded for M6', () => {
    expect(PACKAGE).toBe('riaf-vscode-v2');
    expect(MILESTONE).toBe('M6');
  });
});
