import { describe, expect, it } from 'vitest';
import { FeatureFlags } from '../src/config/flags.js';
import { DisputeQueue } from '../src/disputes/queue.js';

describe('DisputeQueue', () => {
  it('rejects disputes while the flag is off', () => {
    const q = new DisputeQueue(new FeatureFlags([]));
    expect(q.enqueue({ id: 'd1', sessionId: 's', reason: 'other', status: 'open', openedAt: 1 })).toBe(false);
  });

  it('serves the oldest open dispute first', () => {
    const q = new DisputeQueue(new FeatureFlags(['dispute-queue']));
    q.enqueue({ id: 'd2', sessionId: 's', reason: 'other', status: 'open', openedAt: 5 });
    q.enqueue({ id: 'd1', sessionId: 's', reason: 'other', status: 'open', openedAt: 1 });
    expect(q.next()?.id).toBe('d1');
    q.resolve('d1', true, 9);
    expect(q.size()).toBe(1);
  });
});
