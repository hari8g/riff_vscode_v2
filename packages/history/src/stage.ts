import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus, Logger, ModelPort, PipelineEvents, SymbolId } from '@riaf/kernel';
import type { Store } from '@riaf/store';
import { ingestAdrs } from './adr.js';
import { recomputeCoChange } from './cochange.js';
import { extractiveSummary, incidentRefs, revertedSha, toRecord } from './commits.js';
import { blameFile, hasHistory, headSha, isAncestor, mineLog } from './gitio.js';

export const HISTORY_STAGE = 'history';
const LAST_SHA = 'history.last_sha';
const NOISE_SIG = 'history.noise';

export interface HistoryStageOptions {
  root: string;
  events?: EventBus<PipelineEvents>;
  logger?: Logger;
  /** Optional model for abstractive commit summaries (extractive otherwise). */
  summarizer?: ModelPort;
  /** Cap on commits mined in a cold run (newest first). */
  maxCommits?: number;
  /** Concurrent `git blame` processes. */
  concurrency?: number;
}

export interface HistoryStageResult {
  mined: number;
  rewritten: boolean;
  blamed: number;
  adrs: number;
  coChangeEdges: number;
  skipped?: string;
  ms: number;
}

const readText = (root: string) => (p: string) => {
  try {
    return readFileSync(join(root, p), 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * The incremental history stage: mine commits since the last mined sha (re-mine everything when
 * history was rewritten), classify them, re-blame files that changed on disk or in new commits, then
 * refresh co-change edges and ADR links.
 */
export async function runHistoryStage(store: Store, opts: HistoryStageOptions): Promise<HistoryStageResult> {
  const t0 = performance.now();
  const result: HistoryStageResult = { mined: 0, rewritten: false, blamed: 0, adrs: 0, coChangeEdges: 0, ms: 0 };
  if (!hasHistory(opts.root)) {
    store.merkle.markDone(HISTORY_STAGE, store.merkle.changedSince(HISTORY_STAGE).map((b) => b.path));
    result.skipped = 'not a git repository with commits';
    result.ms = performance.now() - t0;
    return result;
  }
  opts.events?.emit('stage:start', { stage: HISTORY_STAGE, pending: store.merkle.changedSince(HISTORY_STAGE).length });
  const head = headSha(opts.root)!;
  const last = store.kv.get(LAST_SHA);
  const touched = new Set<string>();
  if (head !== last) {
    let since = last;
    if (last && !isAncestor(opts.root, last, head)) {
      store.history.clear();
      since = undefined;
      result.rewritten = true;
    }
    const raws = mineLog(opts.root, since, since ? undefined : opts.maxCommits);
    const ignore = new Set<string>();
    try {
      for (const l of readFileSync(join(opts.root, '.git-blame-ignore-revs'), 'utf8').split('\n')) if (/^[0-9a-f]{40}$/.test(l.trim())) ignore.add(l.trim());
    } catch {
      // no ignore-revs file
    }
    const repoFiles = Math.max(1, store.merkle.countBlobs());
    const records = raws.map((c) => toRecord(c, ignore, repoFiles));
    store.history.upsertCommits(records, raws.flatMap((c) => c.files.map((f) => ({ sha: c.sha, ...f }))));
    store.driver.transaction(() => {
      for (const c of raws) {
        const reverted = revertedSha(c.body);
        if (reverted) {
          const full = store.history.resolve(reverted);
          store.history.recordRevert(c.sha, full?.sha ?? reverted);
        }
        for (const r of incidentRefs(`${c.subject}\n${c.body}`)) store.history.recordIncident(c.sha, r.kind, r.ref);
        const s = extractiveSummary(c);
        store.history.upsertSummary(c.sha, s.goal, s.terms, 'extractive');
        for (const f of c.files) touched.add(f.path);
      }
    });
    result.mined = raws.length;
    store.kv.set(LAST_SHA, head);
    // abstractive summaries through a small model when one is wired (newest first, bounded per run)
    if (opts.summarizer) {
      for (const c of [...raws].reverse().slice(0, 25)) {
        try {
          const r = await opts.summarizer.complete([
            { role: 'system', content: 'Summarise a git commit as one line stating its goal. No preamble.' },
            { role: 'user', content: `${c.subject}\n\n${c.body}\n\nFiles: ${c.files.map((f) => f.path).slice(0, 20).join(', ')}` },
          ], { maxTokens: 60, temperature: 0, cacheKey: `commit:${c.sha}` });
          const goal = r.text.trim().split('\n')[0];
          if (goal) store.history.upsertSummary(c.sha, goal, extractiveSummary(c).terms, r.model);
        } catch (e) {
          opts.logger?.warn('commit summary failed', { sha: c.sha, error: String(e) });
          break;
        }
      }
    }
  }
  // re-blame: files that changed on disk, files touched by new commits, and everything when the
  // noise set changed (blame ignores noise revisions)
  const noise = store.history.noiseShas().sort();
  const sig = noise.join(',');
  if (store.kv.get(NOISE_SIG) !== sig) {
    store.merkle.resetStage(HISTORY_STAGE);
    store.kv.set(NOISE_SIG, sig);
  }
  // Re-blame when a commit touched the file or the file was never blamed. A save without a commit
  // changes no history (uncommitted lines have none), so it waits for the commit that touches it.
  const pending = new Set(store.merkle.changedSince(HISTORY_STAGE).map((b) => b.path));
  for (const p of touched) if (store.merkle.getBlob(p)) pending.add(p);
  const files = [...pending].filter((p) => (touched.has(p) || !store.history.hasBlameForPath(p)) && store.symbols.byPath(p).some((s) => s.kind !== 'file'));
  const conc = Math.max(1, opts.concurrency ?? 8);
  for (let i = 0; i < files.length; i += conc) {
    const batch = files.slice(i, i + conc);
    const blames = await Promise.all(batch.map((p) => blameFile(opts.root, p, noise)));
    store.driver.transaction(() => {
      batch.forEach((path, k) => {
        const owner = blames[k]!;
        const blob = store.merkle.getBlob(path);
        store.history.deleteBlameForPath(path);
        for (const s of store.symbols.byPath(path)) {
          if (s.kind === 'file' || s.startLine === undefined || s.endLine === undefined) continue;
          const counts = new Map<string, number>();
          for (let l = s.startLine; l <= s.endLine; l++) {
            const sha = owner.get(l);
            if (!sha || /^0+$/.test(sha)) continue; // uncommitted lines have no history yet
            counts.set(sha, (counts.get(sha) ?? 0) + 1);
          }
          store.history.replaceBlame(s.id as SymbolId, blob?.hash ?? '', [...counts.entries()].map(([commit, lines]) => ({ commit, lines })));
        }
      });
    });
    result.blamed += batch.length;
  }
  store.merkle.markDone(HISTORY_STAGE, [...pending]);
  result.adrs = ingestAdrs(store, readText(opts.root));
  // co-change only moves when commits arrive (or on the first blame of files)
  if (result.mined > 0 || result.rewritten || (result.blamed > 0 && store.edges.allOfKinds(['co_changes']).length === 0)) result.coChangeEdges = recomputeCoChange(store).symbolEdges;
  result.ms = performance.now() - t0;
  opts.events?.emit('stage:end', { stage: HISTORY_STAGE, changed: result.mined + result.blamed, ms: result.ms });
  return result;
}
