import type { LedgerEntry } from '../toll/ledger.js';

/** A settlement batch sent to the acquiring bank. */
export interface SettlementBatch {
  id: string;
  entries: LedgerEntry[];
  totalPaise: number;
  createdAt: number;
}

/** Groups entries into batches of at most `maxEntries`, preserving order. */
export function makeBatches(idPrefix: string, entries: readonly LedgerEntry[], maxEntries: number, now: number): SettlementBatch[] {
  if (maxEntries <= 0) throw new Error('maxEntries must be positive');
  const out: SettlementBatch[] = [];
  for (let i = 0; i < entries.length; i += maxEntries) {
    const slice = entries.slice(i, i + maxEntries);
    out.push({ id: `${idPrefix}-${out.length + 1}`, entries: slice, totalPaise: slice.reduce((a, e) => a + e.amountPaise, 0), createdAt: now });
  }
  return out;
}
