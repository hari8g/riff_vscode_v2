/**
 * Plain-language question layer for people who do not read code (product owners, analysts, managers).
 * Pure: parsing, scoring and answer composition only, so the webview shares the vocabulary and the tests need no daemon.
 *
 * A question is read as a distribution over "lenses" (what kind of answer the person wants), the same way
 * the router reads a developer task as a distribution over intents. Subjects are the parts of the product
 * the question is about: named code, quoted phrases and product areas.
 */

export const LENSES = ['explain', 'impact', 'history', 'people', 'scope', 'quality', 'overview'] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_INFO: Record<Lens, { label: string; ask: string; color: string; icon: string }> = {
  explain: { label: 'How it works', ask: 'Explain how something works', color: 'var(--teal)', icon: 'overview' },
  impact: { label: 'What a change affects', ask: 'See what a change would touch', color: 'var(--i-merge)', icon: 'graph' },
  history: { label: 'What changed and why', ask: 'Trace changes and decisions', color: 'var(--i-review)', icon: 'history' },
  people: { label: 'Who knows it', ask: 'Find the people who know it', color: 'var(--i-onboarding)', icon: 'commit' },
  scope: { label: 'Plan a request', ask: 'Size a new request', color: 'var(--i-refactor)', icon: 'sparkle' },
  quality: { label: 'Risk and testing', ask: 'Check how safe it is', color: 'var(--ember)', icon: 'alert' },
  overview: { label: 'Map of the product', ask: 'Get the big picture', color: 'var(--slate)', icon: 'repository' },
};

