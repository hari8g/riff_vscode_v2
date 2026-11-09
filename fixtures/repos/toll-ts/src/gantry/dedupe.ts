import type { GantryReading } from './reading.js';

/**
 * Adjacent lanes often read the same vehicle twice. Reads of the same plate at the same gantry within
 * the window are merged, keeping the most confident one.
 */
export class ReadingDeduper {
  private readonly recent = new Map<string, GantryReading>();

  constructor(private readonly windowMs = 2_000) {}

  /** Returns the reading to keep, or undefined when it duplicates a better recent read. */
  accept(r: GantryReading): GantryReading | undefined {
    const key = `${r.gantryId}:${r.plate.text}`;
    const prev = this.recent.get(key);
    if (prev && r.at - prev.at <= this.windowMs) {
      if (r.confidence > prev.confidence) {
        this.recent.set(key, r);
        return r;
      }
      return undefined;
    }
    this.recent.set(key, r);
    return r;
  }

  prune(now: number): void {
    for (const [k, r] of this.recent) if (now - r.at > this.windowMs) this.recent.delete(k);
  }
}
