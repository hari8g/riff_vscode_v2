import { fileId, parseSymbolId, type ComposedPolicy, type ExpansionRule, type Intent, type OpenLookup, type SymbolId } from '@riaf/kernel';
import { closure, dynamicDispatchSites, inheritanceTree } from '@riaf/graph';
import type { SymbolRecord } from '@riaf/store';
import { siteCandidate, skeleton, symbolCandidate, type Candidate, type SourceCache } from './candidates.js';
import type { RepoView } from './view.js';

/**
 * Sufficiency expansion: starting from the anchors, each rule in the composed policy walks the graph
 * for what a model needs to act — the callers and callees of a bug site, the test to mimic, a sibling
 * to copy, the reference sites of a rename, summaries for orientation — and emits scored candidates.
 */

/** Prior weight of each rule's items relative to the anchors themselves (1.0). */
export const RULE_PRIOR: Record<string, number> = {
  anchor: 1, callers: 0.7, callees: 0.6, exercising_test: 0.65, sibling_template: 0.8, implemented_interfaces: 0.5,
  both_branch_touched: 0.6, co_change_partners: 0.5, tests_over: 0.5, invariants_on: 0.45, reference_closure: 0.75,
  inheritance_tree: 0.5, dynamic_dispatch_sites: 0.6, module_summaries: 0.7, file_skeletons: 0.6, one_hop: 0.5,
  conventions: 0.4, history: 0.55,
};

/** Primitive intents that own each rule (first present in the policy wins by weight). */
const RULE_OWNERS: Record<string, readonly Intent[]> = {
  callers: ['bugfix'], callees: ['bugfix'], exercising_test: ['bugfix', 'feature'], sibling_template: ['feature'], implemented_interfaces: ['feature'],
  both_branch_touched: ['merge'], tests_over: ['merge'], co_change_partners: ['merge', 'review'], invariants_on: ['review'],
  reference_closure: ['refactor'], inheritance_tree: ['refactor'], dynamic_dispatch_sites: ['refactor'],
  module_summaries: ['onboarding'], file_skeletons: ['onboarding'], one_hop: ['unknown'],
};

/** Budget buckets a rule's items draw from, in preference order. */
const RULE_BUCKETS: Record<string, readonly string[]> = {
  anchor: ['ingredients', 'template', 'closure', 'diff_context', 'diffs', 'grounded_hits', 'summaries', 'skeletons'],
  callers: ['ingredients', 'closure', 'grounded_hits'], callees: ['ingredients', 'closure', 'grounded_hits'],
  exercising_test: ['ingredients', 'tests', 'template'], sibling_template: ['template', 'ingredients'], implemented_interfaces: ['template', 'ingredients', 'closure'],
  reference_closure: ['closure', 'ingredients'], inheritance_tree: ['closure', 'ingredients'], dynamic_dispatch_sites: ['closure', 'ingredients'],
  co_change_partners: ['co_change', 'ingredients', 'closure'], tests_over: ['tests', 'ingredients'], invariants_on: ['invariants', 'conventions'],
  module_summaries: ['summaries', 'skeletons'], file_skeletons: ['skeletons', 'summaries'], one_hop: ['grounded_hits', 'ingredients'],
  conventions: ['conventions', 'invariants'], history: ['history'], both_branch_touched: ['diffs', 'ingredients'],
};

export interface ExpandContext {
  view: RepoView;
  src: SourceCache;
  policy: ComposedPolicy;
  /** Personalized PageRank from the anchors, normalised to [0, 1] per symbol. */
  ppr: (id: SymbolId) => number;
  candidates: Candidate[];
  lookups: OpenLookup[];
}

/** The intent and weight a rule acts for in this policy. */
export function ownerOf(policy: ComposedPolicy, rule: string): { intent: Intent; weight: number } {
  const owners = RULE_OWNERS[rule] ?? [];
  const present = policy.primitives.filter((p) => owners.includes(p.intent)).sort((a, b) => b.weight - a.weight)[0];
  return present ?? policy.primitives[0]!;
}

/** The bucket a rule's items are charged to, given the policy's variable shares. */
export function bucketOf(policy: ComposedPolicy, rule: string): string {
  const shares = policy.budget.variable;
  for (const b of RULE_BUCKETS[rule] ?? []) if ((shares[b] ?? 0) > 0) return b;
  return Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ingredients';
}

const words = (name: string) => new Set(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n / Math.max(wa.size, wb.size);
}

