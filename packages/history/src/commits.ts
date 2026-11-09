import type { CommitKind, CommitRecord } from '@riaf/store';
import type { RawCommit } from './gitio.js';

/**
 * Commit classification: kind (from conventional prefixes and keywords), noise (bulk reformats,
 * vendored or generated changes, lockfile bumps), reverts (git's standard revert message) and
 * incident markers (ticket ids, INC-n, hotfix/rollback).
 */

const NOISE_PATHS = /(^|\/)(vendor|third_party|node_modules|dist|build|generated)\/|(\.lock|-lock\.json|\.min\.js|\.pb\.go|_pb2\.py)$|^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|go\.sum|Cargo\.lock)$/;

/** Classifies a commit's kind from its subject and body. */
export function commitKind(c: Pick<RawCommit, 'subject' | 'body' | 'parents'>): CommitKind {
  const s = c.subject;
  if (c.parents.length > 1) return 'merge';
  if (/^Revert "/.test(s) || /This reverts commit [0-9a-f]{7,40}/.test(c.body)) return 'revert';
  if (/\b(hotfix|rollback|roll back|incident|outage|sev[ -]?[0-9])\b|\bINC-\d+\b/i.test(`${s} ${c.body}`)) return 'incident';
  const m = /^(\w+)(\([^)]*\))?!?:/.exec(s);
  const prefix = m?.[1]?.toLowerCase();
  if (prefix === 'fix' || prefix === 'bugfix') return 'fix';
  if (prefix === 'feat' || prefix === 'feature') return 'feat';
  if (prefix === 'refactor' || prefix === 'perf') return 'refactor';
  if (prefix === 'style') return 'style';
  if (prefix === 'docs' || prefix === 'doc') return 'docs';
  if (prefix === 'test' || prefix === 'tests') return 'test';
  if (prefix === 'chore' || prefix === 'build' || prefix === 'ci') return 'chore';
  if (/\b(fix(es|ed)?|bug|regression|crash)\b/i.test(s)) return 'fix';
  if (/\b(reformat|format(ted)?|prettier|lint)\b/i.test(s)) return 'style';
  if (/^(add|implement|introduce|support)\b/i.test(s)) return 'feat';
  return 'other';
}

/**
 * True when a commit is noise for blame and co-change: bulk reformats, commits touching many files
 * with balanced add/delete counts, and commits that only touch vendored, generated or lock files.
 */
export function isNoise(c: RawCommit, kind: CommitKind, ignoreRevs: ReadonlySet<string>, repoFiles: number): boolean {
  if (ignoreRevs.has(c.sha)) return true;
  if (kind === 'merge') return true;
  const files = c.files.length;
  if (files === 0) return false;
  if (c.files.every((f) => NOISE_PATHS.test(f.path))) return true;
  const added = c.files.reduce((a, f) => a + f.added, 0);
  const deleted = c.files.reduce((a, f) => a + f.deleted, 0);
  const balanced = added > 0 && Math.abs(added - deleted) / Math.max(added, deleted) < 0.1;
  if (kind === 'style' && files >= 3) return true;
  if (balanced && files >= Math.max(10, repoFiles * 0.3)) return true;
  return files > Math.max(100, repoFiles * 0.5);
}

/** The reverted sha named in a revert message. */
export function revertedSha(body: string): string | undefined {
  return /This reverts commit ([0-9a-f]{7,40})/.exec(body)?.[1];
}

/** Ticket and incident references in a message. */
export function incidentRefs(text: string): { kind: 'ticket' | 'incident' | 'hotfix'; ref: string }[] {
  const out: { kind: 'ticket' | 'incident' | 'hotfix'; ref: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b(INC-\d+)\b/g)) if (!seen.has(m[1]!)) { seen.add(m[1]!); out.push({ kind: 'incident', ref: m[1]! }); }
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)) if (!seen.has(m[1]!)) { seen.add(m[1]!); out.push({ kind: 'ticket', ref: m[1]! }); }
  if (/\b(hotfix|rollback|roll back)\b/i.test(text)) out.push({ kind: 'hotfix', ref: 'hotfix' });
  return out;
}

/** Turns a raw commit into its stored record. */
export function toRecord(c: RawCommit, ignoreRevs: ReadonlySet<string>, repoFiles: number): CommitRecord {
  const kind = commitKind(c);
  return {
    sha: c.sha, parents: c.parents, author: c.author, email: c.email, at: c.at, subject: c.subject, body: c.body,
    files: c.files.length, added: c.files.reduce((a, f) => a + f.added, 0), deleted: c.files.reduce((a, f) => a + f.deleted, 0),
    kind, noise: isNoise(c, kind, ignoreRevs, repoFiles),
  };
}

/** Extractive commit summary: the goal (subject without its conventional prefix) and salient terms. */
export function extractiveSummary(c: Pick<RawCommit, 'subject' | 'body' | 'files'>): { goal: string; terms: string[] } {
  const goal = c.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim() || c.subject;
  const terms = new Set<string>();
  for (const m of `${c.subject}\n${c.body}`.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z0-9]+_[a-z0-9_]+)\b/g)) terms.add(m[1]!);
  for (const f of c.files.slice(0, 8)) terms.add(f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''));
  return { goal, terms: [...terms].slice(0, 12) };
}
