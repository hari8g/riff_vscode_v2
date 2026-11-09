import type { SqliteDriver } from './types.js';
import { WasmDriver } from './wasm.js';
import { NativeDriver, isNativeAvailable } from './native.js';

export interface OpenDriverOptions {
  /** `auto` prefers native when importable and a path is given; otherwise wasm. */
  driver?: 'wasm' | 'native' | 'auto';
  /** Omit for an in-memory database (tests). */
  path?: string;
}

export async function openDriver(opts: OpenDriverOptions = {}): Promise<SqliteDriver> {
  const want = opts.driver ?? 'wasm';
  if (want === 'native' || (want === 'auto' && opts.path && (await isNativeAvailable()))) {
    if (!opts.path) throw new Error('native driver needs a path');
    return NativeDriver.open(opts.path);
  }
  return WasmDriver.open(opts.path);
}

export { WasmDriver, NativeDriver, isNativeAvailable };
