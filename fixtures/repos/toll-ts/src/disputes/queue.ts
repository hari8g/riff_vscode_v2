import type { FeatureFlags } from '../config/flags.js';
import type { Dispute } from './dispute.js';

/** Operator work queue of open disputes, oldest first. */
export class DisputeQueue {
  private readonly items: Dispute[] = [];

  constructor(private readonly flags: FeatureFlags) {}

  enqueue(d: Dispute): boolean {
    if (!this.flags.isEnabled('dispute-queue')) return false;
    if (this.items.some((x) => x.id === d.id)) return false;
    this.items.push(d);
    this.items.sort((a, b) => a.openedAt - b.openedAt);
    return true;
  }

  next(): Dispute | undefined {
    return this.items.find((d) => d.status === 'open');
  }

  resolve(id: string, upheld: boolean, at: number): Dispute {
    const d = this.items.find((x) => x.id === id);
    if (!d) throw new Error(`no dispute ${id}`);
    d.status = upheld ? 'upheld' : 'rejected';
    d.resolvedAt = at;
    return d;
  }

  size(): number {
    return this.items.filter((d) => d.status === 'open').length;
  }
}
