import type { SymbolId } from '@riaf/kernel';
import type { CommitRecord, Store } from '@riaf/store';
import { hotspots, ownership, type Hotspot, type HotspotOptions, type Owner } from './hotspots.js';
import { runHistoryStage, type HistoryStageOptions, type HistoryStageResult } from './stage.js';

/** One entry of a symbol's or file's timeline. */
export interface TimelineEntry {
  commit: string;
  at: string;
  author: string;
  summary: string;
  kind: string;
  noise: boolean;
  /** Lines of the symbol this commit still owns (blame), when known. */
  lines?: number;
  refs: string[];
  revertedBy?: string;
}

export interface Rationale {
  commits: TimelineEntry[];
  reverts: { commit: string; reverted: string; summary: string }[];
  incidents: { commit: string; ref: string; summary: string }[];
  adrs: { path: string; title: string; status: string; excerpt: string }[];
  coChange: { symbol: SymbolId; support: number; confidence: number }[];
}

/** A co-change convention as the semantic layer consumes it. */
export interface CoChangeConvention {
  id: string;
  text: string;
  confidence: number;
  evidence: number;
  entities: string[];
  source: 'history';
}

const nameOf = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || id.slice(0, id.indexOf('#'));

/** The history layer's façade: the stage, per-symbol queries, and the compiler's HistoryFacts. */
export class History {
  constructor(private readonly store: Store) {}

  update(opts: HistoryStageOptions): Promise<HistoryStageResult> {
    return runHistoryStage(this.store, opts);
  }

  /** Files or directories ranked by recency-weighted churn, with owners and bus factor. */
  hotspots(opts?: HotspotOptions): Hotspot[] {
    return hotspots(this.store, opts);
  }

  /** Who has changed a file or directory, by share of commits. */
  ownership(path: string): { owners: Owner[]; busFactor: number; commits: number } {
    return ownership(this.store, path);
  }

  private entry(c: CommitRecord, lines?: number): TimelineEntry {
    const s = this.store.history.summary(c.sha);
    const revertedBy = this.store.history.revertOf(c.sha);
    return {
      commit: c.sha, at: c.at, author: c.author, summary: s?.goal ?? c.subject, kind: c.kind, noise: c.noise,
      ...(lines !== undefined ? { lines } : {}), refs: this.store.history.incidentsOf(c.sha).map((i) => i.ref).filter((r) => r !== 'hotfix'),
      ...(revertedBy ? { revertedBy } : {}),
    };
  }

