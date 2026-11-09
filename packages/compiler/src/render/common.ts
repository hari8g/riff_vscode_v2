import { INTENTS, type Pack, type PackItem } from '@riaf/kernel';
import { langOf } from '../candidates.js';

/** Shared pieces of the human-readable renders. */

export function where(i: PackItem): string {
  const s = i.source as { path?: string; range?: { startLine: number; endLine: number }; commit?: string; virtual?: string };
  if (s.path) return s.range ? `${s.path}:${s.range.startLine}-${s.range.endLine}` : s.path;
  if (s.commit) return `commit ${s.commit.slice(0, 10)}`;
  return s.virtual ?? '';
}

export function routeLine(p: Pack): string {
  const w = INTENTS.filter((i) => (p.route.w[i] ?? 0) >= 0.05).sort((a, b) => (p.route.w[b] ?? 0) - (p.route.w[a] ?? 0)).map((i) => `${i} ${(p.route.w[i] ?? 0).toFixed(2)}`).join(', ');
  return `intent ${w} · H ${p.route.H.toFixed(2)} · ${p.route.branch}${p.route.stages.length > 1 ? ` · ${p.route.stages.length} stages` : ''}`;
}

export function fence(i: PackItem): string {
  const s = i.source as { path?: string };
  const lang = i.kind === 'convention' || i.kind === 'commit' || i.kind === 'summary' && !s.path ? '' : langOf(s.path);
  return `\`\`\`${lang}\n${i.content}\n\`\`\``;
}

export const TIER_TITLE: Record<number, string> = { 1: 'Orientation', 2: 'Code', 3: 'History & conventions', 4: 'Run-book' };
