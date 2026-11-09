import type { SqliteDriver } from './driver/types.js';

/** Sessions, tool calls, pack reads, priors, the tool cache and skills (migration 0007). */

export interface ToolCallRecord {
  sessionId: string;
  seq: number;
  at: string;
  phase: string;
  tool: string;
  argsKey: string;
  argsJson: string;
  decision: string;
  tokens: number;
}

export interface SkillRecord {
  id: string;
  entityId: string;
  purpose: string;
  playbook: string;
  apis: string[];
  trajectoryId: string;
  createdAt: string;
  uses: number;
}

interface SkillRow { id: string; entity_id: string; purpose: string; playbook: string; apis: string; trajectory_id: string; created_at: string; uses: number }
const skillFromRow = (r: SkillRow): SkillRecord => ({ id: r.id, entityId: r.entity_id, purpose: r.purpose, playbook: r.playbook, apis: r.apis ? r.apis.split('\n') : [], trajectoryId: r.trajectory_id, createdAt: r.created_at, uses: Number(r.uses) });

export class GovernRepo {
  constructor(private readonly db: SqliteDriver) {}

  startSession(id: string, at: string, request?: string): void {
    this.db.run('INSERT OR IGNORE INTO session(id, started_at, request) VALUES (?, ?, ?)', [id, at, request ?? null]);
    if (request) this.db.run('UPDATE session SET request = COALESCE(request, ?) WHERE id = ?', [request, id]);
  }

  setSessionPack(id: string, packId: string): void {
    this.db.run('UPDATE session SET pack_id = ? WHERE id = ?', [packId, id]);
  }

  endSession(id: string, at: string, outcome: string): void {
    this.db.run('UPDATE session SET ended_at = ?, outcome = ? WHERE id = ?', [at, outcome, id]);
  }

  session(id: string): { id: string; startedAt: string; endedAt?: string; outcome?: string; request?: string; packId?: string } | undefined {
    const r = this.db.get<{ id: string; started_at: string; ended_at: string | null; outcome: string | null; request: string | null; pack_id: string | null }>('SELECT * FROM session WHERE id = ?', [id]);
    return r ? { id: r.id, startedAt: r.started_at, ...(r.ended_at ? { endedAt: r.ended_at } : {}), ...(r.outcome ? { outcome: r.outcome } : {}), ...(r.request ? { request: r.request } : {}), ...(r.pack_id ? { packId: r.pack_id } : {}) } : undefined;
  }

  recordCall(c: ToolCallRecord): void {
    this.db.run('INSERT OR REPLACE INTO tool_call(session_id, seq, at, phase, tool, args_key, args_json, decision, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [c.sessionId, c.seq, c.at, c.phase, c.tool, c.argsKey, c.argsJson, c.decision, c.tokens]);
  }

  setCallTokens(sessionId: string, seq: number, tokens: number): void {
    this.db.run('UPDATE tool_call SET tokens = ? WHERE session_id = ? AND seq = ?', [tokens, sessionId, seq]);
  }

  calls(sessionId: string): ToolCallRecord[] {
    return this.db.all<{ session_id: string; seq: number; at: string; phase: string; tool: string; args_key: string; args_json: string; decision: string; tokens: number }>(
      'SELECT * FROM tool_call WHERE session_id = ? ORDER BY seq', [sessionId],
    ).map((r) => ({ sessionId: r.session_id, seq: Number(r.seq), at: r.at, phase: r.phase, tool: r.tool, argsKey: r.args_key, argsJson: r.args_json, decision: r.decision, tokens: Number(r.tokens) }));
  }

  recordPackRead(sessionId: string, packId: string, itemIds: readonly string[], at: string): void {
    this.db.transaction(() => {
      for (const i of itemIds) this.db.run('INSERT OR IGNORE INTO pack_read(session_id, pack_id, item_id, at) VALUES (?, ?, ?, ?)', [sessionId, packId, i, at]);
    });
  }

  packReads(sessionId: string, packId: string): string[] {
    return this.db.all<{ item_id: string }>('SELECT item_id FROM pack_read WHERE session_id = ? AND pack_id = ?', [sessionId, packId]).map((r) => r.item_id);
  }

  /** Per-rule utilisation across all packs: items read / items delivered. */
  utilisationByRule(): { rule: string; intent: string; delivered: number; read: number }[] {
    return this.db.all<{ rule: string; intent: string; delivered: number; read: number }>(
      `SELECT pi.rule AS rule, pi.intent AS intent, COUNT(*) AS delivered,
              SUM(CASE WHEN pr.item_id IS NOT NULL THEN 1 ELSE 0 END) AS read
       FROM pack_item pi JOIN pack p ON p.pack_id = pi.pack_id
       LEFT JOIN pack_read pr ON pr.pack_id = pi.pack_id AND pr.item_id = pi.item_id AND pr.session_id = p.session_id
       WHERE p.session_id IS NOT NULL
       GROUP BY pi.rule, pi.intent ORDER BY delivered DESC`,
    ).map((r) => ({ rule: r.rule, intent: r.intent, delivered: Number(r.delivered), read: Number(r.read) }));
  }

  setPriors(priors: Record<string, number>, at: string): void {
    this.db.transaction(() => {
      for (const [intent, weight] of Object.entries(priors)) this.db.run('INSERT OR REPLACE INTO prior(intent, weight, updated_at) VALUES (?, ?, ?)', [intent, weight, at]);
    });
  }

  priors(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.all<{ intent: string; weight: number }>('SELECT intent, weight FROM prior')) out[r.intent] = Number(r.weight);
    return out;
  }

  cacheGet(key: string): { result: string; blobs: string } | undefined {
    return this.db.get<{ result: string; blobs: string }>('SELECT result, blobs FROM tool_cache WHERE key = ?', [key]);
  }

  cachePut(key: string, tool: string, result: string, blobs: string, at: string): void {
    this.db.run('INSERT OR REPLACE INTO tool_cache(key, tool, result, blobs, created_at) VALUES (?, ?, ?, ?, ?)', [key, tool, result, blobs, at]);
  }

  addSkill(s: Omit<SkillRecord, 'uses'>): void {
    this.db.run('INSERT OR REPLACE INTO skill(id, entity_id, purpose, playbook, apis, trajectory_id, created_at, uses) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT uses FROM skill WHERE id = ?), 0))',
      [s.id, s.entityId, s.purpose, s.playbook, s.apis.join('\n'), s.trajectoryId, s.createdAt, s.id]);
  }

  skillsFor(entities: readonly string[], limit = 5): SkillRecord[] {
    if (entities.length === 0) return [];
    const files = entities.map((e) => e.slice(0, e.indexOf('#') < 0 ? e.length : e.indexOf('#')));
    const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
    return this.db.all<SkillRow>(
      `SELECT * FROM skill WHERE entity_id IN (${ph(entities.length)}) OR substr(entity_id, 1, instr(entity_id, '#') - 1) IN (${ph(files.length)})
       ORDER BY CASE WHEN entity_id IN (${ph(entities.length)}) THEN 0 ELSE 1 END, uses DESC, created_at DESC LIMIT ?`,
      [...entities, ...files, ...entities, limit],
    ).map(skillFromRow);
  }

  markSkillUsed(id: string): void {
    this.db.run('UPDATE skill SET uses = uses + 1 WHERE id = ?', [id]);
  }

  skillCount(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill')?.n ?? 0);
  }

  allSkills(): SkillRecord[] {
    return this.db.all<SkillRow>('SELECT * FROM skill ORDER BY created_at DESC').map(skillFromRow);
  }
}
