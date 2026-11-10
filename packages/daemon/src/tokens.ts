import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { DEFAULT_TOKEN_SETTINGS, TokenSettingsSchema, type TokenSettings } from '@riaf/kernel';

/** Loads and validates `.riaf/tokens.yaml` (the agent prompt's token settings); built-in defaults when absent. */

/** Token settings as commented YAML (what `riaf init` and the console write). */
export function tokensYaml(settings: TokenSettings): string {
  return [
    '# RIAF v2 token settings — how the agent prompt spends the model\'s context window.',
    '# Validated by @riaf/kernel schemas/tokens.ts. Per-intent values are blended by the route\'s intent weights.',
    stringify(settings).trimEnd(),
    '',
  ].join('\n');
}

/** The defaults as YAML, as `riaf init` writes them. */
export function defaultTokensYaml(): string {
  return tokensYaml(DEFAULT_TOKEN_SETTINGS);
}

/** Validates token-settings YAML without touching disk. */
export function validateTokensText(text: string): { ok: boolean; errors: string[]; settings?: TokenSettings } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { ok: false, errors: [`YAML: ${(e as Error).message}`] };
  }
  const r = TokenSettingsSchema.safeParse(raw);
  if (r.success) return { ok: true, errors: [], settings: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`) };
}

/** Settings for `root`: the file when it is valid, otherwise the defaults (with the reasons). */
export function loadTokenSettings(root: string): { settings: TokenSettings; text: string; source: 'file' | 'builtin'; errors: string[] } {
  let text = '';
  try {
    text = readFileSync(join(root, '.riaf', 'tokens.yaml'), 'utf8');
  } catch {
    return { settings: DEFAULT_TOKEN_SETTINGS, text: defaultTokensYaml(), source: 'builtin', errors: [] };
  }
  const v = validateTokensText(text);
  return v.settings ? { settings: v.settings, text, source: 'file', errors: [] } : { settings: DEFAULT_TOKEN_SETTINGS, text, source: 'builtin', errors: v.errors };
}
