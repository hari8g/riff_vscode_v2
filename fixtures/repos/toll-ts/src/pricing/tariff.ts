import type { VehicleClass } from '../gantry/reading.js';

/** Base tariff per vehicle class in paise, per plaza. */
export interface Tariff {
  plazaId: string;
  base: Record<VehicleClass, number>;
  /** Discount for a return trip within 24 hours, percent. */
  returnDiscountPercent: number;
}

export const DEFAULT_TARIFF: Tariff = {
  plazaId: 'default',
  base: { car: 9500, lcv: 15000, bus: 31500, truck: 31500, 'multi-axle': 49500 },
  returnDiscountPercent: 50,
};

export function baseFare(t: Tariff, cls: VehicleClass): number {
  const fare = t.base[cls];
  if (fare === undefined) throw new Error(`no tariff for ${cls}`);
  return fare;
}