/** Stage of an anchor: the first stage whose units list it. */
export function stageOf(policy: ComposedPolicy, anchor: SymbolId): number {
  for (let s = 0; s < policy.stages.length; s++) {
    for (const uid of policy.stages[s]!) if (policy.units.find((u) => u.id === uid)?.anchors.includes(anchor)) return s;
  }
  return 0;
}

/** Runs every expansion rule, history scope and convention lookup of the policy. */
export function expand(ctx: ExpandContext): void {
  const { view, policy, src } = ctx;
  const sym = (id: SymbolId): SymbolRecord | undefined => view.store.symbols.get(id) ?? (parseSymbolId(id)?.kind === 'file' ? view.store.symbols.byPath(parseSymbolId(id)!.path).find((s) => s.kind === 'file') : undefined);
  const anchors = (policy.anchors as SymbolId[]).map((id) => sym(id)).filter((s): s is SymbolRecord => s !== undefined);
  const push = (c: Candidate | undefined) => {
    if (c && c.content.trim()) ctx.candidates.push(c);
  };
  const top = policy.primitives[0]!;
  // anchors first: what the request is about, bodies preferred
  anchors.forEach((a, rank) => {
    const score = (1 / (1 + 0.15 * rank)) * (0.6 + 0.4 * Math.max(ctx.ppr(a.id), 0.5));
    push(symbolCandidate(view, src, a, { intent: top.intent, rule: 'anchor', weight: top.weight, score, stage: stageOf(policy, a.id), bucket: bucketOf(policy, 'anchor'), maxBodyTokens: 900 }));
  });
  const fnAnchors = anchors.filter((a) => a.kind !== 'file');
  const anchorIds = anchors.map((a) => a.id);
  const graphView = view.graph.view();
  for (const r of policy.expansion) runRule(ctx, r, anchors, fnAnchors, anchorIds, graphView, sym, push);

  // conventions travel with feature and review work (their buckets exist only then)
  if ((policy.budget.variable['conventions'] ?? 0) > 0 || (policy.budget.variable['invariants'] ?? 0) > 0) {
    const owner = ownerOf(policy, 'sibling_template');
    for (const c of view.semantic.conventions(anchors.map((a) => a.path)).slice(0, 4)) {
      push({ key: `conv:${c.id}`, tier: 3, kind: 'convention', virtual: `convention:${c.id}`, content: `${c.text} (confidence ${c.confidence.toFixed(2)}, ${c.evidence} observations)`, intent: owner.intent, rule: 'conventions', weight: owner.weight, score: RULE_PRIOR['conventions']! * owner.weight * c.confidence, stage: 0, bucket: bucketOf(policy, 'conventions') });
    }
  }
  history(ctx, anchors);
  // skills: how this kind of change went before on the same entities
  if (view.skills && anchors.length) {
    const owner = policy.primitives[0]!;
    view.skills(anchors.map((a) => a.id)).slice(0, 2).forEach((sk, i) => push({
      key: `skill:${sk.id}`, tier: 3, kind: 'skill', virtual: `skill:${sk.id}`,
      content: `Skill (${sk.entityId.slice(sk.entityId.indexOf('#') + 1, sk.entityId.lastIndexOf('@')) || sk.entityId}): ${sk.purpose}\nPlaybook: ${sk.playbook}${sk.apis.length ? `\nAPIs: ${sk.apis.slice(0, 5).join(', ')}` : ''}`,
      intent: owner.intent, rule: 'skill', weight: owner.weight, score: 0.6 * owner.weight / (1 + 0.3 * i), stage: 0, bucket: bucketOf(policy, 'history'),
    }));
  }
}

