import { describe, expect, it } from 'vitest';
import { PricingEngine } from '../src/pricing/engine.js';
import { applySurcharge, isPeak } from '../src/pricing/peak.js';
import type { GantryReading } from '../src/gantry/reading.js';

const reading = (at: number): GantryReading => ({ gantryId: 'g1', laneId: 1, plate: { text: 'KA01AB1234', region: 'KA' }, confidence: 0.99, at, vehicleClass: 'car' });

describe('PricingEngine', () => {
  it('charges the base car fare off-peak', () => {
    const engine = new PricingEngine({ lastPassageAt: () => undefined });
    expect(engine.quote(reading(Date.UTC(2026, 0, 1, 3)), 'p1')).toBe(9500);
  });

  it('halves the fare for a return trip within 24 hours', () => {
    const at = Date.UTC(2026, 0, 1, 3);
    const engine = new PricingEngine({ lastPassageAt: () => at - 60_000 });
    expect(engine.quote(reading(at), 'p1')).toBe(4750);
  });

  it('adds the peak surcharge inside a window and not at its end hour', () => {
    expect(isPeak(8)?.surchargePercent).toBe(10);
    expect(isPeak(11)).toBeUndefined();
    expect(applySurcharge(1000, isPeak(9))).toBe(1100);
  });
});
