import type { SqliteDriver } from './driver/types.js';

/** Summaries (L3) and the compile log (routes, packs, pack items) — migration 0005. */

export interface SummaryRecord {
  /** `path` for files, `path/` for directories, `` for the repo root. */
  nodeId: string;
  level: 'file' | 'directory' | 'package' | 'repo';
  /** Blob or tree hash the summary was built from (cache key). */
  hash: string;
  text: string;
  /** `extractive` or the model id that wrote it. */
  model: string;
}

interface SummaryRow { node_id: string; level: string; hash: string; text: string; model: string }

export class SummaryRepo {
  constructor(private readonly db: SqliteDriver) {}

  get(nodeId: string): SummaryRecord | undefined {
    const r = this.db.get<SummaryRow>('SELECT * FROM summary WHERE node_id = ?', [nodeId]);
    return r ? { nodeId: r.node_id, level: r.level as SummaryRecord['level'], hash: r.hash, text: r.text, model: r.model } : undefined;
  }

  upsert(s: SummaryRecord, now = new Date()): void {
    this.db.run(
      `INSERT INTO summary(node_id, level, hash, text, model, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET level = excluded.level, hash = excluded.hash, text = excluded.text, model = excluded.model, updated_at = excluded.updated_at`,
      [s.nodeId, s.level, s.hash, s.text, s.model, now.toISOString()],
    );
  }

  delete(nodeId: string): void {
    this.db.run('DELETE FROM summary WHERE node_id = ?', [nodeId]);
  }

  /** Removes summaries whose node is not in `keep`. */
  prune(keep: ReadonlySet<string>): number {
    let n = 0;
    for (const r of this.db.all<{ node_id: string }>('SELECT node_id FROM summary')) {
      if (!keep.has(r.node_id)) n += this.db.run('DELETE FROM summary WHERE node_id = ?', [r.node_id]).changes;
    }
    return n;
  }

  byLevel(level: SummaryRecord['level']): SummaryRecord[] {
    return this.db.all<SummaryRow>('SELECT * FROM summary WHERE level = ? ORDER BY node_id', [level]).map((r) => ({ nodeId: r.node_id, level: r.level as SummaryRecord['level'], hash: r.hash, text: r.text, model: r.model }));
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM summary')?.n ?? 0);
  }
}

export interface RouteLogRecord {
  routeId: string;
  sessionId?: string;
  text: string;
  branch: string;
  H: number;
  w: Record<string, number>;
  json: string;
  createdAt: string;
}

export interface PackLogItem {
  itemId: string;
  tier: number;
  kind: string;
  path?: string;
  symbol?: string;
  intent: string;
  rule: string;
  score: number;
  tokens: number;
}

export interface PackLogRecord {
  packId: string;
  routeId?: string;
  sessionId?: string;
  createdAt: string;
  budget: number;
  tokensUsed: number;
  policyVersion: string;
  json: string;
  items: PackLogItem[];
}

export class CompileLog {
  constructor(private readonly db: SqliteDriver) {}

  recordRoute(r: RouteLogRecord): void {
    this.db.run('INSERT OR REPLACE INTO route(route_id, created_at, session_id, text, branch, h, w_json, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.routeId, r.createdAt, r.sessionId ?? null, r.text, r.branch, r.H, JSON.stringify(r.w), r.json]);
  }

  recordPack(p: PackLogRecord): void {
    this.db.transaction(() => {
      this.db.run('INSERT OR REPLACE INTO pack(pack_id, route_id, session_id, created_at, budget, tokens_used, policy_version, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [p.packId, p.routeId ?? null, p.sessionId ?? null, p.createdAt, p.budget, p.tokensUsed, p.policyVersion, p.json]);
      this.db.run('DELETE FROM pack_item WHERE pack_id = ?', [p.packId]);
      for (const i of p.items) {
        this.db.run('INSERT INTO pack_item(pack_id, item_id, tier, kind, path, symbol, intent, rule, score, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [p.packId, i.itemId, i.tier, i.kind, i.path ?? null, i.symbol ?? null, i.intent, i.rule, i.score, i.tokens]);
      }
    });
  }

  /** The pack JSON by id, or the most recent one (optionally within a session). */
  pack(packId?: string, sessionId?: string): string | undefined {
    if (packId) return this.db.get<{ json: string }>('SELECT json FROM pack WHERE pack_id = ?', [packId])?.json;
    const r = sessionId
      ? this.db.get<{ json: string }>('SELECT json FROM pack WHERE session_id = ? ORDER BY created_at DESC LIMIT 1', [sessionId])
      : this.db.get<{ json: string }>('SELECT json FROM pack ORDER BY created_at DESC LIMIT 1');
    return r?.json;
  }

  /** Branch counts over routes since `sinceIso` (telemetry and eval). */
  branchCounts(sinceIso = '1970-01-01T00:00:00Z'): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.all<{ branch: string; n: number }>('SELECT branch, COUNT(*) AS n FROM route WHERE created_at >= ? GROUP BY branch', [sinceIso])) out[r.branch] = Number(r.n);
    return out;
  }

  packCount(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pack')?.n ?? 0);
  }
}