function runRule(
  ctx: ExpandContext, r: ExpansionRule, anchors: SymbolRecord[], fnAnchors: SymbolRecord[], anchorIds: SymbolId[],
  graphView: ReturnType<RepoView['graph']['view']>, sym: (id: SymbolId) => SymbolRecord | undefined, push: (c: Candidate | undefined) => void,
): void {
  const { view, policy, src } = ctx;
  const owner = ownerOf(policy, r.rule);
  const prior = RULE_PRIOR[r.rule] ?? 0.5;
  const bucket = bucketOf(policy, r.rule);
  const base = (score: number, stage = 0) => ({ intent: owner.intent, rule: r.rule, weight: owner.weight, score: score * owner.weight, stage, bucket });
  const fromHits = (hits: { symbol: SymbolId; distance: number; confidence: number }[], k: number, maxBody: number) => {
    for (const h of hits.slice(0, k)) {
      const s = sym(h.symbol);
      if (!s || s.kind === 'file' || anchorIds.includes(s.id)) continue;
      push(symbolCandidate(view, src, s, { ...base(prior * h.confidence * (0.6 + 0.4 * ctx.ppr(s.id)) / h.distance), maxBodyTokens: maxBody }));
    }
  };
  switch (r.rule) {
    case 'callers':
      fromHits(closure(graphView, fnAnchors.map((a) => a.id), { direction: 'in', kinds: ['invokes'], hops: r.hops ?? 1, maxNodes: 30 }), 12, 400);
      break;
    case 'callees':
      fromHits(closure(graphView, fnAnchors.map((a) => a.id), { direction: 'out', kinds: ['invokes'], hops: r.hops ?? 1, maxNodes: 30 }), 12, 400);
      break;
    case 'one_hop':
      fromHits(closure(graphView, anchorIds, { direction: 'both', hops: 1, maxNodes: 20 }), 10, 200);
      break;
    case 'exercising_test':
    case 'tests_over': {
      const tests = view.graph.tests(anchorIds).map((t) => sym(t)).filter((t): t is SymbolRecord => t !== undefined && t.kind !== 'file');
      const names = anchors.map((a) => a.name).join(' ');
      tests.sort((a, b) => similarity(b.qualifiedName, names) - similarity(a.qualifiedName, names) || (a.endLine! - a.startLine!) - (b.endLine! - b.startLine!));
      const k = r.rule === 'exercising_test' ? 2 : 4;
      tests.slice(0, k).forEach((t, i) => push(symbolCandidate(view, src, t, { ...base(prior / (1 + 0.3 * i)), maxBodyTokens: r.rule === 'exercising_test' ? 500 : 0 })));
      break;
    }
    case 'sibling_template': {
      for (const a of anchors.slice(0, 3)) {
        const parentId = a.kind === 'file' ? a.id : CONTAINER.has(a.kind) ? a.id : a.parentId;
        if (!parentId) continue;
        const kind = a.kind === 'file' || CONTAINER.has(a.kind) ? undefined : a.kind;
        const sibs = view.store.symbols.children(parentId).filter((s) => s.id !== a.id && s.kind !== 'test' && (kind ? s.kind === kind : s.kind === 'function' || s.kind === 'method'));
        const scored = sibs.map((s) => ({ s, sim: similarity(s.name, policy.units.map((u) => u.text).join(' ')) + 0.2 })).sort((x, y) => y.sim - x.sim);
        for (const { s, sim } of scored.slice(0, 2)) push(symbolCandidate(view, src, s, { ...base(prior * Math.min(1, sim + 0.3), stageOf(policy, a.id)), maxBodyTokens: 400 }));
      }
      break;
    }
    case 'implemented_interfaces':
    case 'inheritance_tree': {
      for (const a of anchors.slice(0, 4)) {
        const cls = CONTAINER.has(a.kind) ? a : a.parentId ? sym(a.parentId) : undefined;
        if (!cls || cls.kind === 'file') continue;
        const t = inheritanceTree(graphView, cls.id, 3);
        const ids = r.rule === 'implemented_interfaces' ? t.ancestors : [...t.ancestors, ...t.descendants];
        for (const id of ids.slice(0, 6)) {
          const s = sym(id);
          if (s) push({ key: `skel:${s.id}`, tier: 2, kind: 'signature', path: s.path, symbol: s.id, startLine: s.startLine ?? 1, endLine: s.endLine ?? s.startLine ?? 1, content: skeleton(view, s, 1), ...base(prior) });
        }
      }
      break;
    }
    case 'reference_closure': {
      // the sites a rename or signature change must touch: each referencing line with context
      const max = 30;
      let n = 0;
      for (const a of anchors.filter((x) => x.kind !== 'file')) {
        const refs = view.store.refs.byName(a.name).filter((ref) => ref.scopeId !== a.id);
        const bound = new Set(view.store.edges.incoming(a.id).map((e) => e.src));
        for (const ref of refs) {
          if (n >= max) break;
          if (!bound.has(ref.scopeId) && !bound.has(fileId(ref.path))) continue;
          push(siteCandidate(src, ref.path, ref.line, 2, { ...base(prior), symbol: ref.scopeId }));
          n++;
        }
        // definitions that override or are overridden must change together
        for (const h of closure(graphView, [a.id], { direction: 'both', kinds: ['overrides'], hops: r.hops ?? 2 })) {
          const s = sym(h.symbol);
          if (s) push(symbolCandidate(view, src, s, { ...base(prior), maxBodyTokens: 200 }));
        }
      }
      break;
    }
    case 'dynamic_dispatch_sites': {
      for (const a of fnAnchors.filter((x) => x.kind === 'method').slice(0, 3)) {
        for (const site of dynamicDispatchSites(graphView, a.id).slice(0, 8)) {
          const s = sym(site.symbol);
          const ref = s ? view.store.refs.byScope(s.id).find((x) => x.name === a.name) : undefined;
          if (s && ref) push(siteCandidate(src, s.path, ref.line, 2, { ...base(prior * 0.9), symbol: s.id }));
        }
      }
      break;
    }
    case 'co_change_partners': {
      for (const a of anchors) {
        for (const e of view.store.edges.outgoing(a.id, 'co_changes').sort((x, y) => y.weight - x.weight).slice(0, 4)) {
          if (r.exclude === 'in_diff' && anchorIds.includes(e.dst)) continue;
          const s = sym(e.dst);
          if (s) push(symbolCandidate(view, src, s, { ...base(prior * Math.min(1, e.confidence)), maxBodyTokens: 0 }));
        }
      }
      break;
    }
    case 'module_summaries': {
      const dirs = new Set<string>(['']);
      for (const a of anchors) {
        let d = a.path;
        while (d.includes('/')) {
          d = d.slice(0, d.lastIndexOf('/'));
          dirs.add(`${d}/`);
        }
        dirs.add(a.path);
      }
      if (anchors.length === 0) for (const c of view.semantic.wikiStructure(1).children) dirs.add(c.id);
      const ordered = [...dirs].sort((x, y) => x.split('/').length - y.split('/').length || (x < y ? -1 : 1));
      ordered.forEach((d, i) => {
        const s = view.semantic.summary(d);
        if (s) push({ key: `sum:${d}`, tier: 1, kind: 'summary', ...(d && !d.endsWith('/') ? { path: d } : { virtual: `summary:${d || '/'}` }), content: s.text, ...base(prior / (1 + 0.1 * i)) });
      });
      const arch = view.semantic.architecture();
      push({ key: 'arch', tier: 1, kind: 'summary', virtual: 'architecture', content: [
        `languages: ${Object.entries(arch.languages).map(([l, n]) => `${l} ${n}`).join(', ')}`, arch.frameworks.length ? `frameworks: ${arch.frameworks.join(', ')}` : '',
        arch.entryPoints.length ? `entry points: ${arch.entryPoints.join(', ')}` : '', ...arch.clusters.map((c) => `cluster ${c.name}/: ${c.files} files`),
      ].filter(Boolean).join('\n'), ...base(prior * 0.8) });
      break;
    }
    case 'file_skeletons': {
      // the files a newcomer must read to follow the flow: what the anchors call (two hops, members
      // included, implementations behind interfaces), what they import, and the hub files personalized
      // PageRank ranks highest — ordered by PageRank with a boost for the anchors themselves
      const isTest = (p: string) => /(^|\/)(test|tests)\/|Test\.java$|_test\.|\.test\./.test(p);
      const fileRank = new Map<string, number>();
      for (let i = 0; i < graphView.size; i++) {
        const s = graphView.symbols[i]!;
        if (s.kind !== 'file' && !isTest(s.path)) fileRank.set(s.path, Math.max(fileRank.get(s.path) ?? 0, ctx.ppr(s.id)));
      }
      const pool = new Set<string>();
      for (const a of anchors) if (!isTest(a.path)) pool.add(a.path);
      const seeds = anchors.flatMap((a) => (a.kind === 'file' ? view.store.symbols.byPath(a.path).filter((s) => s.kind !== 'file').map((s) => s.id) : [a.id, ...view.store.symbols.children(a.id).map((c) => c.id)]));
      // follow the flow both ways: what the anchors call, and who calls them (a pipeline's driver)
      const flow = [
        ...closure(graphView, seeds, { direction: 'out', kinds: ['invokes', 'defines_type', 'inherits'], hops: 2, maxNodes: 80 }),
        ...closure(graphView, seeds, { direction: 'in', kinds: ['invokes'], hops: 2, maxNodes: 40 }),
      ];
      for (const h of flow) {
        const s = sym(h.symbol);
        if (!s || isTest(s.path)) continue;
        pool.add(s.path);
        const owner = s.kind === 'interface' ? s : s.parentId ? sym(s.parentId) : undefined;
        if (owner?.kind === 'interface') for (const d of inheritanceTree(graphView, owner.id, 2).descendants) { const ds = sym(d); if (ds && !isTest(ds.path)) pool.add(ds.path); }
      }
      for (const f of [...pool]) for (const imp of view.store.imports.byPath(f)) if (imp.resolved && !isTest(imp.resolved)) pool.add(imp.resolved);
      for (const [f] of [...fileRank.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) pool.add(f);
      const anchorFiles = new Set(anchors.map((a) => a.path));
      const order = [...pool].sort((a, b) => (fileRank.get(b) ?? 0) + (anchorFiles.has(b) ? 0.5 : 0) - ((fileRank.get(a) ?? 0) + (anchorFiles.has(a) ? 0.5 : 0)) || (a < b ? -1 : 1));
      order.slice(0, 10).forEach((f, i) => {
        const fs = view.store.symbols.byPath(f).find((s) => s.kind === 'file');
        if (!fs) return;
        const text = skeleton(view, { id: fs.id, path: f, kind: 'file' });
        if (text) push({ key: `skelfile:${f}`, tier: 2, kind: 'signature', path: f, symbol: fs.id, startLine: 1, endLine: fs.endLine ?? 1, content: text, ...base(prior / (1 + 0.12 * i)) });
      });
      break;
    }
    case 'invariants_on':
      // conventions are added once for the whole pack (see expand); nothing rule-specific here
      break;
    case 'both_branch_touched':
      ctx.lookups.push({ tool: 'riaf_history', args: { scope: 'both_branches' }, reason: 'merge context needs both branches’ changes; history mining arrives with M4' });
      break;
  }
}

const CONTAINER = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'namespace']);

