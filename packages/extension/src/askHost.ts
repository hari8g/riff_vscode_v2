import type { RpcResult, WikiNodeShape } from '@riaf/kernel';
import { areaName, areaOf, composeAnswer, isTest, LENSES, parseQuestion, stem, type Answer, type Evidence, type Lens, type Parsed, type SubjectHit } from './ask.js';
import type { Rpc } from './tools.js';

/** One step of the compiled question plan, as shown to the person asking. */
export interface PlanStep { id: 'understand' | 'locate' | 'gather' | 'compile' | 'compose'; label: string; detail: string; ms: number; calls: string[] }

export interface Vocabulary { title: string; summary: string; areas: { id: string; name: string; files: number }[] }

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const KIND_WEIGHT: Record<string, number> = { class: 1.2, function: 1, interface: 0.8, method: 0.7, type: 0.6, enum: 0.6, const: 0.4, property: 0.1, constructor: -0.5 };
const files = (summary: string) => Number(summary.match(/(\d+) files?/)?.[1] ?? 0);
const TESTISH = /(^|\/)(test|tests|__tests__|spec|fixtures?)\/$/;

/** Product areas: the deepest source directories (leaves of the wiki tree), tests excluded. */
export function vocabularyOf(tree: WikiNodeShape): Vocabulary {
  const dirs: WikiNodeShape[] = [];
  const walk = (n: WikiNodeShape) => {
    if (n.level === 'directory' && TESTISH.test(n.id)) return;
    if (n.level === 'directory') dirs.push(n);
    n.children.filter((c) => c.level === 'directory').forEach(walk);
  };
  walk(tree);
  const leaves = dirs.filter((d) => d.children.every((c) => c.level !== 'directory'));
  const areas = (leaves.length ? leaves : dirs).map((d) => ({ id: d.id, name: areaName(d.id), files: files(d.summary) }));
  return { title: tree.title, summary: tree.summary, areas };
}

let vocabCache: { at: number; v: Vocabulary } | undefined;
async function vocabulary(rpc: Rpc): Promise<Vocabulary> {
  if (vocabCache && Date.now() - vocabCache.at < 30_000) return vocabCache.v;
  const { tree } = await rpc.call('wiki.structure', { depth: 4 });
  vocabCache = { at: Date.now(), v: vocabularyOf(tree) };
  return vocabCache.v;
}
/** Forgets cached product areas (after a re-index, and between tests). */
export const resetAskCache = () => { vocabCache = undefined; };

/** Fast path while typing: how the question is read, before anything is fetched. */
export async function understand(rpc: Rpc, text: string, lens?: Lens): Promise<{ parsed: Parsed; areas: Vocabulary['areas'] }> {
  const v = await vocabulary(rpc);
  return { parsed: parseQuestion(text, v.areas.map((a) => a.id), lens), areas: v.areas };
}

const NEEDS: Record<Lens, { impact?: true; history?: true; areas?: true; pack?: true; usedBy?: true }> = {
  explain: { areas: true, pack: true, usedBy: true },
  impact: { impact: true, history: true },
  history: { history: true },
  people: { history: true },
  scope: { impact: true, areas: true, pack: true },
  quality: { impact: true, history: true },
  overview: { areas: true },
};

