import type { Ledger } from '../toll/ledger.js';
import type { Clock } from '../util/clock.js';
import type { BankGateway } from './bank.js';
import { makeBatches, type SettlementBatch } from './batch.js';

export interface SettlementReport {
  accepted: SettlementBatch[];
  rejected: { batch: SettlementBatch; reason: string }[];
}

/** Drains the ledger into bank batches; rejected batches are returned for retry. */
export class Settler {
  constructor(private readonly ledger: Ledger, private readonly bank: BankGateway, private readonly clock: Clock, private readonly batchSize = 500) {}

  async settle(): Promise<SettlementReport> {
    const entries = this.ledger.drain();
    const batches = makeBatches('stl', entries, this.batchSize, this.clock.now());
    const report: SettlementReport = { accepted: [], rejected: [] };
    for (const b of batches) {
      const res = await this.bank.submit(b);
      if (res.accepted) report.accepted.push(b);
      else report.rejected.push({ batch: b, reason: res.reason ?? 'unknown' });
    }
    return report;
  }
}