function history(ctx: ExpandContext, anchors: SymbolRecord[]): void {
  const { view, policy } = ctx;
  if (policy.historyScope.length === 0) return;
  const h = view.history;
  const owner = ownerOf(policy, 'callers');
  const bucket = bucketOf(policy, 'history');
  const prior = RULE_PRIOR['history']!;
  // anchors in confidence order; a file anchor (active file, stack-trace file) gets file-wide history
  const fns = anchors.slice(0, 4);
  if (!h) {
    const target = fns.find((a) => a.kind !== 'file') ?? fns[0];
    if (target) ctx.lookups.push({ tool: 'riaf_history', args: { symbol: target.id }, reason: `history scope ${policy.historyScope.join(', ')} requested but the history layer is not indexed` });
    return;
  }
  const add = (key: string, commit: string, content: string, score: number) => {
    ctx.candidates.push({ key, tier: 3, kind: 'commit', commit, content, intent: owner.intent, rule: 'history', weight: owner.weight, score: score * owner.weight, stage: 0, bucket });
  };
  // bugs sit near the failure in recently changed code: the newest commits on the top anchors' files
  if (policy.historyScope.includes('blame_on_anchors')) {
    const files = [...new Set(fns.map((a) => a.path))].slice(0, 3);
    for (const f of files) {
      const recent = h.recent ? h.recent(f, 2) : h.blame(`${f}#@file` as SymbolId, 2);
      recent.forEach((b, k) => add(`blame:${b.commit}`, b.commit, `${b.commit.slice(0, 10)} ${b.at.slice(0, 10)} ${b.summary} (recent change in ${f})`, prior * (k === 0 ? 1.05 : 0.9)));
    }
  }
  for (const scope of policy.historyScope) {
    for (const a of fns) {
      if (scope === 'blame_on_anchors') h.blame(a.id, 3).forEach((b, k) => add(`blame:${b.commit}`, b.commit, `${b.commit.slice(0, 10)} ${b.at.slice(0, 10)} ${b.summary} (last touched ${a.kind === 'file' ? a.path : a.qualifiedName})`, prior * (k === 0 ? 1.1 : 1)));
      if (scope === 'reverts_touching_anchors' || scope === 'recent_incidents_on') for (const i of h.incidents(a.id, 3)) add(`inc:${i.commit}`, i.commit, `${i.kind}: ${i.commit.slice(0, 10)} ${i.at.slice(0, 10)} ${i.summary} (touches ${a.qualifiedName})`, prior * 1.1);
      if (scope === 'origin_commits_of_sibling') {
        const o = h.origin(a.id);
        if (o) add(`origin:${o.commit}`, o.commit, `${o.commit.slice(0, 10)} ${o.at.slice(0, 10)} ${o.summary} — introduced ${a.qualifiedName}; files: ${o.files.slice(0, 6).join(', ')}`, prior * 0.9);
      }
      if (scope === 'adrs') {
        for (const d of h.adrs(a.id, 2)) ctx.candidates.push({ key: `adr:${d.path}`, tier: 3, kind: 'summary', path: d.path, content: `${d.title}\n${d.excerpt}`, intent: owner.intent, rule: 'history', weight: owner.weight, score: prior * owner.weight, stage: 0, bucket });
      }
    }
  }
}
