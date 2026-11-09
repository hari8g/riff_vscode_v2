import { describe, expect, it } from 'vitest';
import { FakeBank } from '../src/settlement/bank.js';
import { makeBatches } from '../src/settlement/batch.js';
import { Settler } from '../src/settlement/settler.js';
import { Ledger } from '../src/toll/ledger.js';
import { FixedClock } from '../src/util/clock.js';

describe('settlement', () => {
  it('batches entries without losing any', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ sessionId: `s${i}`, amountPaise: 100, at: i }));
    const batches = makeBatches('b', entries, 2, 0);
    expect(batches.map((b) => b.entries.length)).toEqual([2, 2, 1]);
    expect(batches.reduce((a, b) => a + b.totalPaise, 0)).toBe(500);
  });

  it('drains the ledger and reports rejected batches', async () => {
    const ledger = new Ledger();
    ledger.post('s1', 100);
    ledger.post('s2', 200);
    const report = await new Settler(ledger, new FakeBank(150), new FixedClock(0), 1).settle();
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected[0]?.reason).toBe('limit exceeded');
    expect(ledger.total()).toBe(0);
  });
});
