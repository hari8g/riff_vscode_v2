import { hashWith, INTENTS, shortHash, type Pack, type SymbolId } from '@riaf/kernel';
import type { Graph } from '@riaf/graph';
import type { Store, ToolCallRecord } from '@riaf/store';
import { EDIT_TOOLS, isTestCommand, relPath } from './normalize.js';

/**
 * Learning from sessions: pack utilisation (which delivered items the agent actually looked at),
 * per-repo intent priors fed back to the router, and distillation of successful trajectories into
 * entity-grounded skills (the SkillForge pattern).
 */

interface Touch {
  path: string;
  start?: number;
  end?: number;
}

/** Files and line ranges a session read or edited. */
export function touches(root: string, calls: readonly ToolCallRecord[]): Touch[] {
  const out: Touch[] = [];
  for (const c of calls) {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(c.argsJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const path = relPath(root, args['file_path']);
    if (!path) continue;
    if (c.tool === 'Read') {
      const offset = typeof args['offset'] === 'number' ? args['offset'] : undefined;
      const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
      out.push({ path, ...(offset !== undefined ? { start: offset } : {}), ...(offset !== undefined && limit !== undefined ? { end: offset + limit } : {}) });
    } else if (EDIT_TOOLS.has(c.tool)) out.push({ path });
  }
  return out;
}

/** Items of `pack` the session touched (a whole-file touch counts for every item in that file). */
export function utilisedItems(pack: Pack, t: readonly Touch[]): string[] {
  const out: string[] = [];
  for (const i of pack.items) {
    const s = i.source as { path?: string; range?: { startLine: number; endLine: number } };
    if (!s.path) continue;
    const hit = t.some((x) => x.path === s.path && (x.start === undefined || !s.range || (x.start <= s.range.endLine && (x.end ?? Number.MAX_SAFE_INTEGER) >= s.range.startLine)));
    if (hit) out.push(i.id);
  }
  return out;
}

/** Records utilisation for a session's pack; returns the share of path-bearing items touched. */
export function recordUtilisation(store: Store, root: string, sessionId: string, at: string): number | undefined {
  const json = store.compileLog.pack(undefined, sessionId);
  if (!json) return undefined;
  const pack = JSON.parse(json) as Pack;
  const used = utilisedItems(pack, touches(root, store.govern.calls(sessionId)));
  store.govern.recordPackRead(sessionId, pack.packId, used, at);
  const withPath = pack.items.filter((i) => (i.source as { path?: string }).path).length;
  return withPath ? used.length / withPath : undefined;
}

/**
 * Per-repo priors: how often each intent is the top reading of routes here, smoothed (+1) and blended
 * half-and-half with uniform so a few sessions cannot lock the router into one reading.
 */
export function recomputePriors(store: Store, at: string, window = 200): Record<string, number> {
  const rows = store.driver.all<{ w_json: string }>('SELECT w_json FROM route ORDER BY created_at DESC LIMIT ?', [window]);
  const counts: Record<string, number> = Object.fromEntries(INTENTS.map((i) => [i, 1]));
  for (const r of rows) {
    const w = JSON.parse(r.w_json) as Record<string, number>;
    let top = 'unknown';
    for (const i of INTENTS) if ((w[i] ?? 0) > (w[top] ?? 0)) top = i;
    counts[top] = (counts[top] ?? 1) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const priors = Object.fromEntries(INTENTS.map((i) => [i, 0.5 * (counts[i]! / total) + 0.5 / INTENTS.length]));
  store.govern.setPriors(priors, at);
  return priors;
}

/** Distils a successful session into skills grounded on the symbols it changed. Returns skill ids. */
export function distill(store: Store, graph: Graph, root: string, sessionId: string, at: string): string[] {
  const session = store.govern.session(sessionId);
  if (!session) return [];
  const calls = store.govern.calls(sessionId);
  const edited = [...new Set(touches(root, calls.filter((c) => EDIT_TOOLS.has(c.tool))).map((t) => t.path))];
  if (edited.length === 0) return [];
  const packJson = store.compileLog.pack(undefined, sessionId);
  const anchors = packJson ? (JSON.parse(packJson) as Pack).items.filter((i) => i.why.rule === 'anchor').map((i) => (i.source as { path?: string }).path) : [];
  // entities: symbols in edited files that the pack anchored on, else the edited files' top symbols
  const entities: SymbolId[] = [];
  for (const path of edited.slice(0, 3)) {
    const syms = store.symbols.byPath(path).filter((s) => s.kind !== 'file' && s.kind !== 'test');
    const anchored = anchors.includes(path) ? syms.filter((s) => !s.parentId || s.parentId.endsWith('#@file')) : [];
    entities.push(...(anchored.length ? anchored.slice(0, 2) : syms.slice(0, 1)).map((s) => s.id));
  }
  if (entities.length === 0) entities.push(...edited.slice(0, 2).map((p) => `${p}#@file` as SymbolId));
  const steps: string[] = [];
  for (const c of calls) {
    const args = JSON.parse(c.argsJson) as Record<string, unknown>;
    const p = relPath(root, args['file_path']);
    const step = c.tool === 'Read' && p ? `read ${p}` : EDIT_TOOLS.has(c.tool) && p ? `edit ${p}` : c.tool === 'Bash' && isTestCommand(args['command']) ? `run \`${String(args['command']).slice(0, 80)}\`` : c.tool.startsWith('mcp__') || c.tool.startsWith('riaf_') ? `call ${c.tool.replace(/^mcp__\w+__/, '')}` : undefined;
    if (step && steps[steps.length - 1] !== step) steps.push(step);
  }
  const purpose = (session.request ?? 'change').split(/(?<=[.!?])\s/)[0]!.slice(0, 160);
  const view = graph.view();
  const ids: string[] = [];
  for (const e of entities.slice(0, 3)) {
    const i = view.idx(e);
    const apis = i === undefined ? [] : view.out[i]!.filter((x) => x.kind === 'invokes').slice(0, 6).map((x) => view.ids[x.to]!);
    const id = `sk-${shortHash(hashWith('skill', e, purpose), 12)}`;
    store.govern.addSkill({ id, entityId: e, purpose, playbook: steps.slice(0, 12).join(' → '), apis, trajectoryId: sessionId, createdAt: at });
    ids.push(id);
  }
  return ids;
}
