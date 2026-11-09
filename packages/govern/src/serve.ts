import type { Store } from '@riaf/store';

/**
 * Answers raw search tools from the index when that is cheaper than running them: Grep from the
 * trigram index (literal or regex with a literal core), Glob from the Merkle path list.
 */

export interface ServedResult {
  text: string;
  matches: number;
}

function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Glob over indexed paths; undefined when the pattern is outside what the index knows. */
export function serveGlob(store: Store, pattern: string, scope?: string): ServedResult | undefined {
  if (!pattern || pattern.startsWith('/')) return undefined;
  const re = globToRegex(pattern);
  const prefix = scope ? `${scope.replace(/\/$/, '')}/` : '';
  const hits = store.merkle.paths().filter((p) => p.startsWith(prefix) && re.test(p.slice(prefix.length)));
  return { text: hits.slice(0, 200).join('\n') + (hits.length > 200 ? `\n… ${hits.length - 200} more` : ''), matches: hits.length };
}

/** Grep over indexed chunks; undefined when the pattern has no literal the index can use. */
export function serveGrep(store: Store, pattern: string, opts: { scope?: string; caseInsensitive?: boolean; filesOnly?: boolean } = {}): ServedResult | undefined {
  if (!pattern || pattern.length < 3) return undefined;
  let hits: { path: string; line: number; text: string }[];
  try {
    hits = /[\\^$.*+?()[\]{}|]/.test(pattern) ? store.trigram.searchRegex(pattern, opts.caseInsensitive ? 'i' : '', 500) : store.trigram.search(pattern, 500);
  } catch {
    return undefined; // the index cannot answer this pattern: let the real tool run
  }
  if (opts.caseInsensitive === false) hits = hits.filter((h) => h.text.includes(pattern) || /[\\^$.*+?()[\]{}|]/.test(pattern));
  const prefix = opts.scope ? `${opts.scope.replace(/\/$/, '')}/` : '';
  if (prefix) hits = hits.filter((h) => h.path.startsWith(prefix));
  if (opts.filesOnly) {
    const files = [...new Set(hits.map((h) => h.path))];
    return { text: files.join('\n'), matches: files.length };
  }
  const lines = hits.slice(0, 100).map((h) => `${h.path}:${h.line}:${h.text}`);
  return { text: lines.join('\n') + (hits.length > 100 ? `\n… ${hits.length - 100} more matches` : ''), matches: hits.length };
}
