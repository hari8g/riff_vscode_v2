import type { GantryReading } from './reading.js';

/** A physical lane under a gantry; tracks health so a dead camera is not trusted. */
export class Lane {
  private lastReadAt = 0;
  private faults = 0;

  constructor(readonly gantryId: string, readonly id: number, private readonly staleAfterMs = 60_000) {}

  record(r: GantryReading): void {
    if (r.laneId !== this.id || r.gantryId !== this.gantryId) throw new Error('reading for another lane');
    this.lastReadAt = r.at;
  }

  reportFault(): void {
    this.faults += 1;
  }

  /** A lane is healthy when it read recently and has fewer than three open faults. */
  isHealthy(now: number): boolean {
    return now - this.lastReadAt <= this.staleAfterMs && this.faults < 3;
  }

  clearFaults(): void {
    this.faults = 0;
  }
}
