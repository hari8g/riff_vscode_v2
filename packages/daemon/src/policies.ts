import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { GovernanceFileSchema, hashWith, PoliciesFileSchema, shortHash, type GovernanceFile, type PoliciesFile } from '@riaf/kernel';

/** Loads and validates `.riaf/policies.yaml` and `.riaf/governance.yaml` (policies are data). */

export interface Diagnostic {
  file: string;
  path: string;
  message: string;
}

export interface LoadedPolicies {
  policies?: PoliciesFile;
  governance?: GovernanceFile;
  policiesText: string;
  governanceText: string;
  /** `policies.yaml@<hash>`: stamped into every route and pack. */
  version: string;
  diagnostics: Diagnostic[];
}

function validate<T>(file: string, text: string, schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: PropertyKey[]; message: string }[] } } }): { value?: T; diagnostics: Diagnostic[] } {
  if (!text.trim()) return { diagnostics: [{ file, path: '', message: 'file is missing or empty' }] };
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { diagnostics: [{ file, path: '', message: `YAML: ${(e as Error).message}` }] };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { value: r.data as T, diagnostics: [] };
  return { diagnostics: (r.error?.issues ?? []).map((i) => ({ file, path: i.path.map(String).join('.'), message: i.message })) };
}

/** Validates policy texts without touching disk (policies.validate RPC, console editor). */
export function validatePolicyTexts(policiesText: string | undefined, governanceText: string | undefined): { policies?: PoliciesFile; governance?: GovernanceFile; diagnostics: Diagnostic[] } {
  const out: { policies?: PoliciesFile; governance?: GovernanceFile; diagnostics: Diagnostic[] } = { diagnostics: [] };
  if (policiesText !== undefined) {
    const p = validate<PoliciesFile>('policies.yaml', policiesText, PoliciesFileSchema);
    if (p.value) out.policies = p.value;
    out.diagnostics.push(...p.diagnostics);
  }
  if (governanceText !== undefined) {
    const g = validate<GovernanceFile>('governance.yaml', governanceText, GovernanceFileSchema);
    if (g.value) out.governance = g.value;
    out.diagnostics.push(...g.diagnostics);
  }
  return out;
}

const readOr = (p: string): string => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** Reads both policy files of a repository. */
export function loadPolicies(root: string): LoadedPolicies {
  const policiesText = readOr(join(root, '.riaf', 'policies.yaml'));
  const governanceText = readOr(join(root, '.riaf', 'governance.yaml'));
  const v = validatePolicyTexts(policiesText, governanceText);
  return { ...v, policiesText, governanceText, version: `policies.yaml@${shortHash(hashWith('policies', policiesText), 8)}` };
}
