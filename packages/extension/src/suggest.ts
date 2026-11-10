import type { WikiNodeShape } from '@riaf/kernel';
import { areaName, isTest } from './ask.js';
import type { Rpc } from './tools.js';

/** A starter task for "Prepare a task", written from what the index knows about this repository. */
export interface TaskSuggestion {
  text: string;
  intent: 'bugfix' | 'feature' | 'refactor' | 'review' | 'onboarding';
  /** Where the suggestion comes from (area size, a recent commit, a central symbol). */
  why: string;
}

const KIND_RANK: Record<string, number> = { class: 5, function: 4, interface: 3, method: 2, type: 1 };
/** `src/toll/session.ts#TollSession.close@method` → `TollSession.close`. */
export const qualifiedName = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@') > id.indexOf('#') ? id.lastIndexOf('@') : undefined);
const kindOf = (id: string) => id.slice(id.lastIndexOf('@') + 1);
const pathOf = (id: string) => id.slice(0, id.indexOf('#'));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The most central symbol in a list: classes first, then functions; never tests or private helpers. */
export function pickSymbol(ids: readonly string[]): string | undefined {
  return ids
    .filter((id) => !isTest(id) && qualifiedName(id) && !/^_|\b(constructor|toString|main)$/.test(qualifiedName(id)))
    .sort((a, b) => (KIND_RANK[kindOf(b)] ?? 0) - (KIND_RANK[kindOf(a)] ?? 0) || qualifiedName(a).length - qualifiedName(b).length)[0];
}

const NOT_SOURCE = /(^|\/)(docs?|\.github|\.claude|\.riaf|\.vscode|fixtures?|tests?|__tests__|spec|examples?|dist|build|out|node_modules|vendor|scripts?|tooling|media|assets?|public)\//i;

/** Source folders that hold files directly, largest first (docs, CI, tests and tooling left out). */
export function sourceAreas(tree: WikiNodeShape): { id: string; name: string; files: number }[] {
  const out: { id: string; name: string; files: number }[] = [];
  const walk = (n: WikiNodeShape) => {
    if (n.id && NOT_SOURCE.test(n.id)) return;
    const files = Number(n.summary.match(/(\d+) files?/)?.[1] ?? 0);
    if (n.id && n.level !== 'file' && files > 0) out.push({ id: n.id, name: niceName(n.id), files });
    n.children.filter((c) => c.level !== 'file').forEach(walk);
  };
  walk(tree);
  return out.sort((a, b) => b.files - a.files);
}
/** `packages/kernel/src/` → "Kernel"; `src/toll/` → "Toll". */
const niceName = (id: string) => {
  const parts = id.split('/').filter((p) => p && !/^(src|lib|main|java|app|packages|internal|pkg)$/i.test(p));
  return parts.length ? areaName(`${parts[parts.length - 1]}/`) : areaName(id);
};

/** Writes up to `max` tasks grounded in the repository's largest areas, central symbols and recent commits. */
export async function suggestTasks(rpc: Rpc, max = 6): Promise<TaskSuggestion[]> {
  const { tree } = await rpc.call('wiki.structure', { depth: 6 });
  const seen = new Set<string>();
  const areas = sourceAreas(tree).filter((a) => !seen.has(a.name) && seen.add(a.name)).slice(0, 4);
  const facts = await Promise.all(areas.map(async (a) => {
    const page = await rpc.call('wiki.page', { node: a.id }).catch(() => undefined);
    const files = (page?.children ?? []).map((c) => c.id).filter((id) => !/\/$/.test(id) && !isTest(`${id}#x@file`)).slice(0, 4);
    let ids = page?.symbols.map((s) => s.id) ?? [];
    if (!pickSymbol(ids)) {
      const pages = await Promise.all(files.map((f) => rpc.call('wiki.page', { node: f }).catch(() => undefined)));
      ids = pages.flatMap((p) => p?.symbols.map((s) => s.id) ?? []);
    }
    const histories = await Promise.all(files.map((f) => rpc.call('history.timeline', { path: f, limit: 5 }).catch(() => undefined)));
    const commit = histories.flatMap((h) => h?.entries ?? []).filter((e) => !e.noise && e.summary.trim().length > 8).sort((x, y) => y.at.localeCompare(x.at))[0];
    return { area: a, symbol: pickSymbol(ids), commit };
  }));

  const out: TaskSuggestion[] = [];
  const add = (s: TaskSuggestion) => { if (!out.some((x) => x.text === s.text)) out.push(s); };
  const [a1, a2, a3, a4] = facts;
  if (a1?.symbol) add({ intent: 'onboarding', text: `Explain how ${a1.area.name} works, starting from \`${qualifiedName(a1.symbol)}\``, why: `largest area, ${a1.area.files} files` });
  const fix = facts.find((f) => f.commit && /^(fix|bug|hotfix)|\bfix(es|ed)?\b/i.test(f.commit.summary));
  if (fix?.commit) add({ intent: 'bugfix', text: `Check the recent fix “${clip(fix.commit.summary, 70)}” in ${fix.area.name} for cases it missed`, why: `commit ${fix.commit.commit.slice(0, 8)} · ${fix.commit.at.slice(0, 10)}` });
  if (a2?.symbol) add({ intent: 'refactor', text: `Refactor \`${qualifiedName(a2.symbol)}\` in ${a2.area.id} and update every caller`, why: `central ${kindOf(a2.symbol)} in ${a2.area.name}` });
  if (a1?.symbol) add({ intent: 'bugfix', text: `Add input validation and clear errors to \`${qualifiedName(a1.symbol)}\` (${pathOf(a1.symbol)})`, why: `entry point of ${a1.area.name}` });
  const review = facts.find((f) => f.commit && f !== fix);
  if (review?.commit) add({ intent: 'review', text: `Review the latest change to ${review.area.name}: “${clip(review.commit.summary, 70)}”`, why: `by ${review.commit.author} · ${review.commit.at.slice(0, 10)}` });
  if (a3?.symbol) add({ intent: 'feature', text: `Add tests that cover \`${qualifiedName(a3.symbol)}\` and its edge cases`, why: `${a3.area.name}, ${a3.area.files} files` });
  if (a4?.symbol) add({ intent: 'feature', text: `Extend \`${qualifiedName(a4.symbol)}\` with a new option, keeping current callers working`, why: `${a4.area.name}` });
  if (!out.length && areas[0]) add({ intent: 'onboarding', text: `Explain how ${areas[0].name} is structured and where to start`, why: `${areas[0].files} files` });
  return out.slice(0, max);
}
