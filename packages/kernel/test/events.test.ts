import { describe, expect, it } from 'vitest';
import { EventBus, type PipelineEvents } from '../src/events.js';

describe('EventBus', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const bus = new EventBus<PipelineEvents>();
    const seen: string[] = [];
    const off = bus.on('stage:start', (p) => seen.push(p.stage));
    bus.emit('stage:start', { stage: 'parse', pending: 3 });
    off();
    bus.emit('stage:start', { stage: 'graph', pending: 1 });
    expect(seen).toEqual(['parse']);
    expect(bus.listenerCount('stage:start')).toBe(0);
  });

  it('once fires a single time and a throwing listener does not break others', () => {
    const bus = new EventBus<PipelineEvents>();
    let count = 0;
    bus.once('stage:end', () => count++);
    bus.on('stage:end', () => {
      throw new Error('boom');
    });
    let other = 0;
    bus.on('stage:end', () => other++);
    bus.emit('stage:end', { stage: 'x', changed: 0, ms: 1 });
    bus.emit('stage:end', { stage: 'x', changed: 0, ms: 1 });
    expect(count).toBe(1);
    expect(other).toBe(2);
  });
});