  /**
   * Commits that own the symbol's current lines (blame per symbol), most recent first; noise excluded.
   * For a file id (`path#@file`) the blame of every symbol in the file is aggregated.
   */
  blame(symbol: SymbolId, limit = 10): TimelineEntry[] {
    const out: TimelineEntry[] = [];
    let rows = this.store.history.blame(symbol);
    if (symbol.endsWith('#@file')) {
      const lines = new Map<string, (typeof rows)[number]>();
      for (const s of this.store.symbols.byPath(symbol.slice(0, symbol.indexOf('#')))) {
        if (s.kind === 'file' || s.parentId && !s.parentId.endsWith('#@file')) continue; // top-level symbols cover their members
        for (const b of this.store.history.blame(s.id as SymbolId)) {
          const prev = lines.get(b.commit);
          lines.set(b.commit, prev ? { ...prev, lines: prev.lines + b.lines } : b);
        }
      }
      rows = [...lines.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    }
    for (const b of rows) {
      const c = this.store.history.commit(b.commit);
      if (!c || c.noise) continue;
      out.push(this.entry(c, b.lines));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Timeline for a symbol (blame) or a path (every commit touching it, noise flagged). */
  timeline(target: { symbol?: SymbolId; path?: string }, limit = 20): TimelineEntry[] {
    if (target.symbol) return this.blame(target.symbol, limit);
    if (target.path) return this.store.history.commitsTouching(target.path, limit).map((c) => this.entry(c));
    return [];
  }

  /** Why a symbol is the way it is: its commits, the reverts and incidents among them, ADRs, co-change. */
  rationale(symbol: SymbolId): Rationale {
    const commits = this.blame(symbol, 15);
    const path = symbol.slice(0, symbol.indexOf('#'));
    const reverts: Rationale['reverts'] = [];
    const incidents: Rationale['incidents'] = [];
    const seen = new Set<string>();
    // reverts of commits that touched the symbol's file, and revert commits on it
    for (const c of this.store.history.commitsTouching(path, 100)) {
      const by = this.store.history.revertOf(c.sha);
      if (by && !seen.has(by)) {
        seen.add(by);
        reverts.push({ commit: by, reverted: c.sha, summary: c.subject });
      }
      if (c.kind === 'incident' || c.kind === 'fix') for (const r of this.store.history.incidentsOf(c.sha)) incidents.push({ commit: c.sha, ref: r.ref, summary: c.subject });
    }
    const adrs = this.store.history.adrsFor(symbol).map((a) => ({ path: a.path, title: a.title, status: a.status, excerpt: a.text.replace(/^#.*\n/, '').trim().slice(0, 400) }));
    const coChange = this.store.edges.outgoing(symbol, 'co_changes').sort((a, b) => b.weight - a.weight).slice(0, 10).map((e) => ({ symbol: e.dst, support: e.weight, confidence: e.confidence }));
    return { commits, reverts, incidents: incidents.slice(0, 10), adrs, coChange };
  }

  /** Co-change rules strong enough to be conventions ("when A changes, B changes too"). */
  conventions(minConfidence = 0.8, minSupport = 3): CoChangeConvention[] {
    const out: CoChangeConvention[] = [];
    for (const e of this.store.edges.allOfKinds(['co_changes'])) {
      if (e.source !== 'history' || e.confidence < minConfidence || e.weight < minSupport) continue;
      out.push({ id: `cochange:${e.src}->${e.dst}`, text: `when \`${nameOf(e.src)}\` changes, \`${nameOf(e.dst)}\` usually changes too (${e.weight} commits)`, confidence: e.confidence, evidence: e.weight, entities: [e.src, e.dst, e.src.slice(0, e.src.indexOf('#'))], source: 'history' });
    }
    return out.sort((a, b) => b.evidence - a.evidence).slice(0, 20);
  }

  /** The compiler's view of history (`HistoryFacts` in @riaf/compiler). */
  facts() {
    return {
      blame: (symbol: SymbolId, limit = 3) => this.blame(symbol, limit).map((e) => ({ commit: e.commit, at: e.at, summary: `${e.summary}${e.refs.length ? ` [${e.refs.join(', ')}]` : ''}${e.revertedBy ? ` (reverted by ${e.revertedBy.slice(0, 10)})` : ''}`, author: e.author })),
      incidents: (symbol: SymbolId, limit = 3) => {
        const r = this.rationale(symbol);
        const out: { commit: string; at: string; summary: string; kind: 'revert' | 'incident' | 'fix' }[] = [];
        for (const v of r.reverts) out.push({ commit: v.commit, at: this.store.history.commit(v.commit)?.at ?? '', summary: `reverted ${v.reverted.slice(0, 10)}: ${v.summary}`, kind: 'revert' });
        for (const i of r.incidents) out.push({ commit: i.commit, at: this.store.history.commit(i.commit)?.at ?? '', summary: `${i.ref}: ${i.summary}`, kind: /INC-/.test(i.ref) ? 'incident' : 'fix' });
        return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
      },
      origin: (symbol: SymbolId) => {
        const all = this.store.history.blame(symbol).filter((b) => !this.store.history.commit(b.commit)?.noise);
        const first = all.sort((a, b) => (a.at < b.at ? -1 : 1))[0];
        if (!first) return undefined;
        return { commit: first.commit, at: first.at, summary: first.subject, files: this.store.history.filesOf(first.commit).map((f) => f.path) };
      },
      recent: (path: string, limit = 2) => this.store.history.commitsTouching(path, 20).filter((c) => !c.noise).slice(0, limit)
        .map((c) => ({ commit: c.sha, at: c.at, summary: this.store.history.summary(c.sha)?.goal ?? c.subject })),
      adrs: (symbol: SymbolId, limit = 2) => this.store.history.adrsFor(symbol).slice(0, limit).map((a) => ({ path: a.path, title: a.title, excerpt: a.text.replace(/^#.*\n/, '').trim().slice(0, 300) })),
    };
  }
}
