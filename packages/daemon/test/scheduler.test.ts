import { describe, expect, it } from 'vitest';
import { silentLogger } from '@riaf/kernel';
import { Store } from '@riaf/store';
import { orderStages, Scheduler, type PipelineStage } from '../src/scheduler.js';
import { classifyChange } from '../src/watcher.js';

const stage = (name: string, after: string[] = [], fn: () => Promise<number> = async () => 1): PipelineStage => ({ name, after, run: async () => ({ changed: await fn() }) });

describe('orderStages', () => {
  it('orders by dependencies and rejects cycles', () => {
    expect(orderStages([stage('graph', ['parse']), stage('parse', ['scan']), stage('scan')]).map((s) => s.name)).toEqual(['scan', 'parse', 'graph']);
    expect(() => orderStages([stage('a', ['b']), stage('b', ['a'])])).toThrow(/cycle/);
  });
});

describe('Scheduler', () => {
  it('coalesces triggers that arrive during a run into one follow-up run', async () => {
    const store = await Store.open();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = new Scheduler([stage('scan', [], async () => { runs++; if (runs === 1) await gate; return 1; })], store, '/x', silentLogger);
    const first = s.trigger('a');
    const second = s.trigger('b');
    const third = s.trigger('c');
    release();
    await Promise.all([first, second, third]);
    expect(runs).toBe(2);
    expect(s.last?.reason).toBe('b,c');
  });

  it('records stage errors without stopping later stages', async () => {
    const store = await Store.open();
    const s = new Scheduler([stage('scan'), stage('parse', ['scan'], async () => { throw new Error('boom'); }), stage('graph', ['parse'])], store, '/x', silentLogger);
    const r = await s.trigger('t');
    expect(r.stages.map((x) => [x.stage, x.error ?? null])).toEqual([['scan', null], ['parse', 'boom'], ['graph', null]]);
    expect(s.status().find((x) => x.stage === 'parse')?.lastError).toBe('boom');
  });
});

describe('classifyChange', () => {
  it('separates working-tree edits, git ref moves and ignored paths', () => {
    expect(classifyChange('src/a.ts')).toBe('fs');
    expect(classifyChange('.git/HEAD')).toBe('git');
    expect(classifyChange('.git/refs/heads/main')).toBe('git');
    expect(classifyChange('.git/objects/ab/cdef')).toBeUndefined();
    expect(classifyChange('node_modules/x/index.js')).toBeUndefined();
    expect(classifyChange('.riaf/index.sqlite')).toBeUndefined();
  });
});