/** Compiles a plain-language question into lookups, runs them, and composes the answer. */
export async function answerQuestion(rpc: Rpc, text: string, lens?: Lens): Promise<{ parsed: Parsed; plan: PlanStep[]; evidence: Evidence; answer: Answer }> {
  const plan: PlanStep[] = [];
  let t = performance.now();
  const lap = (step: Omit<PlanStep, 'ms'>) => { const now = performance.now(); plan.push({ ...step, ms: Math.round(now - t) }); t = now; };

  // 1. Understand: lenses, subjects, timeframe; the router's developer intent alongside.
  const v = await vocabulary(rpc);
  const parsed = parseQuestion(text, v.areas.map((a) => a.id), lens);
  const route = await rpc.call('route', { text, ide: { interactive: true } });
  const lenses: Lens[] = [parsed.primary, ...(parsed.secondary ? [parsed.secondary] : [])];
  lap({ id: 'understand', label: 'Understand the question', calls: ['parse', 'route'],
    detail: `Read as “${lenses.join(' + ')}”${parsed.timeframe ? `, limited to the ${parsed.timeframe.label}` : ''}; ${parsed.subjects.length} subject${parsed.subjects.length === 1 ? '' : 's'} spotted.` });

  // 2. Locate: look up every candidate, then rank (named code, word overlap, kind, area, router grounding).
  const calls: string[] = [];
  const named = parsed.subjects.filter((s) => s.kind === 'code' || s.kind === 'quoted').slice(0, 4);
  const terms = parsed.subjects.filter((s) => s.kind === 'term');
  const termWords = [...new Set(terms.flatMap((t) => t.words ?? [t.text]))].slice(0, 6);
  const queries = [...named.map((s) => s.text), ...termWords.map(cap)];
  const jumps = await Promise.all(queries.map((q) => rpc.call('graph.jump', { query: q }).catch(() => undefined)));
  queries.forEach((q) => calls.push(`graph.jump(${q})`));
  const anchors = route.anchors.filter((a) => !isTest(a)).slice(0, 10);
  const anchorJumps = await Promise.all(anchors.map((a) => rpc.call('graph.jump', { symbol: a }).catch(() => undefined)));
  if (anchors.length) calls.push(`graph.jump × ${anchors.length} router anchors`);
  const namedAreas = new Set(parsed.subjects.filter((s) => s.area).map((s) => s.area!));
  const stems = [...new Set(termWords.map(stem).filter((w) => w.length >= 4))];
  type Cand = { hit: SubjectHit; refs: { symbol: string; path: string; line: number; kind: string }[]; score: number };
  const cands = new Map<string, Cand>();
  const consider = (j: RpcResult<'graph.jump'> | undefined, from: SubjectHit['from'], bonus: number) => {
    const d = j?.definition;
    if (!j || !d || isTest(d.symbol) || /@file$/.test(d.symbol)) return;
    const kind = d.kind ?? d.symbol.slice(d.symbol.lastIndexOf('@') + 1);
    const area = areaOf(d.path, v.areas);
    const name = (d.symbol.split('#')[1] ?? '').toLowerCase();
    const overlap = stems.filter((w) => name.includes(w)).length;
    const score = bonus + overlap * 2 + (KIND_WEIGHT[kind] ?? 0.3) + (namedAreas.size ? (namedAreas.has(area) ? 1.5 : -1) : 0);
    const prev = cands.get(d.symbol);
    if (prev && prev.score >= score) return;
    cands.set(d.symbol, { hit: { symbol: d.symbol, path: d.path, line: d.startLine, kind, signature: d.signature, ...(d.doc ? { doc: d.doc } : {}), area, from }, refs: j.references, score: Math.max(score, prev?.score ?? -Infinity) });
  };
  const missing: string[] = [];
  named.forEach((s, i) => { if (jumps[i]?.definition) consider(jumps[i], 'named', 5); else missing.push(s.text); });
  termWords.forEach((_, i) => consider(jumps[named.length + i], 'index', 0.5));
  anchors.forEach((_, i) => consider(anchorJumps[i], 'index', 0.8 - i * 0.08));
  const inScope = (c: Cand) => c.hit.from === 'named' || !namedAreas.size || namedAreas.has(c.hit.area);
  const productLevel = lenses[0] === 'overview' && !named.length;
  const ranked = productLevel ? [] : [...cands.values()].filter(inScope).sort((a, b) => b.score - a.score);
  const keep = ranked.filter((c, i) => i < 8 && (c.score > 0.6 || (i === 0 && c.score > 0)));
  const subjects = keep.map((c) => c.hit);
  const usedBy: Evidence['usedBy'] = (keep[0]?.refs ?? []).filter((r) => (r.kind === 'invokes' || r.kind === 'calls') && !isTest(r.symbol)).map((r) => ({ symbol: r.symbol, path: r.path, line: r.line }));
  const found = subjects.map((s) => (s.symbol.split('#')[1] ?? '').toLowerCase());
  const unmatched = terms.filter((t) => !(t.words ?? [t.text]).some((w) => stem(w).length >= 3 && found.some((f) => f.includes(stem(w))))).map((t) => t.text);
  const areaIds = new Set([...namedAreas, ...subjects.slice(0, 3).map((s) => s.area).filter(Boolean)]);
  lap({ id: 'locate', label: 'Find what it is about', calls,
    detail: subjects.length ? `Ranked ${cands.size} candidate${cands.size === 1 ? '' : 's'}; kept ${subjects.length} in ${areaIds.size || 1} area${areaIds.size === 1 ? '' : 's'}${missing.length ? `; ${missing.length} name${missing.length === 1 ? '' : 's'} not in the code` : ''}.` : missing.length ? `Nothing in the code matches ${missing.map((m) => `“${m}”`).join(', ')}.` : 'No specific part named; answering at the product level.' });

  // 3. Gather evidence for the lenses in play.
  const need = Object.assign({}, ...lenses.map((l) => NEEDS[l])) as (typeof NEEDS)[Lens];
  const main = lenses.includes('overview') && !named.length ? undefined : subjects[0];
  const gathered: string[] = [];
  const evidence: Evidence = { repo: { title: v.title, summary: v.summary, areas: v.areas }, subjects, missing, ...(unmatched.length ? { unmatched } : {}), areas: [], ...(usedBy.length ? { usedBy } : {}),
    intent: { w: route.w, H: route.H, branch: route.branch } };
  const tasks: Promise<void>[] = [];
  if (need.impact && main) tasks.push(rpc.call('graph.impact', { symbols: [main.symbol], hops: 2 }).then((r) => { evidence.impact = r; gathered.push('graph.impact'); }));
  if (need.history) {
    const q = main ? main.symbol.split('#')[1]!.replace(/@.*$/, '') : parsed.subjects[0]?.text;
    const area0 = main?.area ?? [...areaIds][0];
    if (q) tasks.push(rpc.call('history.rationale', { query: q }).then(async (r) => {
      gathered.push(`history.rationale(${q})`);
      let commits = r.commits;
      const area = area0;
      if (commits.length < 3 && area) {
        const tl = await rpc.call('history.timeline', { path: area.replace(/\/$/, ''), limit: 40 });
        gathered.push(`history.timeline(${area})`);
        const seen = new Set(commits.map((c) => c.commit));
        commits = [...commits, ...tl.entries.filter((e) => !seen.has(e.commit))];
      }
      evidence.history = { commits, reverts: r.reverts, incidents: r.incidents, adrs: r.adrs };
    }));
  }
  if (need.areas) {
    const ids = lenses.includes('overview') && !areaIds.size ? v.areas.map((a) => a.id) : [...areaIds].slice(0, 4);
    tasks.push(Promise.all(ids.map((id) => rpc.call('wiki.page', { node: id }).then((p) => ({
      id, name: areaName(id), summary: p.summary.split('\n')[0] ?? '',
      files: p.children.map((c) => ({ name: c.id.split('/').filter(Boolean).pop() ?? c.id, text: c.summary.replace(/^[^—]*—\s*/, '') })),
    })).catch(() => undefined))).then((pages) => { evidence.areas = pages.filter((p): p is NonNullable<typeof p> => !!p); gathered.push(`wiki.page ×${ids.length}`); }));
  }
  await Promise.all(tasks);
  lap({ id: 'gather', label: 'Gather the evidence', calls: gathered,
    detail: [evidence.impact ? `${evidence.impact.closure.length} dependent parts, ${evidence.impact.tests.length} checks` : '', evidence.history ? `${evidence.history.commits.length} changes` : '', evidence.areas.length ? `${evidence.areas.length} area page${evidence.areas.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'Nothing more needed.' });

  // 4. Compile a context pack: what a developer (or an agent) would be handed for the same question.
  if (need.pack) {
    const r = await rpc.call('pack.compile', { request: { text, ide: { interactive: true } }, target: 'json', sessionId: 'ask', budget: 8000 });
    evidence.pack = { packId: r.pack.packId, tokensUsed: r.pack.tokensUsed, budget: r.pack.budget, items: r.pack.items.length, files: [...new Set(r.pack.items.map((i) => ('path' in i.source ? i.source.path : undefined)).filter((p): p is string => !!p))] };
    lap({ id: 'compile', label: 'Compile a context pack', calls: ['pack.compile'], detail: `${r.pack.items.length} items, ${r.pack.tokensUsed.toLocaleString()} of ${r.pack.budget.toLocaleString()} tokens, ready to hand to a developer.` });
  }

  // 5. Compose the plain-language answer.
  const answer = composeAnswer(parsed, evidence);
  lap({ id: 'compose', label: 'Write the answer', calls: [], detail: `${answer.blocks.length} views, ${answer.sources.length} sources, confidence ${answer.confidence}.` });
  return { parsed, plan, evidence, answer };
}

export const isLens = (x: unknown): x is Lens => typeof x === 'string' && (LENSES as readonly string[]).includes(x);
