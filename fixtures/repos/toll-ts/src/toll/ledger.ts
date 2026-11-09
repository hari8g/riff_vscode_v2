export interface LedgerEntry {
  sessionId: string;
  amountPaise: number;
  at: number;
}

/** In-memory ledger with retry-aware posting; real one talks to the settlement service. */
export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  private readonly maxRetries = 3;

  post(sessionId: string, amountPaise: number): void {
    if (amountPaise <= 0) throw new Error('amount must be positive');
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (this.tryWrite({ sessionId, amountPaise, at: Date.now() })) return;
    }
    throw new Error(`ledger post failed after ${this.maxRetries} retries`);
  }

  private tryWrite(e: LedgerEntry): boolean {
    this.entries.push(e);
    return true;
  }

  /** Removes and returns every entry (settlement takes ownership). */
  drain(): LedgerEntry[] {
    return this.entries.splice(0, this.entries.length);
  }

  total(): number {
    return this.entries.reduce((a, e) => a + e.amountPaise, 0);
  }
}
