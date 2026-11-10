import type { EventBus, PipelineEvents, SymbolId } from '@riaf/kernel';
import type { Store } from '@riaf/store';
import { runGraphStage, type GraphStageResult } from './build.js';
import { closure, type ClosureHit, type ClosureOptions } from './closure.js';
import { clusters, type Cluster } from './clusters.js';
import { impact, type Impact } from './impact.js';
import { graphInsights, symbolMetric, type GraphInsights, type InsightOptions, type SymbolMetric } from './insights.js';
import { jump, type JumpResult } from './jump.js';
import { repoMap, type RepoMap, type RepoMapOptions } from './repomap.js';
import { testsFor } from './tests.js';
import { GraphViewCache, personalizedPageRank, rankSymbols, type GraphView, type PprOptions } from './view.js';

/** The graph layer's public façade: what the daemon wires and the compiler calls. */
export class Graph {
  private readonly cache: GraphViewCache;

  constructor(readonly store: Store) {
    this.cache = new GraphViewCache(store);
  }

  /** Current in-memory view (rebuilt only when the graph stage bumped the version). */
  view(): GraphView {
    return this.cache.get();
  }

  /** Runs the incremental graph stage for blobs the parse stage has updated. */
  update(opts: { events?: EventBus<PipelineEvents>; force?: string[] } = {}): GraphStageResult {
    return runGraphStage(this.store, opts);
  }

  jump(query: string): JumpResult {
    return jump(this.store, query);
  }

  closure(seeds: readonly SymbolId[], opts?: ClosureOptions): ClosureHit[] {
    return closure(this.view(), seeds, opts);
  }

  impact(symbols: readonly SymbolId[], hops = 2): Impact {
    return impact(this.view(), symbols, hops);
  }

  repoMap(anchors: readonly SymbolId[], opts: RepoMapOptions): RepoMap {
    return repoMap(this.view(), anchors, opts);
  }

  ppr(anchors: readonly SymbolId[], k = 50, opts?: PprOptions): { symbol: SymbolId; score: number }[] {
    const v = this.view();
    return rankSymbols(v, personalizedPageRank(v, anchors, opts), k, { anchors, exclude: (s) => s.kind === 'file' }).map((r) => ({ symbol: r.symbol.id, score: r.score }));
  }

  tests(symbols: readonly SymbolId[]): SymbolId[] {
    return testsFor(this.view(), symbols);
  }

  clusters(): Cluster[] {
    return clusters(this.view());
  }

  /** Hubs, tangled definitions, untested hubs, unreferenced definitions and import cycles. */
  insights(opts?: InsightOptions): GraphInsights {
    return graphInsights(this.view(), opts);
  }

  /** Fan-in, fan-out and tests of one symbol. */
  metric(symbol: SymbolId): SymbolMetric | undefined {
    return symbolMetric(this.view(), symbol);
  }
}
