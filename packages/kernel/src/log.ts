/** Minimal structured logger. The daemon writes JSON lines; tests use a silent logger. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LogSink {
  (line: { ts: string; level: LogLevel; scope: string; msg: string; fields?: Record<string, unknown> }): void;
}

export function createLogger(scope: string, level: LogLevel = 'info', sink: LogSink = stderrSink): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(fields ? { ts: new Date().toISOString(), level: lvl, scope, msg, fields } : { ts: new Date().toISOString(), level: lvl, scope, msg });
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (s) => createLogger(`${scope}:${s}`, level, sink),
  };
}

export const stderrSink: LogSink = (line) => {
  process.stderr.write(JSON.stringify(line) + '\n');
};

export const silentLogger: Logger = createLogger('silent', 'error', () => undefined);