interface Cue { lens: Lens; re: RegExp; w: number }
/** Phrases that signal each lens; weights are relative evidence, not probabilities. */
const CUES: Cue[] = [
  { lens: 'explain', re: /\bhow (?:does|do|is|are|can)\b/g, w: 2 },
  { lens: 'explain', re: /\bwhat (?:does|do|is|are)\b/g, w: 1.2 },
  { lens: 'explain', re: /\bwhat happens (?:when|after|before)\b/g, w: 2.2 },
  { lens: 'explain', re: /\b(?:explain|describe|walk me through|works?|work out|flow|process|end up|purpose|meaning)\b/g, w: 1.4 },
  { lens: 'impact', re: /\bwhat (?:happens|would happen|breaks?) if\b/g, w: 2.6 },
  { lens: 'impact', re: /\b(?:impact|affect(?:s|ed)?|break(?:s|ing)?|ripple|depend(?:s|ent|encies|ency)?|blast radius|knock-on|downstream|touch(?:es|ed)?)\b/g, w: 1.8 },
  { lens: 'impact', re: /\bif we (?:change|remove|replace|rename|drop|switch|turn off|disable)\b/g, w: 2.2 },
  { lens: 'history', re: /\b(?:why (?:was|is|did|do|does|are)|when did|what changed|changed|history|recently|lately|last (?:week|month|quarter|year|release)|since|decision|decided|reverted|rolled back)\b/g, w: 1.8 },
  { lens: 'history', re: /\bwhy\b/g, w: 1 },
  { lens: 'people', re: /\b(?:who|whom|owner|owns|ownership|expert|knows?|worked on|maintainer|contact|responsible|team)\b/g, w: 2 },
  { lens: 'scope', re: /\b(?:we want to|we need to|we'd like to|could we|can we|should we|add(?:ing)?|build|introduce|support|new feature|requirement|request|story|epic|estimate|effort|how (?:hard|long|much work|big)|feasible|feasibility)\b/g, w: 1.7 },
  { lens: 'quality', re: /\b(?:tested|tests?|coverage|safe(?:ly|ty)?|risk(?:y|s)?|bugs?|incidents?|fragile|reliable|stable|quality|regressions?|failures?)\b/g, w: 1.8 },
  { lens: 'overview', re: /\b(?:overview|big picture|main (?:parts|areas|components|modules)|architecture|what is this (?:repo|repository|project|product|service)|what does this (?:repo|repository|project|product|service) do|map|areas|modules|components)\b/g, w: 2.2 },
];

const STOP = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these this those to was we were what when where which who why will with would you your about after before any each more most other some such only own same just also out up down over under again further here once all both few no nor not very s t don now new make get like want need tell show give know let well much many big small good best part parts thing things way get gets got used use uses last past day days week weeks month months quarter year years today yesterday'.split(' '));
const HEAD_WORDS = new Set(['What', 'How', 'Who', 'Why', 'When', 'Where', 'Which', 'Can', 'Could', 'Should', 'If', 'We', 'Is', 'Are', 'Does', 'Do', 'Did', 'The', 'A', 'An', 'Please', 'Show', 'Tell', 'Explain', 'Give', 'I', 'Our', 'Would', 'Will', 'Has', 'Have']);

export interface Span { start: number; end: number; lens: Lens }
export interface Subject { text: string; kind: 'code' | 'quoted' | 'area' | 'term'; area?: string; /** Content words of a term phrase. */ words?: string[] }
export interface Timeframe { label: string; days: number }
/** "recently" or "in the last month", for use inside a sentence. */
export const during = (t: Timeframe) => (t.label === 'recently' ? 'recently' : `in the ${t.label}`);
export interface Parsed {
  text: string;
  /** Probability per lens, summing to 1. */
  p: Record<Lens, number>;
  /** Normalised entropy of `p` in [0, 1]: low is a confident reading. */
  H: number;
  primary: Lens;
  /** A second lens strong enough to answer alongside the first. */
  secondary?: Lens;
  /** single: one clear reading; blended: two; unclear: ask the person to pick. */
  reading: 'single' | 'blended' | 'unclear';
  spans: Span[];
  subjects: Subject[];
  timeframe?: Timeframe;
}

/** Light stemmer for matching question words to area names ("disputes" ~ "dispute", "pricing" ~ "price"). */
export const stem = (w: string) => w.toLowerCase().replace(/ies$/, 'y').replace(/(?:ation|ition|ment|ness|ing|ed|es|(?<!s)s)$/, '').replace(/e$/, '');

/** Human name of a product area from its directory id: `src/disputes/` → "Disputes". */
export const areaName = (id: string) => {
  const leaf = id.replace(/\/$/, '').split('/').pop() || id;
  const words = leaf.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Splits code names into words: `ReadingDeduper.accept` → "Reading deduper › accept". */
export function humanize(symbolOrName: string): string {
  const id = symbolOrName.includes('#') ? symbolOrName.slice(symbolOrName.indexOf('#') + 1) : symbolOrName;
  const name = id.replace(/@[\w-]+$/, '');
  if (!name) return areaName(symbolOrName.slice(0, symbolOrName.indexOf('#')).replace(/\.[^.]+$/, ''));
  if (/\s/.test(name)) return name; // test titles are already prose
  return name.split('.').map((part, i) => {
    const words = part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').trim();
    const lower = words.toLowerCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }).join(' › ');
}

/** What a code kind is, in words a non-developer recognises. */
export const KIND_WORD: Record<string, string> = {
  class: 'component', interface: 'data shape', type: 'data shape', enum: 'list of options', function: 'action', method: 'action',
  property: 'field', constructor: 'setup step', const: 'setting', variable: 'value', test: 'automated check', file: 'file', module: 'module',
};
export const kindWord = (kind?: string) => (kind ? KIND_WORD[kind] ?? kind : 'part');
export const symbolKind = (id: string) => id.slice(id.lastIndexOf('@') + 1);
export const symbolPath = (id: string) => (id.includes('#') ? id.slice(0, id.indexOf('#')) : id);
export const isTest = (id: string) => symbolKind(id) === 'test' || /(^|\/)(test|tests|__tests__)\//.test(symbolPath(id)) || /\.(test|spec)\.\w+$/.test(symbolPath(id));

/** Reads a plain-language question into lenses, subjects and a timeframe. `areas` are directory ids such as `src/disputes/`. */
export function parseQuestion(text: string, areas: readonly string[] = [], forced?: Lens): Parsed {
  const lower = text.toLowerCase();
  const score: Record<Lens, number> = Object.fromEntries(LENSES.map((l) => [l, 0.25])) as Record<Lens, number>;
  const spans: Span[] = [];
  for (const c of CUES) {
    c.re.lastIndex = 0;
    for (let m = c.re.exec(lower); m; m = c.re.exec(lower)) {
      score[c.lens] += c.w;
      spans.push({ start: m.index, end: m.index + m[0].length, lens: c.lens });
    }
  }
  // "why" questions about people ("who decided") and history overlap; a named person-word wins people.
  if (forced) score[forced] += 100;
  const total = LENSES.reduce((a, l) => a + score[l], 0);
  const p = Object.fromEntries(LENSES.map((l) => [l, score[l] / total])) as Record<Lens, number>;
  const H = -LENSES.reduce((a, l) => a + (p[l] > 0 ? p[l] * Math.log(p[l]) : 0), 0) / Math.log(LENSES.length);
  const ranked = [...LENSES].sort((a, b) => p[b] - p[a]);
  const top = ranked[0]!, second = ranked[1]!;
  const cueless = total <= LENSES.length * 0.25 + 1e-9;
  let primary: Lens = cueless ? 'explain' : top;
  const blended = !cueless && p[second] >= 0.2 && p[second] >= p[top] * 0.45 && !(top === 'overview' && second === 'explain');
  const reading: Parsed['reading'] = forced ? 'single' : cueless || H > 0.9 ? 'unclear' : blended ? 'blended' : 'single';
  if (cueless && /^\W*(?:what|which)\b/.test(lower) && /\b(?:repo|repository|project|product|service|system)\b/.test(lower)) primary = 'overview';
  return {
    text, p, H, primary, ...(blended && !forced ? { secondary: second } : {}), reading,
    spans: mergeSpans(spans), subjects: findSubjects(text, areas), ...timeframeOf(lower),
  };
}

function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) continue;
    out.push(s);
  }
  return out;
}

