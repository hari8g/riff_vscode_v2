import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  ComposedPolicySchema,
  GovernanceFileSchema,
  IntentVectorSchema,
  PackSchema,
  PoliciesFileSchema,
  RPC,
  RPC_METHODS,
  ToolDecisionSchema,
} from '../src/schemas/index.js';
import { hashBlob } from '../src/hash.js';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('intent vector', () => {
  it('accepts distributions and rejects non-normalised ones', () => {
    expect(IntentVectorSchema.safeParse({ bugfix: 0.7, feature: 0.3 }).success).toBe(true);
    expect(IntentVectorSchema.safeParse({ bugfix: 0.7, feature: 0.4 }).success).toBe(false);
    expect(IntentVectorSchema.safeParse({ alien: 1 }).success).toBe(false);
  });
});

describe('.riaf policy files', () => {
  it('policies.yaml validates and defines all seven primitives', () => {
    const r = PoliciesFileSchema.safeParse(parseYaml(read('.riaf/policies.yaml')));
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues, null, 2)).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data.primitives).sort()).toEqual(['bugfix', 'feature', 'merge', 'onboarding', 'refactor', 'review', 'unknown']);
      expect(r.data.router.entropy.single_below).toBeLessThan(r.data.router.entropy.blend_below);
    }
  });

  it('governance.yaml validates', () => {
    const r = GovernanceFileSchema.safeParse(parseYaml(read('.riaf/governance.yaml')));
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues, null, 2)).toBe(true);
  });

  it('rejects a primitive whose weights do not sum to 1', () => {
    const doc = parseYaml(read('.riaf/policies.yaml')) as { primitives: Record<string, { weights: Record<string, number> }> };
    doc.primitives.bugfix!.weights = { ingredients: 0.9, history: 0.9 };
    expect(PoliciesFileSchema.safeParse(doc).success).toBe(false);
  });
});

describe('ComposedPolicy and Pack', () => {
  const policy = {
    units: [{ id: 'u1', text: 'fix the null check', anchors: ['src/a.ts#A.close@method'], w: { bugfix: 0.8, unknown: 0.2 }, H: 0.3 }],
    branch: 'single',
    w: { bugfix: 0.8, unknown: 0.2 },
    H: 0.3,
    primitives: [{ intent: 'bugfix', weight: 1 }],
    anchors: ['src/a.ts#A.close@method'],
    expansion: [{ rule: 'callers', hops: 2 }, { rule: 'exercising_test' }],
    historyScope: ['blame_on_anchors'],
    budget: { total: 16000, fixed: { map: 2000, runbook: 1500 }, variable: { ingredients: 0.6, history: 0.4 } },
    stages: [['u1']],
    question: null,
    policyVersion: 'policies.yaml@1',
  };

  it('accepts a well-formed composed policy', () => {
    const r = ComposedPolicySchema.safeParse(policy);
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
  });

  it('pack enforces token accounting', () => {
    const item = {
      id: 'i1', tier: 2, kind: 'body',
      source: { path: 'src/a.ts', range: { startLine: 1, endLine: 9 } },
      hash: hashBlob('body'), why: { intent: 'bugfix', rule: 'callers', weight: 0.6, score: 1.2 },
      tokens: 120, stage: 0, content: 'function close() {}',
    };
    const base = {
      packId: 'p1', repo: 'toll-ts', route: { w: policy.w, H: 0.3, branch: 'single', stages: [['u1']] },
      budget: 16000, tokensUsed: 120, openLookups: [], items: [item], policyVersion: 'policies.yaml@1', schemaVersion: 1,
      createdAt: new Date().toISOString(),
    };
    expect(PackSchema.safeParse(base).success).toBe(true);
    expect(PackSchema.safeParse({ ...base, tokensUsed: 121 }).success).toBe(false);
    expect(PackSchema.safeParse({ ...base, budget: 100 }).success).toBe(false);
  });
});

describe('RPC table', () => {
  it('every method has params and result schemas and parses a tool decision', () => {
    expect(RPC_METHODS.length).toBeGreaterThanOrEqual(10);
    for (const m of RPC_METHODS) {
      expect(RPC[m].params).toBeDefined();
      expect(RPC[m].result).toBeDefined();
    }
    expect(ToolDecisionSchema.safeParse({ kind: 'serve', result: 'x', from: 'cache' }).success).toBe(true);
    expect(ToolDecisionSchema.safeParse({ kind: 'serve', result: 'x', from: 'moon' }).success).toBe(false);
  });
});
