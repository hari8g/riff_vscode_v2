import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { findRoot } from '../src/connect.js';
import { memoryIo } from '../src/io.js';
import { runCli } from '../src/run.js';

const REPO = resolve(__dirname, '../../..');
const dirs: string[] = [];
const copy = (name: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `riaf-cli-${name}-`)));
  dirs.push(d);
  cpSync(join(REPO, 'fixtures/repos', name), d, { recursive: true });
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('parseArgs', () => {
  it('handles positionals, values, booleans, = and --no-', () => {
    const p = parseArgs(['jump', 'Foo.bar', '--root', '/r', '--json', '--hops=3', '--no-watch', '-v'], new Set(['json']));
    expect(p.command).toBe('jump');
    expect(p.positionals).toEqual(['Foo.bar']);
    expect(Object.fromEntries(p.flags)).toEqual({ root: '/r', json: true, hops: '3', watch: false, v: true });
  });
});

describe('riaf CLI (in-process)', () => {
  it('index, status, jump, impact on fleet-java', async () => {
    const root = copy('fleet-java');
    const io = memoryIo(root);
    expect(await runCli(['index', '--in-process'], io)).toBe(0);
    expect(io.stdout.at(-1)).toMatch(/indexed \d+ files, \d+ symbols, \d+ edges/);

    const j = memoryIo(root);
    expect(await runCli(['jump', 'NearestVehiclePolicy.choose', '--in-process'], j)).toBe(0);
    expect(j.stdout[0]).toMatch(/^NearestVehiclePolicy\.choose\s+method\s+dispatch\/src\/main\/java\/com\/fleet\/dispatch\/NearestVehiclePolicy\.java:\d+-\d+/);

    const i = memoryIo(root);
    expect(await runCli(['impact', 'GeoUtil.distanceKm', '--in-process', '--json'], i)).toBe(0);
    const impact = JSON.parse(i.stdout.join('\n'));
    expect(impact.closure.map((c: { symbol: string }) => c.symbol)).toContain('dispatch/src/main/java/com/fleet/dispatch/NearestVehiclePolicy.java#NearestVehiclePolicy.choose@method');

    const miss = memoryIo(root);
    expect(await runCli(['jump', 'NoSuchThingAnywhere', '--in-process'], miss)).toBe(1);
    expect(await runCli(['bogus'], memoryIo(root))).toBe(2);
    expect(existsSync(join(root, '.riaf/index.sqlite'))).toBe(true); // in-process sessions persist on close
  });

  it('findRoot walks up to the nearest .riaf or .git', () => {
    const root = copy('toll-ts');
    rmSync(join(root, '.riaf'), { recursive: true, force: true });
    cpSync(join(REPO, '.riaf'), join(root, '.riaf'), { recursive: true });
    expect(findRoot(join(root, 'src/toll'))).toBe(root);
  });
});

describe('riaf binary with a real daemon', () => {
  it('auto-starts the daemon on jump, then stops it', async () => {
    const root = copy('telemetry-py');
    const bin = resolve(__dirname, '../dist/main.js');
    const out = execFileSync(process.execPath, [bin, 'jump', 'Pipeline.flush', '--root', root], { encoding: 'utf8', timeout: 60_000 });
    expect(out).toMatch(/^Pipeline\.flush\s+method\s+src\/telemetry\/pipeline\.py/);
    const status = JSON.parse(execFileSync(process.execPath, [bin, 'status', '--root', root, '--json'], { encoding: 'utf8', timeout: 30_000 }));
    expect(status.symbols).toBeGreaterThan(10);
    const info = JSON.parse(execFileSync('cat', [join(root, '.riaf/daemon.json')], { encoding: 'utf8' }));
    process.kill(info.pid, 'SIGTERM');
    // wait for the daemon to finish its shutdown (it persists the index) before the temp dir goes
    const alive = () => {
      try {
        process.kill(info.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
  }, 60_000);
});
