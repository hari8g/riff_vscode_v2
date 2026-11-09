import { describe, expect, it } from 'vitest';
import { TollSession } from '../src/toll/session.js';
import { Ledger } from '../src/toll/ledger.js';
import { FeatureFlags } from '../src/config/flags.js';

describe('TollSession', () => {
  it('charges a valid plate on close', () => {
    const ledger = new Ledger();
    const s = new TollSession('s1', { text: 'KA01AB1234', region: 'KA' }, ledger, new FeatureFlags());
    s.close(5500);
    expect(s.state).toBe('closed');
    expect(ledger.total()).toBe(5500);
  });

  it('marks an invalid plate disputed and never charges', () => {
    const ledger = new Ledger();
    const s = new TollSession('s2', { text: 'BAD', region: 'KA' }, ledger, new FeatureFlags());
    s.close(5500);
    expect(s.state).toBe('disputed');
    expect(ledger.total()).toBe(0);
  });
});
