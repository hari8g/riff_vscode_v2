/** Injectable clock so pricing windows and timeouts are testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class FixedClock implements Clock {
  constructor(private at: number) {}
  now(): number {
    return this.at;
  }
  advance(ms: number): void {
    this.at += ms;
  }
}
