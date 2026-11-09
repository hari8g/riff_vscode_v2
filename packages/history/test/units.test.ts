import { describe, expect, it } from 'vitest';
import { parseAdr } from '../src/adr.js';
import { commitKind, extractiveSummary, incidentRefs, isNoise, revertedSha } from '../src/commits.js';
import { LOG_FORMAT, parseBlame, parseLog } from '../src/gitio.js';

const raw = (subject: string, files: { path: string; added: number; deleted: number }[] = [{ path: 'a.ts', added: 1, deleted: 1 }], body = '', parents = ['p']) => ({ sha: 'a'.repeat(40), parents, author: 'x', email: 'x@y', at: '2025-01-01T00:00:00Z', subject, body, files });

describe('git output parsing', () => {
  it('parses log records with multi-line bodies and numstat', () => {
    const rs = '\u001e';
    const fs = '\u001f';
    const out = `${rs}${'a'.repeat(40)}${fs}${'b'.repeat(40)}${fs}Asha${fs}a@x${fs}2025-01-01T09:00:00+00:00${fs}fix(plate): x${fs}line1\nline2${fs}\n\n3\t1\tsrc/a.ts\n-\t-\timg.png\n${rs}${'c'.repeat(40)}${fs}${fs}Ben${fs}b@x${fs}2025-01-02T09:00:00+00:00${fs}init${fs}${fs}\n`;
    const c = parseLog(out);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ subject: 'fix(plate): x', body: 'line1\nline2', files: [{ path: 'src/a.ts', added: 3, deleted: 1 }, { path: 'img.png', added: 0, deleted: 0 }] });
    expect(c[1]!.parents).toEqual([]);
    expect(LOG_FORMAT).toContain('%H');
  });

  it('parses porcelain blame into line owners', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const out = `${a} 1 1 2\nauthor X\nfilename f\n\tline one\n${a} 2 2\n\tline two\n${b} 5 3 1\nauthor Y\n\tline three\n`;
    expect([...parseBlame(out).entries()]).toEqual([[1, a], [2, a], [3, b]]);
  });
});

describe('commit classification', () => {
  it('derives kinds from conventional prefixes, keywords and revert messages', () => {
    expect(commitKind(raw('fix(plate): restore boundary (TOLL-107)'))).toBe('fix');
    expect(commitKind(raw('hotfix: rollback boundary change (INC-42)'))).toBe('incident');
    expect(commitKind(raw('Revert "perf: x"', undefined, 'This reverts commit abcdef1.'))).toBe('revert');
    expect(commitKind(raw('feat(api): add endpoint'))).toBe('feat');
    expect(commitKind(raw('style: reformat sources'))).toBe('style');
    expect(commitKind(raw('Merge branch x', undefined, '', ['a', 'b']))).toBe('merge');
    expect(commitKind(raw('Fix crash in parser'))).toBe('fix');
  });

  it('flags bulk reformats, lockfile-only and huge sweeps as noise but not focused changes', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ path: `src/f${i}.ts`, added: 10, deleted: 10 }));
    expect(isNoise(raw('style: reformat', many), 'style', new Set(), 40)).toBe(true);
    expect(isNoise(raw('chore: bump deps', [{ path: 'pnpm-lock.yaml', added: 300, deleted: 200 }]), 'chore', new Set(), 40)).toBe(true);
    expect(isNoise(raw('feat: add x', [{ path: 'src/x.ts', added: 40, deleted: 0 }, { path: 'test/x.test.ts', added: 20, deleted: 0 }]), 'feat', new Set(), 40)).toBe(false);
    expect(isNoise(raw('anything'), 'other', new Set(['a'.repeat(40)]), 40)).toBe(true);
  });

  it('reads reverted shas, ticket and incident refs, and extractive summaries', () => {
    expect(revertedSha('Revert "x"\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.')).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(incidentRefs('hotfix: rollback (TOLL-114, incident INC-42)')).toEqual([{ kind: 'incident', ref: 'INC-42' }, { kind: 'ticket', ref: 'TOLL-114' }, { kind: 'hotfix', ref: 'hotfix' }]);
    expect(extractiveSummary(raw('fix(ledger): retry Ledger.post on timeout', [{ path: 'src/toll/ledger.ts', added: 1, deleted: 1 }]))).toEqual({ goal: 'retry Ledger.post on timeout', terms: ['Ledger.post', 'ledger'] });
  });

  it('parses ADR titles and statuses', () => {
    expect(parseAdr('# ADR-0002 — Charge on close\n\n**Status:** accepted\n\nbody')).toEqual({ title: 'ADR-0002 — Charge on close', status: 'accepted' });
    expect(parseAdr('no heading').status).toBe('unknown');
  });
});
