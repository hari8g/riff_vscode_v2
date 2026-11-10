import type { EventBus, PipelineEvents } from '@riaf/kernel';
import { GRAPH_VERSION_KEY, type Graph } from '@riaf/graph';
import type { Store, SummaryRecord } from '@riaf/store';
import { deriveArchitecture, type Architecture } from './architecture.js';
import { mineConventions, type Convention } from './conventions.js';
import { buildGlossary, lookupTerms, type GlossaryTerm } from './glossary.js';
import { renderRunbook } from './runbook.js';
import { runSummaryStage, type SummaryStageResult } from './summaries.js';

export interface WikiNode {
  id: string;
  level: SummaryRecord['level'];
  title: string;
  summary: string;
  children: WikiNode[];
}

export interface WikiPage {
  id: string;
  level: SummaryRecord['level'] | 'unknown';
  summary: string;
  children: { id: string; summary: string }[];
  symbols: { id: string; kind: string; signature: string; doc?: string }[];
}

/** The semantic layer's façade: summaries, architecture, conventions, run-book and wiki pages. */
export class Semantic {
  private archCache: { version: string; value: Architecture } | undefined;
  private glossaryCache: { version: string; value: GlossaryTerm[] } | undefined;
  private extraConventions: () => readonly Convention[] = () => [];

  constructor(private readonly store: Store, private readonly graph: Graph, private readonly repoName = 'repository') {}

  /** Lets a higher layer (history in M4) contribute conventions. */
  setConventionSource(fn: () => readonly Convention[]): void {
    this.extraConventions = fn;
  }

  update(opts: { events?: EventBus<PipelineEvents> } = {}): SummaryStageResult {
    return runSummaryStage(this.store, opts);
  }

  summary(nodeId: string): SummaryRecord | undefined {
    return this.store.summaries.get(nodeId);
  }

  architecture(): Architecture {
    const version = `${this.store.kv.get(GRAPH_VERSION_KEY) ?? '0'}:${this.store.merkle.getTree('')?.hash ?? ''}`;
    if (!this.archCache || this.archCache.version !== version) this.archCache = { version, value: deriveArchitecture(this.store, this.graph) };
    return this.archCache.value;
  }

  /** The domain glossary (top 200 terms), cached until the graph changes; `top` trims the result. */
  glossary(top = 60): GlossaryTerm[] {
    const version = this.store.kv.get(GRAPH_VERSION_KEY) ?? '0';
    if (!this.glossaryCache || this.glossaryCache.version !== version) this.glossaryCache = { version, value: buildGlossary(this.store, { top: 200 }) };
    return this.glossaryCache.value.slice(0, top);
  }

  /** Glossary terms behind the words of a plain-language phrase. */
  terms(phrase: string): GlossaryTerm[] {
    return lookupTerms(this.glossary(200), phrase);
  }

  /** Conventions, optionally only those touching `entities` (repo-wide ones always apply). */
  conventions(entities?: readonly string[]): Convention[] {
    const all = mineConventions(this.store, this.extraConventions());
    if (!entities?.length) return all;
    const set = new Set(entities);
    return all.filter((c) => c.entities.length === 0 || c.entities.some((e) => set.has(e) || [...set].some((s) => s.startsWith(e) || e.startsWith(s))));
  }

  runbook(constraints?: string): string {
    return renderRunbook({ repoName: this.repoName, architecture: this.architecture(), conventions: this.conventions(), ...(constraints ? { constraints } : {}) });
  }

  /** The directory tree with summaries, `depth` levels deep. */
  wikiStructure(depth = 3): WikiNode {
    const build = (id: string, d: number): WikiNode => {
      const s = this.store.summaries.get(id);
      const prefix = id;
      const childDirs = new Set<string>();
      for (const p of this.store.merkle.paths()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i > 0) childDirs.add(`${prefix}${rest.slice(0, i)}/`);
      }
      return {
        id, level: s?.level ?? (id === '' ? 'repo' : 'directory'), title: id === '' ? this.repoName : id,
        summary: (s?.text ?? '').split('\n')[0] ?? '',
        children: d <= 0 ? [] : [...childDirs].sort().map((c) => build(c, d - 1)),
      };
    };
    return build('', depth);
  }

  /** One wiki page: a directory (with children) or a file (with its symbols). */
  wikiPage(node: string): WikiPage {
    const id = node === '.' || node === '/' ? '' : node;
    const s = this.store.summaries.get(id) ?? this.store.summaries.get(id.endsWith('/') ? id : `${id}/`);
    const key = s?.nodeId ?? id;
    if (s?.level === 'file' || (!s && this.store.merkle.getBlob(id))) {
      const syms = this.store.symbols.byPath(id).filter((x) => x.kind !== 'file');
      return { id, level: 'file', summary: s?.text ?? '', children: [], symbols: syms.map((x) => ({ id: x.id, kind: x.kind, signature: x.signature ?? x.name, ...(x.doc ? { doc: x.doc.split('\n')[0]! } : {}) })) };
    }
    const children: { id: string; summary: string }[] = [];
    const seen = new Set<string>();
    for (const p of this.store.merkle.paths()) {
      if (!p.startsWith(key)) continue;
      const rest = p.slice(key.length);
      const i = rest.indexOf('/');
      const child = i > 0 ? `${key}${rest.slice(0, i)}/` : p;
      if (seen.has(child)) continue;
      seen.add(child);
      children.push({ id: child, summary: (this.store.summaries.get(child)?.text ?? '').split('\n')[0] ?? '' });
    }
    return { id: key, level: s?.level ?? 'unknown', summary: s?.text ?? '', children, symbols: [] };
  }
}
