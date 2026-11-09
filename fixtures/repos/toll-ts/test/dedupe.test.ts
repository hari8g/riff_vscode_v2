import { describe, expect, it } from 'vitest';
import { ReadingDeduper } from '../src/gantry/dedupe.js';
import type { GantryReading } from '../src/gantry/reading.js';

const r = (laneId: number, at: number, confidence: number): GantryReading => ({ gantryId: 'g', laneId, plate: { text: 'KA01AB1234', region: 'KA' }, confidence, at, vehicleClass: 'car' });

describe('ReadingDeduper', () => {
  it('drops a less confident duplicate from the adjacent lane', () => {
    const d = new ReadingDeduper(2000);
    expect(d.accept(r(1, 0, 0.95))).toBeDefined();
    expect(d.accept(r(2, 500, 0.9))).toBeUndefined();
  });

  it('keeps reads outside the window', () => {
    const d = new ReadingDeduper(2000);
    d.accept(r(1, 0, 0.95));
    expect(d.accept(r(1, 5000, 0.9))).toBeDefined();
  });
});
