import type { Plate } from '../toll/plate.js';

/** One ANPR read from a gantry camera. */
export interface GantryReading {
  gantryId: string;
  laneId: number;
  plate: Plate;
  /** Camera confidence in [0, 1]. */
  confidence: number;
  at: number;
  vehicleClass: VehicleClass;
}

export type VehicleClass = 'car' | 'lcv' | 'bus' | 'truck' | 'multi-axle';

/** Reads below this confidence go to manual review instead of auto-charging. */
export const MIN_CONFIDENCE = 0.85;

export function isTrusted(r: GantryReading): boolean {
  return r.confidence >= MIN_CONFIDENCE;
}
