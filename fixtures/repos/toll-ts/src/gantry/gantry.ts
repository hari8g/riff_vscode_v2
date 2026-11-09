import { Lane } from './lane.js';
import type { GantryReading } from './reading.js';

/** A gantry spanning several lanes at one plaza. */
export class Gantry {
  private readonly lanes = new Map<number, Lane>();

  constructor(readonly id: string, readonly plazaId: string, laneCount: number) {
    for (let i = 1; i <= laneCount; i++) this.lanes.set(i, new Lane(id, i));
  }

  lane(id: number): Lane {
    const l = this.lanes.get(id);
    if (!l) throw new Error(`gantry ${this.id} has no lane ${id}`);
    return l;
  }

  ingest(r: GantryReading): void {
    this.lane(r.laneId).record(r);
  }

  healthyLanes(now: number): number[] {
    return [...this.lanes.values()].filter((l) => l.isHealthy(now)).map((l) => l.id);
  }
}
