import type { GantryReading } from '../gantry/reading.js';
import { discount } from '../util/money.js';
import { applySurcharge, isPeak } from './peak.js';
import { baseFare, DEFAULT_TARIFF, type Tariff } from './tariff.js';

/** Previous passage of the same plate, for return-trip discounts. */
export interface PassageHistory {
  lastPassageAt(plate: string, plazaId: string): number | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Computes the charge for one trusted reading. */
export class PricingEngine {
  constructor(private readonly history: PassageHistory, private readonly tariff: Tariff = DEFAULT_TARIFF) {}

  quote(r: GantryReading, plazaId: string): number {
    let fare = baseFare(this.tariff, r.vehicleClass);
    const last = this.history.lastPassageAt(r.plate.text, plazaId);
    if (last !== undefined && r.at - last <= DAY_MS) fare = discount(fare, this.tariff.returnDiscountPercent);
    const hour = new Date(r.at).getUTCHours();
    return applySurcharge(fare, isPeak(hour));
  }
}
