import { afterAll, describe, expect, it } from 'vitest';
import { symbolId } from '@riaf/kernel';
import { resolutionStats } from '../src/stats.js';
import { cleanup, copyFixture, indexRepo } from './helpers.js';

afterAll(cleanup);

describe('M1 gate: reference resolution on every fixture repo', () => {
  for (const name of ['toll-ts', 'fleet-java', 'telemetry-py', 'embedded-c']) {
    it(`${name}: resolves at least 95% of resolvable references`, async () => {
      const { store } = await indexRepo(copyFixture(name));
      const s = resolutionStats(store);
      expect(s.resolvable, `${name} should have references`).toBeGreaterThan(5);
      expect(s.rate, JSON.stringify(s.misses, null, 1)).toBeGreaterThanOrEqual(0.95);
      await store.close();
    });
  }
});

describe('cross-language specifics', () => {
  it('java: interface implementation, overrides and test → service edges', async () => {
    const { store, graph } = await indexRepo(copyFixture('fleet-java'));
    const P = 'dispatch/src/main/java/com/fleet/dispatch/';
    const nearest = symbolId(`${P}NearestVehiclePolicy.java`, 'NearestVehiclePolicy', 'class');
    const policy = symbolId(`${P}AssignmentPolicy.java`, 'AssignmentPolicy', 'interface');
    expect(store.edges.outgoing(nearest, 'inherits').map((e) => e.dst)).toContain(policy);
    expect(store.edges.outgoing(symbolId(`${P}NearestVehiclePolicy.java`, 'NearestVehiclePolicy.choose', 'method'), 'overrides').map((e) => e.dst))
      .toContain(symbolId(`${P}AssignmentPolicy.java`, 'AssignmentPolicy.choose', 'method'));
    const assign = symbolId(`${P}DispatchService.java`, 'DispatchService.assign', 'method');
    expect(graph.tests([assign]).some((t) => t.includes('DispatchServiceTest'))).toBe(true);
    // dynamic dispatch: DispatchService.assign calls policy.choose → the override family's call sites
    const { dynamicDispatchSites } = await import('../src/closure.js');
    const sites = dynamicDispatchSites(graph.view(), symbolId(`${P}NearestVehiclePolicy.java`, 'NearestVehiclePolicy.choose', 'method'));
    expect(sites.map((s) => s.symbol)).toContain(assign);
  });

  it('python: method calls through self and module imports', async () => {
    const { store } = await indexRepo(copyFixture('telemetry-py'));
    const submit = symbolId('src/telemetry/pipeline.py', 'Pipeline.submit', 'method');
    expect(store.edges.outgoing(submit, 'invokes').map((e) => e.dst)).toEqual(expect.arrayContaining([
      symbolId('src/telemetry/sampler.py', 'Sampler.accept', 'method'),
      symbolId('src/telemetry/codec.py', 'encode', 'function'),
      symbolId('src/telemetry/buffer.py', 'RingBuffer.push', 'method'),
    ]));
  });

  it('c: calls resolve from implementation files to definitions, includes resolve via CMake', async () => {
    const { store } = await indexRepo(copyFixture('embedded-c'));
    const send = symbolId('src/uart.c', 'uart_send_frame', 'function');
    const dsts = store.edges.outgoing(send, 'invokes').map((e) => e.dst);
    expect(dsts).toContain(symbolId('src/crc.c', 'crc16', 'function'));
    expect(store.imports.byPath('src/uart.c').map((i) => i.resolved)).toEqual(['include/uart.h', 'include/crc.h', 'include/hal.h']);
  });
});