/** Named code, quoted phrases, product areas and remaining content words, most specific first. */
export function findSubjects(text: string, areas: readonly string[] = []): Subject[] {
  const out: Subject[] = [];
  const seen = new Set<string>();
  const add = (s: Subject) => {
    const k = `${s.kind}:${s.text.toLowerCase()}`;
    if (seen.has(k) || seen.has(`code:${s.text.toLowerCase()}`)) return;
    seen.add(k);
    out.push(s);
  };
  for (const m of text.matchAll(/["“'`]([^"”'`]{2,60})["”'`]/g)) add({ text: m[1]!.trim(), kind: 'quoted' });
  const words = [...text.matchAll(/[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*/g)];
  for (const [i, m] of words.entries()) {
    const w = m[0].replace(/\.$/, '');
    const camel = /[a-z0-9][A-Z]/.test(w) || /[A-Za-z]\.[A-Za-z]/.test(w) || /_/.test(w);
    const proper = /^[A-Z][a-z]+$/.test(w) && i > 0 && !HEAD_WORDS.has(w) && !/[.?!]\s*$/.test(text.slice(0, m.index));
    if (camel || proper) add({ text: w, kind: 'code' });
  }
  const stems = new Map(areas.map((a) => [stem(areaName(a).replace(/\s+/g, '')), a] as const));
  for (const m of words) {
    const a = stems.get(stem(m[0]));
    if (a) add({ text: areaName(a), kind: 'area', area: a });
  }
  // Remaining content words, grouped into noun phrases of up to three adjacent words ("monthly pass discount").
  const covered = new Set(out.flatMap((s) => s.text.toLowerCase().split(/[\s.]+/)));
  const cur = { words: [] as string[], end: 0 };
  const flush = () => { if (cur.words.length) add({ text: cur.words.join(' '), kind: 'term', words: [...cur.words] }); cur.words = []; };
  for (const m of words) {
    const w = m[0].toLowerCase();
    const content = w.length >= 3 && !STOP.has(w) && !covered.has(w) && !/^[A-Z]/.test(m[0]) && !isCueWord(w);
    if (!content) { flush(); continue; }
    const joined = cur.words.length > 0 && cur.words.length < 3 && /^[\s-]+$/.test(text.slice(cur.end, m.index));
    if (!joined) flush();
    cur.words.push(w);
    cur.end = m.index! + m[0].length;
  }
  flush();
  return out;
}

const CUE_WORDS = new Set('add adding explain describe works work flow process happens happen impact affect affects affected break breaks breaking ripple depend depends dependent dependencies change changes changed history recently lately since decision decided reverted owner owns expert knows worked maintainer contact responsible team want need build introduce support feature requirement request story estimate effort hard long feasible tested tests test coverage safe safely risk risky bugs incidents fragile reliable stable quality regressions overview picture main parts areas modules components architecture remove replace rename drop switch disable much work'.split(' '));
const isCueWord = (w: string) => CUE_WORDS.has(w);

function timeframeOf(lower: string): { timeframe?: Timeframe } {
  const m = lower.match(/\b(?:in the |over the |during the )?(?:last|past) (\d+ )?(day|week|month|quarter|year)s?\b/);
  if (m) {
    const n = Number(m[1] ?? 1);
    const unit: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
    return { timeframe: { label: `last ${m[1] ?? ''}${m[2]}${n > 1 ? 's' : ''}`.replace(/\s+/g, ' '), days: n * unit[m[2]!]! } };
  }
  if (/\b(?:recently|lately|latest|these days)\b/.test(lower)) return { timeframe: { label: 'recently', days: 90 } };
  return {};
}

// ── Evidence and answers ─────────────────────────────────────────────────────

export interface Commit { commit: string; at: string; author: string; summary: string; kind: string; noise?: boolean | undefined; lines?: number | undefined; refs?: string[] | undefined; revertedBy?: string | undefined }
export interface SubjectHit { symbol: string; path: string; line: number; kind: string; signature?: string; doc?: string; area: string; from: 'named' | 'index' }
export interface AreaInfo { id: string; name: string; summary: string; files: { name: string; text: string }[] }
export interface Evidence {
  repo: { title: string; summary: string; areas: { id: string; name: string; files: number }[] };
  subjects: SubjectHit[];
  /** Code or quoted names the question used that the index could not find. */
  missing: string[];
  /** Plain-language phrases with no matching part in the code (new concepts, for a request). */
  unmatched?: string[];
  areas: AreaInfo[];
  usedBy?: { symbol: string; path: string; line: number }[];
  impact?: { closure: { symbol: string; distance: number; via: string }[]; tests: string[]; coChange: { symbol: string; support: number; confidence: number }[] };
  history?: { commits: Commit[]; reverts: { commit: string; reverted: string; summary: string }[]; incidents: { commit: string; ref: string; summary: string }[]; adrs: { path: string; title: string; status: string; excerpt: string }[] };
  pack?: { packId: string; tokensUsed: number; budget: number; items: number; files: string[] };
  intent?: { w: Record<string, number>; H: number; branch: string };
}

export type Block =
  | { kind: 'pieces'; title: string; items: { name: string; what: string; area: string; where: string; symbol: string }[] }
  | { kind: 'areas'; title: string; items: { id: string; name: string; summary: string; files: { name: string; text: string }[]; weight: number }[] }
  | { kind: 'flow'; title: string; steps: { name: string; what: string; symbol: string }[] }
  | { kind: 'rings'; title: string; center: string; rings: { distance: number; items: { name: string; area: string; symbol: string }[] }[]; tests: string[]; byArea: Record<string, number> }
  | { kind: 'risk'; title: string; level: 'Low' | 'Medium' | 'High'; score: number; factors: { label: string; value: number; note: string }[] }
  | { kind: 'timeline'; title: string; items: { date: string; author: string; summary: string; type: string; commit: string; flag?: 'reverted' | 'incident' }[]; decisions: { title: string; status: string; excerpt: string; path: string }[] }
  | { kind: 'people'; title: string; items: { name: string; changes: number; lines: number; last: string; share: number }[] }
  | { kind: 'effort'; title: string; size: 'S' | 'M' | 'L' | 'XL'; drivers: { label: string; value: number }[]; questions: string[]; brief: string }
  | { kind: 'tests'; title: string; covered: number; total: number; items: string[] };

export interface Answer {
  lens: Lens;
  secondary?: Lens;
  headline: string;
  paragraphs: string[];
  confidence: 'high' | 'medium' | 'low';
  blocks: Block[];
  sources: { label: string; path: string; line?: number; symbol?: string }[];
  followUps: { text: string; lens: Lens }[];
  markdown: string;
}

const cap1 = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const an = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 3) => (xs.length <= max ? xs.join(xs.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, xs.length > 2 ? ', and $1' : ', $1') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const day = (iso: string) => iso.slice(0, 10);
const areaOfPath = (path: string, areas: readonly { id: string }[]) =>
  [...areas].sort((a, b) => b.id.length - a.id.length).find((a) => path.startsWith(a.id))?.id ?? (path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '');

/** Area id a file or symbol belongs to, given the product areas. */
export const areaOf = (pathOrSymbol: string, areas: readonly { id: string }[]) => areaOfPath(symbolPath(pathOrSymbol), areas);

/** Change-risk score in [0, 1] from breadth, spread across areas, test coverage and instability. */
export function riskOf(ev: Evidence): Extract<Block, { kind: 'risk' }> {
  const closure = ev.impact?.closure.filter((c) => !isTest(c.symbol)) ?? [];
  const tests = ev.impact?.tests.filter((t) => symbolKind(t) === 'test').length ?? 0;
  const areas = new Set(closure.map((c) => areaOf(c.symbol, ev.repo.areas)));
  const reverts = ev.history?.reverts.length ?? 0, incidents = ev.history?.incidents.length ?? 0, churn = ev.history?.commits.filter((c) => !c.noise).length ?? 0;
  const breadth = Math.min(1, closure.length / 12);
  const spread = Math.min(1, Math.max(0, areas.size - 1) / 3);
  const untested = tests === 0 ? 1 : Math.max(0, 1 - tests / (closure.length + 2));
  const instability = Math.min(1, (reverts + incidents) / 2 + churn / 20);
  const score = 0.35 * breadth + 0.2 * spread + 0.3 * untested + 0.15 * instability;
  return {
    kind: 'risk', title: 'Change risk', score, level: score < 0.33 ? 'Low' : score < 0.6 ? 'Medium' : 'High',
    factors: [
      { label: 'Reach', value: breadth, note: `${plural(closure.length, 'part')} depend on it` },
      { label: 'Spread', value: spread, note: `across ${plural(Math.max(1, areas.size), 'area')}` },
      { label: 'Test gap', value: untested, note: tests ? `${plural(tests, 'automated check')} guard it` : 'no automated checks found' },
      { label: 'Instability', value: instability, note: `${plural(churn, 'change')}, ${plural(reverts + incidents, 'rollback or incident', 'rollbacks or incidents')}` },
    ],
  };
}

/** Rough T-shirt size for a request from what it touches; a starting point for the team, not an estimate. */
export function effortOf(ev: Evidence, question: string): Extract<Block, { kind: 'effort' }> {
  const pieces = ev.subjects.filter((s) => !isTest(s.symbol));
  const areas = new Set([...pieces.map((s) => s.area), ...ev.areas.map((a) => a.id)].filter(Boolean));
  const reach = ev.impact?.closure.filter((c) => !isTest(c.symbol)).length ?? 0;
  const tests = ev.impact?.tests.filter((t) => symbolKind(t) === 'test').length ?? 0;
  const fresh = [...ev.missing, ...(ev.unmatched ?? [])];
  const points = pieces.length * 1 + areas.size * 2 + reach * 0.6 + tests * 0.4 + fresh.length * 1.5;
  const size = points < 6 ? 'S' : points < 12 ? 'M' : points < 20 ? 'L' : 'XL';
  const questions = [
    ...fresh.map((m) => `“${m}” does not exist in the code yet. Is it new, or does the team call it something else?`),
    ...(areas.size > 2 ? [`This reaches ${areas.size} areas. Should it ship in one release or in steps?`] : []),
    ...(tests === 0 && pieces.length ? ['No automated checks cover these parts. Should the work include adding them?'] : []),
    'What does “done” look like for the user? Write it as a checkable acceptance criterion.',
  ];
  const brief = [
    `## Request`, question, '',
    `## Likely areas`, ...[...areas].map((a) => `- ${areaName(a)} (\`${a}\`)`), '',
    `## Parts involved`, ...(pieces.length ? pieces.slice(0, 8).map((s) => `- ${humanize(s.symbol)} — \`${s.path}:${s.line}\``) : ['- none found yet']), '',
    `## Rough size: ${size}`, `Based on ${plural(pieces.length, 'part')}, ${plural(areas.size, 'area')}, ${plural(reach, 'dependent part')} and ${plural(tests, 'automated check')}. Confirm with the team.`, '',
    `## Open questions`, ...questions.map((q) => `- ${q}`), '',
    `## Acceptance criteria`, '- [ ] …', '',
    ...(ev.pack ? [`_Context pack for developers: \`${ev.pack.packId}\` (${ev.pack.tokensUsed} tokens)._`] : []),
  ].join('\n');
  return {
    kind: 'effort', title: 'Rough size', size, questions, brief,
    drivers: [
      { label: 'parts involved', value: pieces.length }, { label: 'areas', value: areas.size },
      { label: 'dependent parts', value: reach }, { label: 'automated checks to update', value: tests },
      { label: 'new concepts', value: fresh.length },
    ],
  };
}

function peopleOf(ev: Evidence): Extract<Block, { kind: 'people' }> {
  const by = new Map<string, { changes: number; lines: number; last: string }>();
  for (const c of ev.history?.commits ?? []) {
    if (c.noise) continue;
    const p = by.get(c.author) ?? { changes: 0, lines: 0, last: '' };
    p.changes++;
    p.lines += c.lines ?? 0;
    if (c.at > p.last) p.last = c.at;
    by.set(c.author, p);
  }
  const total = [...by.values()].reduce((a, p) => a + p.changes, 0) || 1;
  return {
    kind: 'people', title: 'People who know it',
    items: [...by.entries()].map(([name, p]) => ({ name, ...p, last: day(p.last), share: p.changes / total })).sort((a, b) => b.changes - a.changes || b.lines - a.lines),
  };
}

function timelineOf(ev: Evidence, days?: number): Extract<Block, { kind: 'timeline' }> {
  const h = ev.history;
  const reverted = new Set(h?.reverts.map((r) => r.reverted) ?? []);
  const incident = new Set(h?.incidents.map((i) => i.commit) ?? []);
  const newest = h?.commits.reduce((a, c) => (c.at > a ? c.at : a), '') ?? '';
  const cutoff = days && newest ? new Date(Date.parse(newest) - days * 86_400_000).toISOString() : '';
  return {
    kind: 'timeline', title: 'Changes over time',
    items: (h?.commits ?? []).filter((c) => !c.noise && c.at >= cutoff).sort((a, b) => b.at.localeCompare(a.at)).map((c) => ({
      date: day(c.at), author: c.author, summary: c.summary, type: TYPE_WORD[c.kind] ?? c.kind, commit: c.commit,
      ...(c.revertedBy || reverted.has(c.commit) ? { flag: 'reverted' as const } : incident.has(c.commit) ? { flag: 'incident' as const } : {}),
    })),
    decisions: (h?.adrs ?? []).map((a) => ({ title: a.title, status: a.status, excerpt: a.excerpt, path: a.path })),
  };
}
const TYPE_WORD: Record<string, string> = { feat: 'New capability', fix: 'Fix', refactor: 'Restructure', perf: 'Speed-up', test: 'Checks', docs: 'Documentation', chore: 'Housekeeping', revert: 'Rollback', merge: 'Merge', other: 'Change' };

function ringsOf(ev: Evidence, center: string): Extract<Block, { kind: 'rings' }> {
  const closure = (ev.impact?.closure ?? []).filter((c) => !isTest(c.symbol));
  const byArea: Record<string, number> = {};
  for (const c of closure) {
    const a = areaName(areaOf(c.symbol, ev.repo.areas) || 'other');
    byArea[a] = (byArea[a] ?? 0) + 1;
  }
  const distances = [...new Set(closure.map((c) => c.distance))].sort((a, b) => a - b);
  return {
    kind: 'rings', title: 'What a change would touch', center, byArea,
    rings: distances.map((d) => ({ distance: d, items: closure.filter((c) => c.distance === d).map((c) => ({ name: humanize(c.symbol), area: areaName(areaOf(c.symbol, ev.repo.areas)), symbol: c.symbol })) })),
    tests: (ev.impact?.tests ?? []).filter((t) => symbolKind(t) === 'test').map((t) => humanize(t)),
  };
}

const piece = (s: SubjectHit, ev: Evidence) => ({
  name: humanize(s.symbol), what: s.doc?.trim() || `${cap1(an(kindWord(s.kind)))} in ${areaName(s.area || areaOf(s.path, ev.repo.areas))}.`,
  area: areaName(s.area || areaOf(s.path, ev.repo.areas)), where: `${s.path}:${s.line}`, symbol: s.symbol,
});

/** Builds the plain-language answer for a parsed question from the gathered evidence. */
export function composeAnswer(q: Parsed, ev: Evidence): Answer {
  const lens = q.primary;
  const main = ev.subjects.find((s) => !isTest(s.symbol));
  const mainName = main ? humanize(main.symbol) : ev.areas[0]?.name ?? q.subjects[0]?.text ?? ev.repo.title;
  const blocks: Block[] = [];
  const paragraphs: string[] = [];
  let headline = '';
  const lensesToShow = [lens, ...(q.secondary ? [q.secondary] : [])];
  const pieces = ev.subjects.filter((s) => !isTest(s.symbol)).slice(0, 8).map((s) => piece(s, ev));
  const usedBy = (ev.usedBy ?? []).filter((r) => !isTest(r.symbol));

  for (const l of lensesToShow) {
    const first = l === lens;
    switch (l) {
      case 'explain': {
        if (first) {
          headline = main ? `${mainName} is ${an(kindWord(main.kind))} in the ${piece(main, ev).area} area${main.doc ? `: ${lowerFirst(main.doc.replace(/\.$/, ''))}` : ''}.`
            : ev.areas[0] ? `${ev.areas[0].name} is a product area with ${plural(ev.areas[0].files.length, 'file')}.` : `Here is what ${ev.repo.title} does.`;
        }
        if (main) {
          const users = [...new Set(usedBy.map((r) => humanize(r.symbol)))];
          paragraphs.push(users.length ? `${mainName} is used by ${list(users)}. ${pieces.length > 1 ? `Other parts involved in your question are ${list(pieces.slice(1).map((p) => p.name))}.` : ''}`.trim()
            : pieces.length > 1 ? `The parts involved in your question are ${list(pieces.map((p) => p.name))}.` : `Nothing else in the product calls ${mainName} directly.`);
          const steps = [...usedBy.slice(0, 3).map((r) => ({ name: humanize(r.symbol), what: `uses ${mainName}`, symbol: r.symbol })), { name: mainName, what: main.doc?.trim() || `the ${kindWord(main.kind)} you asked about`, symbol: main.symbol }];
          if (steps.length > 1) blocks.push({ kind: 'flow', title: 'How it fits together', steps });
        }
        if (pieces.length) blocks.push({ kind: 'pieces', title: 'Parts involved', items: pieces });
        if (ev.areas.length) blocks.push(areasBlock(ev, 'Where it lives'));
        break;
      }
      case 'impact': {
        const r = riskOf(ev);
        const closure = (ev.impact?.closure ?? []).filter((c) => !isTest(c.symbol));
        const direct = closure.filter((c) => c.distance === 1).length;
        if (first) headline = main ? `Changing ${mainName} would touch ${plural(closure.length, 'other part')}; the change risk is ${r.level.toLowerCase()}.` : `I could not find a specific part to assess. Name the component or area you plan to change.`;
        if (main) {
          paragraphs.push(`${plural(direct, 'part')} use${direct === 1 ? 's' : ''} ${mainName} directly${closure.length > direct ? ` and ${plural(closure.length - direct, 'more part')} depend on those` : ''}. ${ringsOf(ev, mainName).tests.length ? `${plural(ringsOf(ev, mainName).tests.length, 'automated check')} would catch a break.` : 'No automated checks cover it, so a break could reach users unnoticed.'}`);
          blocks.push(ringsOf(ev, mainName), r);
        }
        break;
      }
      case 'history': {
        const t = timelineOf(ev, q.timeframe?.days);
        const last = t.items[0];
        if (first) headline = last ? `${mainName} last changed on ${last.date}: “${last.summary}” by ${last.author}.` : `No recorded changes for ${mainName}${q.timeframe ? ` ${during(q.timeframe)}` : ''}.`;
        if (t.items.length) {
          const reverts = t.items.filter((i) => i.flag === 'reverted').length, incidents = t.items.filter((i) => i.flag === 'incident').length;
          paragraphs.push(`${plural(t.items.length, 'change')}${q.timeframe ? ` ${during(q.timeframe)}` : ' on record'} shaped it${[reverts ? plural(reverts, 'rollback') : '', incidents ? plural(incidents, 'linked incident') : ''].filter(Boolean).map((x) => `, including ${x}`).join('')}.${t.decisions.length ? ` ${plural(t.decisions.length, 'recorded decision')} explain why it is built this way.` : ''}`);
          blocks.push(t);
        }
        break;
      }
      case 'people': {
        const p = peopleOf(ev);
        const top = p.items[0];
        if (first) headline = top ? `${top.name} knows ${mainName} best, with ${plural(top.changes, 'change')} (${Math.round(top.share * 100)}% of the history).` : `No change history names anyone for ${mainName} yet.`;
        if (p.items.length > 1) paragraphs.push(`Also involved: ${list(p.items.slice(1).map((x) => `${x.name} (${plural(x.changes, 'change')})`))}.`);
        if (p.items.length) blocks.push(p);
        break;
      }
      case 'scope': {
        const e = effortOf(ev, q.text);
        if (first) headline = `This looks like a ${SIZE_WORD[e.size]} request (${e.size}): it touches ${plural(e.drivers[1]!.value, 'area')} and ${plural(e.drivers[0]!.value, 'existing part')}.`;
        const fresh = [...ev.missing, ...(ev.unmatched ?? [])];
        paragraphs.push(fresh.length ? `${list(fresh.map((m) => `“${m}”`))} ${fresh.length === 1 ? 'has' : 'have'} no counterpart in the code yet, so the request adds something new${pieces.length ? ` on top of ${list(pieces.slice(0, 3).map((p) => p.name))}` : ''}.` : `Everything the request names already exists, so this is a change to existing behaviour.`);
        blocks.push(e);
        if (pieces.length) blocks.push({ kind: 'pieces', title: 'Existing parts it builds on', items: pieces });
        if (ev.impact) blocks.push(riskOf(ev));
        break;
      }
      case 'quality': {
        const r = riskOf(ev);
        const tests = (ev.impact?.tests ?? []).filter((t) => symbolKind(t) === 'test');
        const closure = (ev.impact?.closure ?? []).filter((c) => !isTest(c.symbol));
        const covered = new Set(tests.map((t) => symbolPath(t).replace(/^test\//, '').replace(/\.(test|spec)\./, '.'))).size;
        if (first) headline = main ? `${mainName} is ${tests.length ? `guarded by ${plural(tests.length, 'automated check')}` : 'not covered by any automated check'}; overall risk is ${r.level.toLowerCase()}.` : 'Name a component or area to check how well it is tested.';
        if (main) {
          blocks.push({ kind: 'tests', title: 'Automated checks', covered: Math.min(covered, closure.length + 1), total: closure.length + 1, items: tests.map((t) => humanize(t)) }, r);
          const h = ev.history;
          const marks = [h?.reverts.length ? plural(h.reverts.length, 'rollback') : '', h?.incidents.length ? plural(h.incidents.length, 'linked incident') : ''].filter(Boolean);
          if (marks.length) paragraphs.push(`Its history has ${marks.join(' and ')}, so treat changes here with care.`);
        }
        break;
      }
      case 'overview': {
        if (first) headline = ev.repo.summary || `${ev.repo.title} has ${plural(ev.repo.areas.length, 'product area')}.`;
        paragraphs.push(`It is organised into ${plural(ev.repo.areas.length, 'area')}: ${list(ev.repo.areas.map((a) => a.name), 8)}.`);
        blocks.push({ kind: 'areas', title: 'Product areas', items: ev.repo.areas.map((a) => ({ id: a.id, name: a.name, summary: ev.areas.find((x) => x.id === a.id)?.summary ?? '', files: ev.areas.find((x) => x.id === a.id)?.files ?? [], weight: a.files })) });
        break;
      }
    }
  }
  if (ev.missing.length && lens !== 'scope') paragraphs.push(`I could not find ${list(ev.missing.map((m) => `“${m}”`))} in the code. It may be named differently, or it may not exist yet.`);

  const named = ev.subjects.filter((s) => s.from === 'named').length;
  const confidence: Answer['confidence'] = !ev.subjects.length && !ev.areas.length && !q.subjects.some((s) => s.area) && lens !== 'overview' ? 'low' : q.reading === 'unclear' || (ev.missing.length && !named) ? 'low' : q.reading === 'blended' || !named ? 'medium' : 'high';
  const sources = [
    ...ev.subjects.slice(0, 8).map((s) => ({ label: humanize(s.symbol), path: s.path, line: s.line, symbol: s.symbol })),
    ...ev.areas.map((a) => ({ label: `${a.name} area`, path: a.id })),
    ...(ev.history?.adrs ?? []).map((a) => ({ label: a.title, path: a.path })),
  ];
  const followUps = suggestFollowUps(lensesToShow, mainName);
  const answer: Answer = { lens, ...(q.secondary ? { secondary: q.secondary } : {}), headline, paragraphs: paragraphs.filter(Boolean), confidence, blocks, sources, followUps, markdown: '' };
  answer.markdown = toMarkdown(q, answer);
  return answer;
}

const SIZE_WORD = { S: 'small', M: 'medium', L: 'large', XL: 'very large' } as const;
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function areasBlock(ev: Evidence, title: string): Extract<Block, { kind: 'areas' }> {
  return { kind: 'areas', title, items: ev.areas.map((a) => ({ ...a, weight: ev.repo.areas.find((r) => r.id === a.id)?.files ?? a.files.length })) };
}

const FOLLOW: Record<Lens, (n: string) => string> = {
  explain: (n) => `How does ${n} work?`,
  impact: (n) => `What would be affected if we change ${n}?`,
  history: (n) => `What changed in ${n} recently and why?`,
  people: (n) => `Who knows the most about ${n}?`,
  scope: (n) => `We want to extend ${n}. How big is that?`,
  quality: (n) => `How well tested is ${n}?`,
  overview: () => 'What are the main areas of the product?',
};
/** Next questions worth asking about the same subject, through the lenses not used yet. */
export function suggestFollowUps(used: readonly Lens[], subject: string): { text: string; lens: Lens }[] {
  return LENSES.filter((l) => !used.includes(l) && l !== 'overview').slice(0, 4).map((l) => ({ text: FOLLOW[l](subject), lens: l }));
}

/** The answer as Markdown, for pasting into a ticket, wiki page or chat. */
export function toMarkdown(q: Parsed, a: Answer): string {
  const out = [`# ${q.text}`, '', `**${a.headline}**`, '', ...a.paragraphs.flatMap((p) => [p, ''])];
  for (const b of a.blocks) {
    out.push(`## ${b.title}`);
    switch (b.kind) {
      case 'pieces': out.push(...b.items.map((i) => `- **${i.name}** (${i.area}) — ${i.what} \`${i.where}\``)); break;
      case 'areas': out.push(...b.items.map((i) => `- **${i.name}** — ${i.summary.split('\n')[0] ?? ''}`)); break;
      case 'flow': out.push(...b.steps.map((s, i) => `${i + 1}. **${s.name}** — ${s.what}`)); break;
      case 'rings': out.push(...b.rings.map((r) => `- ${r.distance === 1 ? 'Directly' : `${r.distance} steps away`}: ${r.items.map((i) => i.name).join(', ')}`), `- Automated checks: ${b.tests.length}`); break;
      case 'risk': out.push(`**${b.level}** (${Math.round(b.score * 100)}/100)`, ...b.factors.map((f) => `- ${f.label}: ${f.note}`)); break;
      case 'timeline': out.push(...b.items.map((i) => `- ${i.date} · ${i.type} · ${i.summary} — ${i.author}${i.flag ? ` (${i.flag})` : ''}`), ...b.decisions.map((d) => `- Decision: ${d.title} (${d.status})`)); break;
      case 'people': out.push(...b.items.map((p) => `- ${p.name}: ${p.changes} changes, last ${p.last}`)); break;
      case 'effort': out.push(`Size **${b.size}**`, ...b.drivers.map((d) => `- ${d.label}: ${d.value}`), '', '### Open questions', ...b.questions.map((x) => `- ${x}`)); break;
      case 'tests': out.push(...b.items.map((t) => `- ${t}`)); break;
    }
    out.push('');
  }
  if (a.sources.length) out.push('## Sources', ...a.sources.map((s) => `- ${s.label}: \`${s.path}${s.line ? `:${s.line}` : ''}\``));
  return out.join('\n').trim() + '\n';
}
