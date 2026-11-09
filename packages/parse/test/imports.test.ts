import { describe, expect, it } from 'vitest';
import { buildResolverContext, parseJsonc, resolveImport } from '../src/imports.js';

const files: Record<string, string> = {
  'tsconfig.json': '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] }, } }',
  'src/toll/session.ts': '', 'src/toll/plate.ts': '', 'src/config/index.ts': '', 'src/ui/view.tsx': '',
  'packages/core/package.json': '{ "name": "@acme/core" }', 'packages/core/src/index.ts': '', 'packages/core/src/util/math.ts': '',
  'pyproject.toml': '', 'src/telemetry/__init__.py': '', 'src/telemetry/codec.py': '', 'src/telemetry/buffer.py': '', 'src/telemetry/sub/x.py': '',
  'svc/src/main/java/com/fleet/model/Vehicle.java': '', 'svc/src/main/java/com/fleet/dispatch/DispatchService.java': '',
  'go.mod': 'module github.com/acme/meter\n\ngo 1.22\n', 'codec/codec.go': '', 'codec/codec_test.go': '', 'codec/table.go': '',
  'fw/CMakeLists.txt': 'add_library(fw src/uart.c)\ntarget_include_directories(fw PUBLIC include ${CMAKE_CURRENT_SOURCE_DIR}/hal)', 'fw/include/uart.h': '', 'fw/hal/hal.h': '', 'fw/src/uart.c': '', 'fw/src/local.h': '',
};
const ctx = buildResolverContext(Object.keys(files), (p) => files[p]);

describe('resolveImport', () => {
  it('typescript: relative with .js extension, index files, tsconfig paths, workspace packages', () => {
    expect(resolveImport(ctx, 'src/toll/session.ts', './plate.js', 'typescript')).toEqual(['src/toll/plate.ts']);
    expect(resolveImport(ctx, 'src/toll/session.ts', '../config', 'typescript')).toEqual(['src/config/index.ts']);
    expect(resolveImport(ctx, 'src/toll/session.ts', '@app/ui/view', 'typescript')).toEqual(['src/ui/view.tsx']);
    expect(resolveImport(ctx, 'src/toll/session.ts', '@acme/core', 'typescript')).toEqual(['packages/core/src/index.ts']);
    expect(resolveImport(ctx, 'src/toll/session.ts', '@acme/core/util/math', 'typescript')).toEqual(['packages/core/src/util/math.ts']);
    expect(resolveImport(ctx, 'src/toll/session.ts', 'zod', 'typescript')).toEqual([]);
  });
  it('python: relative and absolute from src roots', () => {
    expect(resolveImport(ctx, 'src/telemetry/sub/x.py', '..codec', 'python')).toEqual(['src/telemetry/codec.py']);
    expect(resolveImport(ctx, 'src/telemetry/codec.py', '.buffer', 'python')).toEqual(['src/telemetry/buffer.py']);
    expect(resolveImport(ctx, 'src/telemetry/codec.py', 'telemetry', 'python')).toEqual(['src/telemetry/__init__.py']);
    expect(resolveImport(ctx, 'src/telemetry/codec.py', 'telemetry.buffer', 'python')).toEqual(['src/telemetry/buffer.py']);
    expect(resolveImport(ctx, 'src/telemetry/codec.py', 'numpy', 'python')).toEqual([]);
  });
  it('java: packages by suffix, wildcards', () => {
    expect(resolveImport(ctx, 'x.java', 'com.fleet.model.Vehicle', 'java')).toEqual(['svc/src/main/java/com/fleet/model/Vehicle.java']);
    expect(resolveImport(ctx, 'x.java', 'com.fleet.model.*', 'java')).toEqual(['svc/src/main/java/com/fleet/model/Vehicle.java']);
    expect(resolveImport(ctx, 'x.java', 'java.util.List', 'java')).toEqual([]);
  });
  it('go: module-relative package directories without tests', () => {
    expect(resolveImport(ctx, 'main.go', 'github.com/acme/meter/codec', 'go')).toEqual(['codec/codec.go', 'codec/table.go']);
    expect(resolveImport(ctx, 'main.go', 'fmt', 'go')).toEqual([]);
  });
  it('c: same directory, CMake include directories, system headers', () => {
    expect(resolveImport(ctx, 'fw/src/uart.c', 'local.h', 'c')).toEqual(['fw/src/local.h']);
    expect(resolveImport(ctx, 'fw/src/uart.c', 'uart.h', 'c')).toEqual(['fw/include/uart.h']);
    expect(resolveImport(ctx, 'fw/src/uart.c', 'hal.h', 'c', true)).toEqual(['fw/hal/hal.h']);
    expect(resolveImport(ctx, 'fw/src/uart.c', 'stdint.h', 'c', true)).toEqual([]);
  });
  it('parseJsonc tolerates comments and trailing commas', () => {
    expect(parseJsonc('{ /* a */ "x": [1, 2,], // b\n "y": "//not a comment", }')).toEqual({ x: [1, 2], y: '//not a comment' });
  });
});
