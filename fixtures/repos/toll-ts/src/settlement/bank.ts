import type { SettlementBatch } from './batch.js';

/** Port to the acquiring bank's settlement API. */
export interface BankGateway {
  submit(batch: SettlementBatch): Promise<{ accepted: boolean; reference?: string; reason?: string }>;
}

/** In-memory gateway used in tests and the demo. */
export class FakeBank implements BankGateway {
  readonly submitted: SettlementBatch[] = [];
  constructor(private readonly rejectOver = Number.POSITIVE_INFINITY) {}

  async submit(batch: SettlementBatch) {
    if (batch.totalPaise > this.rejectOver) return { accepted: false, reason: 'limit exceeded' };
    this.submitted.push(batch);
    return { accepted: true, reference: `ref-${this.submitted.length}` };
  }
}
