/** A tiny argv parser: positionals, `--flag value`, `--flag=value`, boolean `--flag`, and `--no-flag`. */

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

/** Parses argv after the binary; `booleans` lists flags that never take a value. */
export function parseArgs(argv: readonly string[], booleans: ReadonlySet<string> = new Set()): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const name = a.slice(2);
      if (name.startsWith('no-')) {
        flags.set(name.slice(3), false);
        continue;
      }
      const next = argv[i + 1];
      if (!booleans.has(name) && next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i++;
      } else flags.set(name, true);
    } else if (a.startsWith('-') && a.length === 2) {
      flags.set(a.slice(1), true);
    } else positionals.push(a);
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/** String flag value, or `fallback`. */
export function str(p: ParsedArgs, name: string, fallback?: string): string | undefined {
  const v = p.flags.get(name);
  return typeof v === 'string' ? v : fallback;
}

/** Integer flag value, or `fallback`; throws on garbage. */
export function int(p: ParsedArgs, name: string, fallback?: number): number | undefined {
  const v = p.flags.get(name);
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} expects an integer, got ${v}`);
  return n;
}

export function bool(p: ParsedArgs, name: string, fallback = false): boolean {
  const v = p.flags.get(name);
  return typeof v === 'boolean' ? v : v === undefined ? fallback : v !== 'false';
}
