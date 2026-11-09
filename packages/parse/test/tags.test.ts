import { describe, expect, it } from 'vitest';
import { extractTags, unquote } from '../src/treesitter/tags.js';

const names = (defs: { qualifiedName: string; kind: string }[]) => defs.map((d) => `${d.qualifiedName}@${d.kind}`);

describe('extractTags', () => {
  it('typescript: classes, methods, arrow functions, interfaces, imports, refs, tests', async () => {
    const src = [
      "import { Ledger } from './ledger.js';",
      "import type { Plate } from './plate';",
      '',
      '/** One passage. */',
      'export class TollSession extends Base implements Closable {',
      '  state: string = "open";',
      '  close(amount: number): void {',
      '    this.ledger.post(this.id, amount);',
      '    validatePlate(this.plate);',
      '  }',
      '}',
      'export interface Closable { close(amount: number): void }',
      'export const makeSession = (id: string): TollSession => new TollSession(id);',
      "describe('TollSession', () => { it('closes once', () => { expect(1).toBe(1); }); });",
    ].join('\n');
    const t = await extractTags('typescript', 'src/toll/session.ts', src);
    expect(names(t.defs)).toEqual(expect.arrayContaining([
      'TollSession@class', 'TollSession.state@property', 'TollSession.close@method', 'Closable@interface',
      'Closable.close@method', 'makeSession@function', 'TollSession@test', 'TollSession > closes once@test',
    ]));
    const cls = t.defs.find((d) => d.qualifiedName === 'TollSession' && d.kind === 'class')!;
    expect(cls.startLine).toBe(5);
    expect(cls.endLine).toBe(11);
    expect(cls.doc).toBe('One passage.');
    expect(cls.signature).toBe('export class TollSession extends Base implements Closable');
    expect(t.defs.find((d) => d.qualifiedName === 'TollSession.close')!.signature).toBe('close(amount: number): void');
    expect(t.imports.map((i) => i.spec)).toEqual(['./ledger.js', './plate']);
    expect(t.refs).toEqual(expect.arrayContaining([
      { kind: 'call', name: 'post', line: 8, scope: 'TollSession.close' },
      { kind: 'call', name: 'validatePlate', line: 9, scope: 'TollSession.close' },
      { kind: 'inherit', name: 'Base', line: 5, scope: 'TollSession' },
      { kind: 'inherit', name: 'Closable', line: 5, scope: 'TollSession' },
      { kind: 'new', name: 'TollSession', line: 13, scope: 'makeSession' },
    ]));
  });

  it('python: classes, methods, docstrings, test functions, imports', async () => {
    const src = [
      'from .buffer import RingBuffer',
      'import telemetry.codec as codec',
      '',
      'class Sampler(Base):',
      '    """Samples a stream."""',
      '    def sample(self, x):',
      '        return codec.encode(RingBuffer(x))',
      '',
      'def test_sampler():',
      '    Sampler().sample(1)',
    ].join('\n');
    const t = await extractTags('python', 'tests/test_sampler.py', src);
    expect(names(t.defs)).toEqual(['Sampler@class', 'Sampler.sample@method', 'test_sampler@test']);
    expect(t.defs[0]!.doc).toBe('Samples a stream.');
    expect(t.imports.map((i) => i.spec)).toEqual(['.buffer', 'telemetry.codec']);
    expect(t.refs.map((r) => `${r.kind}:${r.name}`)).toEqual(expect.arrayContaining(['inherit:Base', 'call:encode', 'call:RingBuffer', 'call:sample', 'call:Sampler']));
  });

  it('java: classes, constructors, annotated tests, imports', async () => {
    const src = [
      'package com.fleet.dispatch;',
      'import com.fleet.model.Vehicle;',
      'public class DispatchService extends BaseService implements Dispatcher {',
      '  private final VehicleRepo repo;',
      '  public DispatchService(VehicleRepo repo) { this.repo = repo; }',
      '  public Vehicle assign(String id) { return repo.find(id); }',
      '  @Test void assignsVehicle() { new DispatchService(null).assign("x"); }',
      '}',
    ].join('\n');
    const t = await extractTags('java', 'src/main/java/com/fleet/dispatch/DispatchService.java', src);
    expect(names(t.defs)).toEqual(expect.arrayContaining([
      'DispatchService@class', 'DispatchService.repo@field', 'DispatchService.DispatchService@constructor',
      'DispatchService.assign@method', 'DispatchService.assignsVehicle@test',
    ]));
    expect(t.imports[0]!.spec).toBe('com.fleet.model.Vehicle');
    expect(t.refs.map((r) => `${r.kind}:${r.name}`)).toEqual(expect.arrayContaining(['inherit:BaseService', 'inherit:Dispatcher', 'call:find', 'new:DispatchService', 'type:VehicleRepo']));
  });

  it('go: receiver-qualified methods, structs, tests', async () => {
    const src = [
      'package meter',
      'import "github.com/x/meter/codec"',
      'type Meter struct { n int }',
      'func (m *Meter) Read() int { return codec.Decode(m.n) }',
      'func New() *Meter { return &Meter{} }',
      'func TestRead(t *testing.T) { New().Read() }',
    ].join('\n');
    const t = await extractTags('go', 'meter/meter_test.go', src);
    expect(names(t.defs)).toEqual(['Meter@struct', 'Meter.Read@method', 'New@function', 'TestRead@test']);
    expect(t.imports[0]!.spec).toBe('github.com/x/meter/codec');
  });

  it('c and cpp: functions, structs, includes', async () => {
    const c = await extractTags('c', 'src/uart.c', '#include "uart.h"\n#include <stdint.h>\nstruct uart { int fd; };\nint uart_write(struct uart *u, int b) { return hal_put(u->fd, b); }\n');
    expect(names(c.defs)).toEqual(['uart@struct', 'uart_write@function']);
    expect(c.imports).toEqual([{ spec: 'uart.h', line: 1 }, { spec: 'stdint.h', line: 2, system: true }]);
    expect(c.refs.map((r) => r.name)).toContain('hal_put');
    const cpp = await extractTags('cpp', 'src/bus.cpp', 'namespace hw { class Bus : public Device { public: void send(int x); }; }\nvoid hw::Bus::send(int x) { flush(); }\n');
    expect(names(cpp.defs)).toEqual(expect.arrayContaining(['hw@namespace', 'hw.Bus@class', 'hw.Bus.send@method']));
  });

  it('csharp: namespaces, classes, methods', async () => {
    const t = await extractTags('csharp', 'src/Gate.cs', 'using System.Text;\nnamespace Toll { public class Gate : IGate { public void Open() { Log("x"); } } }\n');
    expect(names(t.defs)).toEqual(['Toll@namespace', 'Toll.Gate@class', 'Toll.Gate.Open@method']);
    expect(t.imports[0]!.spec).toBe('System.Text');
  });

  it('unquote strips quotes and angle brackets', () => {
    expect(unquote('"a"')).toBe('a');
    expect(unquote("'a'")).toBe('a');
    expect(unquote('<stdio.h>')).toBe('stdio.h');
    expect(unquote('a.b')).toBe('a.b');
  });
});
