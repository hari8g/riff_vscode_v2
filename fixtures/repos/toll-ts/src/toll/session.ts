import { FeatureFlags } from '../config/flags.js';
import { validatePlate, type Plate } from './plate.js';
import { Ledger } from './ledger.js';

export type SessionState = 'open' | 'closed' | 'disputed';

/** One vehicle passage through a multi-lane free-flow gantry. */
export class TollSession {
  state: SessionState = 'open';
  readonly openedAt = Date.now();
  closedAt?: number;

  constructor(
    readonly id: string,
    readonly plate: Plate,
    private readonly ledger: Ledger,
    private readonly flags: FeatureFlags,
  ) {}

  /** Closes the session and posts the charge; a disputed plate never charges. */
  close(amountPaise: number): void {
    if (this.state !== 'open') return;
    if (!validatePlate(this.plate)) {
      this.state = 'disputed';
      return;
    }
    if (this.flags.isEnabled('charge-on-close')) {
      this.ledger.post(this.id, amountPaise);
    }
    this.closedAt = Date.now();
    this.state = 'closed';
  }

  durationMs(): number {
    return (this.closedAt ?? Date.now()) - this.openedAt;
  }
}
