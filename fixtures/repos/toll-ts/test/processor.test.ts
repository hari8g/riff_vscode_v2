import { describe, expect, it } from 'vitest';
import { FeatureFlags } from '../src/config/flags.js';
import { MemoryNotifier } from '../src/notify/notifier.js';
import { PricingEngine } from '../src/pricing/engine.js';
import { Ledger } from '../src/toll/ledger.js';
import { PassageProcessor } from '../src/toll/processor.js';
import { SessionStore } from '../src/toll/store.js';

const make = () => {
  const ledger = new Ledger();
  const notifier = new MemoryNotifier();
  const p = new PassageProcessor(new SessionStore(), ledger, new PricingEngine({ lastPassageAt: () => undefined }), new FeatureFlags(), notifier, 'plaza-1');
  return { p, ledger, notifier };
};

describe('PassageProcessor', () => {
  it('charges and notifies a trusted reading', async () => {
    const { p, ledger, notifier } = make();
    const s = await p.process({ gantryId: 'g', laneId: 1, plate: { text: 'ka 01 ab 1234', region: 'KA' }, confidence: 0.97, at: Date.UTC(2026, 0, 1, 3), vehicleClass: 'car' });
    expect(s?.state).toBe('closed');
    expect(ledger.total()).toBe(9500);
    expect(notifier.sent[0]?.message).toContain('₹95.00');
  });

  it('sends low-confidence reads to manual review', async () => {
    const { p } = make();
    expect(await p.process({ gantryId: 'g', laneId: 1, plate: { text: 'KA01AB1234', region: 'KA' }, confidence: 0.5, at: 0, vehicleClass: 'car' })).toBeUndefined();
    expect(p.manualReview).toHaveLength(1);
  });
});
