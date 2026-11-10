import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ask, repoName, save, saved } from '../api.js';
import { Btn, copy, Icon, IntentBar, INTENT_LABEL, pct, useDetailed, useToast } from '../kit.js';
import { LENS_INFO, LENSES, type Answer, type Block, type Evidence, type Lens, type Parsed } from '../../src/ask.js';
import type { PlanStep } from '../../src/askHost.js';

type Result = { parsed: Parsed; plan: PlanStep[]; evidence: Evidence; answer: Answer };
interface Turn { id: string; q: string; lens?: Lens; at: number; status: 'running' | 'done' | 'error'; error?: string; result?: Result }
type Area = { id: string; name: string; files: number };

const STEP_ICON: Record<PlanStep['id'], string> = { understand: 'sparkle', locate: 'target', gather: 'graph', compile: 'bolt', compose: 'check' };
const STEPS: PlanStep['id'][] = ['understand', 'locate', 'gather', 'compile', 'compose'];
const STEP_LABEL: Record<PlanStep['id'], string> = { understand: 'Understand', locate: 'Find', gather: 'Gather', compile: 'Compile', compose: 'Answer' };
const CONF_TEXT = { high: 'The question named things the index found exactly.', medium: 'Found by matching words or a blended reading; check the parts listed.', low: 'Little matched. Try naming a feature, screen or area.' };
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AREA_TONES = ['var(--teal)', 'var(--i-refactor)', 'var(--moss)', 'var(--i-merge)', 'var(--i-review)', 'var(--slate)'];
const toneOf = (s: string) => AREA_TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AREA_TONES.length]!;

function examples(areas: Area[]): Record<Lens, string[]> {
  const a = (i: number) => areas[i % Math.max(1, areas.length)]?.name.toLowerCase() ?? 'checkout';
  return {
    explain: [`How does the ${a(2)} area work?`, `What happens when a ${a(2).replace(/s$/, '')} is raised?`],
    impact: [`What would be affected if we change ${a(5)}?`, `What breaks if we turn off the ${a(1)} flags?`],
    history: [`What changed in ${a(5)} recently and why?`, `Why was the ${a(7)} area built this way?`],
    people: [`Who knows the most about the ${a(7)} area?`, `Who should I talk to about ${a(4)}?`],
    scope: [`We want to add a monthly pass discount for frequent drivers. How big is that?`, `Can we support SMS reminders before a charge?`],
    quality: [`How well tested is the ${a(7)} area?`, `Is ${a(6)} risky to change?`],
    overview: [`What are the main areas of this product?`, `Give me the big picture of ${repoName}`],
  };
}

export function Ask({ go }: { go: (page: string, arg?: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [forced, setForced] = useState<Lens | null>(null);
  const [live, setLive] = useState<Parsed | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [thread, setThread] = useState<Turn[]>(() => saved<Turn[]>('ask.thread', []).filter((t) => t.status === 'done'));
  const ta = useRef<HTMLTextAreaElement>(null);
  const ex = useMemo(() => examples(areas), [areas]);

  useEffect(() => void ask({ type: 'understand', text: '' }).then((r) => setAreas(r['areas'] as Area[])).catch(() => undefined), []);
  useEffect(() => save('ask.thread', thread.filter((t) => t.status === 'done').slice(0, 8)), [thread]);
  useEffect(() => {
    if (!text.trim()) { setLive(null); return; }
    const t = setTimeout(() => void ask({ type: 'understand', text, ...(forced ? { lens: forced } : {}) }).then((r) => setLive(r['parsed'] as Parsed)).catch(() => undefined), 180);
    return () => clearTimeout(t);
  }, [text, forced]);

  const run = async (q: string, lens?: Lens) => {
    if (!q.trim()) return ta.current?.focus();
    const id = `${Date.now()}`;
    setThread((th) => [{ id, q, ...(lens ? { lens } : {}), at: Date.now(), status: 'running' }, ...th]);
    setText('');
    setForced(null);
    try {
      const r = await ask({ type: 'ask', text: q, ...(lens ? { lens } : {}) });
      const result = { parsed: r['parsed'], plan: r['plan'], evidence: r['evidence'], answer: r['answer'] } as Result;
      setThread((th) => th.map((t) => (t.id === id ? { ...t, status: 'done', result } : t)));
    } catch (e) {
      setThread((th) => th.map((t) => (t.id === id ? { ...t, status: 'error', error: (e as Error).message } : t)));
    }
  };

  return (
    <div className="stack-lg askpage">
      <div className="page-h"><div>
        <h1>Ask a question</h1>
        <p className="lead">Ask about {repoName} in your own words. No code knowledge needed. RIAF works out what you want to know, finds the parts of the product involved, and shows how it got the answer.</p>
      </div>{thread.length ? <Btn kind="ghost" sm icon="refresh" onClick={() => setThread([])}>Clear answers</Btn> : null}</div>

      <section className="askbox">
        <div className="askbox-in">
          <textarea ref={ta} rows={2} value={text} placeholder="e.g. What would be affected if we change how prices are calculated?" aria-label="Your question"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(text, forced ?? undefined); } }} />
          <Btn kind="primary" icon="send" onClick={() => void run(text, forced ?? undefined)} disabled={!text.trim()}>Ask</Btn>
        </div>
        <Understanding text={text} p={live} forced={forced} onForce={(l) => setForced((f) => (f === l ? null : l))} />
      </section>

      {thread.length === 0 ? <Starters ex={ex} onPick={(q) => void run(q)} onFill={(q) => { setText(q); ta.current?.focus(); }} /> : null}
      {thread.map((t) => <TurnView key={t.id} t={t} go={go} onAsk={(q, l) => void run(q, l)} onCopy={(s, what) => { copy(s); toast(`${what} copied`); }}
        onHandoff={(to, packId) => void ask({ type: 'handoff', to, text: t.q, packId }).then(() => toast(`Handed to ${to === 'claude' ? 'Claude Code' : 'Copilot'}`)).catch((e: Error) => toast(e.message, 'err'))} />)}
      {thread.length === 0 ? <Glossary /> : null}
    </div>
  );
}

/* ───────── live reading of the question while typing ───────── */
function Understanding({ text, p, forced, onForce }: { text: string; p: Parsed | null; forced: Lens | null; onForce: (l: Lens) => void }) {
  const { detailed } = useDetailed();
  if (!text.trim() || !p) return <div className="understand idle"><span className="muted small">As you type, RIAF shows how it understands your question. If it gets it wrong, click the kind of answer you want.</span></div>;
  const ranked = [...LENSES].sort((a, b) => p.p[b] - p.p[a]);
  return (
    <div className="understand">
      <div className="u-text" aria-label="Highlighted question">{highlight(p.text, p)}</div>
      <div className="u-row">
        <span className="u-k">Understood as</span>
        <span className={`u-read ${p.reading}`}>{p.reading === 'single' ? LENS_INFO[p.primary].label : p.reading === 'blended' ? `${LENS_INFO[p.primary].label}, and ${LENS_INFO[p.secondary!].label.toLowerCase()}` : 'Not sure yet. Pick what you want below'}</span>
        {detailed ? <span className="muted small">certainty {pct(1 - p.H)}</span> : null}
      </div>
      <div className="lens-pills" role="radiogroup" aria-label="Kind of answer">
        {ranked.map((l) => (
          <button key={l} role="radio" aria-checked={forced === l} className={`lens-pill ${l === p.primary ? 'top' : ''} ${forced === l ? 'forced' : ''}`} style={{ ['--c' as string]: LENS_INFO[l].color }} onClick={() => onForce(l)} title={LENS_INFO[l].ask}>
            <span className="lp-fill" style={{ width: pct(p.p[l]) }} /><span>{LENS_INFO[l].label}</span>{detailed ? <b>{pct(p.p[l])}</b> : null}
          </button>
        ))}
      </div>
      {p.subjects.length || p.timeframe ? <div className="u-row">
        <span className="u-k">About</span>
        {p.subjects.map((s) => <span key={s.kind + s.text} className={`subj ${s.kind}`} title={s.kind === 'code' ? 'a name from the code' : s.kind === 'area' ? 'a product area' : s.kind === 'quoted' ? 'quoted phrase' : 'words to look up'}><Icon name={s.kind === 'area' ? 'folder' : s.kind === 'code' ? 'code' : 'search'} size={12} />{s.text}</span>)}
        {p.timeframe ? <span className="subj time">{p.timeframe.label}</span> : null}
      </div> : null}
    </div>
  );
}

function highlight(text: string, p: Parsed): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of p.spans) {
    if (s.start > at) out.push(text.slice(at, s.start));
    out.push(<mark key={s.start} style={{ ['--c' as string]: LENS_INFO[s.lens].color }} title={LENS_INFO[s.lens].label}>{text.slice(s.start, s.end)}</mark>);
    at = s.end;
  }
  out.push(text.slice(at));
  return out;
}

/* ───────── empty state ───────── */
function Starters({ ex, onPick, onFill }: { ex: Record<Lens, string[]>; onPick: (q: string) => void; onFill: (q: string) => void }) {
  return (
    <section className="starters">
      {LENSES.map((l, i) => (
        <div key={l} className="starter" style={{ ['--c' as string]: LENS_INFO[l].color, animationDelay: `${i * 40}ms` }}>
          <div className="starter-h"><b>{LENS_INFO[l].label}</b></div>
          <p className="muted small">{LENS_INFO[l].ask}</p>
          {ex[l].map((q) => <button key={q} className="starter-q" onClick={() => onPick(q)} onContextMenu={(e) => { e.preventDefault(); onFill(q); }} title="Click to ask · right-click to edit first">{q}</button>)}
        </div>
      ))}
    </section>
  );
}

function Glossary() {
  const words: [string, string][] = [
    ['Component', 'A self-contained building block of the product, such as a toll session or a pricing engine.'],
    ['Action', 'One thing the product does, such as “resolve a dispute”.'],
    ['Data shape', 'The fields a piece of information has, such as what a dispute records.'],
    ['Automated check', 'A test that runs on every change and fails if behaviour breaks.'],
    ['Area', 'A folder of related code, usually one product capability.'],
    ['Prepared context', 'The files and history RIAF hands a developer or AI assistant so they can start straight away.'],
  ];
  return (
    <section className="card glossary">
      <div className="card-h"><b>Words you will see in answers</b></div>
      <dl>{words.map(([w, d]) => <div key={w}><dt>{w}</dt><dd>{d}</dd></div>)}</dl>
    </section>
  );
}

/* ───────── one question and its answer ───────── */
function TurnView({ t, go, onAsk, onCopy, onHandoff }: { t: Turn; go: (p: string, a?: string) => void; onAsk: (q: string, l?: Lens) => void; onCopy: (s: string, what: string) => void; onHandoff: (to: 'claude' | 'copilot', packId: string) => void }) {
  const [shown, setShown] = useState(t.status === 'done' ? STEPS.length : 0);
  const [behind, setBehind] = useState(false);
  const { detailed } = useDetailed();
  useEffect(() => {
    if (t.status === 'running') {
      const i = setInterval(() => setShown((s) => (s + 1) % (STEPS.length - 1)), 420);
      return () => clearInterval(i);
    }
    if (t.status === 'done' && shown < STEPS.length) {
      setShown(0);
      let k = 0;
      const i = setInterval(() => { k++; setShown(k); if (k >= STEPS.length) clearInterval(i); }, 230);
      return () => clearInterval(i);
    }
    return undefined;
  }, [t.status]);
  const r = t.result;
  const a = r?.answer;
  const revealed = t.status === 'done' && shown >= STEPS.length;
  return (
    <article className={`turn ${t.status}`}>
      <header className="turn-q">
        <h3>{t.q}</h3>
        <span className="grow" />
        {a ? <><LensTag l={a.lens} />{a.secondary ? <LensTag l={a.secondary} /> : null}</> : null}
        <span className="muted small">{ago(t.at)}</span>
      </header>

      <Pipeline plan={r?.plan} running={t.status === 'running'} shown={shown} />

      {t.status === 'error' ? <div className="turn-err">{t.error}</div> : null}
      {t.status === 'running' ? <div className="turn-wait"><div className="skeleton" style={{ height: 22, width: '70%' }} /><div className="skeleton" style={{ height: 14, width: '92%' }} /><div className="skeleton" style={{ height: 14, width: '60%' }} /></div> : null}

      {a && r && revealed ? <div className="answer">
        <div className="a-head">
          <p className="a-headline">{a.headline}</p>
          <span className={`conf ${a.confidence}`} title={CONF_TEXT[a.confidence]}><i />{a.confidence} confidence</span>
        </div>
        {a.paragraphs.map((p, i) => <p key={i} className="a-p">{p}</p>)}

        <div className="blocks">{a.blocks.map((b, i) => <BlockView key={i} b={b} go={go} onCopy={onCopy} />)}</div>

        {a.followUps.length ? <div className="follow"><span className="u-k">Ask next</span>{a.followUps.map((f) => <button key={f.text} className="follow-q" style={{ ['--c' as string]: LENS_INFO[f.lens].color }} onClick={() => onAsk(f.text)}><Icon name={LENS_INFO[f.lens].icon} size={12} />{f.text}</button>)}</div> : null}

        <div className="reread"><span className="muted small">Not what you meant? Show me</span>{LENSES.filter((l) => l !== a.lens).map((l) => <button key={l} className="chip quiet" onClick={() => onAsk(t.q, l)}>{LENS_INFO[l].label}</button>)}</div>

        {a.sources.length ? <details className="sources"><summary>{a.sources.length} source{a.sources.length === 1 ? '' : 's'} behind this answer</summary>
          <div className="src-list">{a.sources.map((s) => <button key={s.label + s.path} className="src" onClick={() => go('repository', s.symbol ?? s.path)} title="Open in Repository"><b>{s.label}</b><code>{s.path}{s.line ? `:${s.line}` : ''}</code></button>)}</div>
        </details> : null}

        <footer className="a-actions">
          <Btn sm icon="copy" onClick={() => onCopy(a.markdown, 'Answer')}>Copy answer</Btn>
          {r.evidence.pack ? <>
            <Btn sm icon="send" onClick={() => onHandoff('claude', r.evidence.pack!.packId)} title="Open Claude Code with this question and its context pack">Hand to Claude Code</Btn>
            <Btn sm icon="send" onClick={() => onHandoff('copilot', r.evidence.pack!.packId)}>Hand to Copilot</Btn>
          </> : null}
          <span className="grow" />
          {detailed ? <Btn sm kind="ghost" icon="code" onClick={() => setBehind((v) => !v)}>{behind ? 'Hide' : 'Behind the scenes'}</Btn> : null}
        </footer>
        {behind && detailed ? <Behind r={r} /> : null}
      </div> : null}
    </article>
  );
}

const LensTag = ({ l }: { l: Lens }) => <span className="lens-tag" style={{ ['--c' as string]: LENS_INFO[l].color }}>{LENS_INFO[l].label}</span>;

function Pipeline({ plan, running, shown }: { plan?: PlanStep[]; running: boolean; shown: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const { detailed } = useDetailed();
  const total = plan?.reduce((a, s) => a + s.ms, 0) ?? 0;
  const step = (id: PlanStep['id']) => plan?.find((s) => s.id === id);
  const ids = plan ? STEPS.filter((id) => step(id)) : STEPS;
  const sel = open ? step(open as PlanStep['id']) : undefined;
  return (
    <div className="pipe">
      <div className="pipe-h"><span className="u-k">How RIAF answered</span>{plan && !running ? <span className="muted small">{plan.length} steps{detailed ? ` · ${total} ms` : ''}</span> : <span className="muted small">working…</span>}</div>
      <ol className="pipe-steps">
        {ids.map((id, i) => {
          const s = step(id);
          const state = running ? (i === shown ? 'active' : i < shown ? 'done' : '') : i < shown ? 'done' : '';
          return (
            <li key={id} className={`pstep ${state} ${open === id ? 'open' : ''}`} onClick={() => s && detailed && setOpen(open === id ? null : id)}>
              <span className="pdot"><Icon name={STEP_ICON[id]} size={13} /></span>
              <span className="pl"><b>{s?.label ?? STEP_LABEL[id]}</b>{s && state === 'done' ? <small>{s.detail}</small> : null}</span>
              {s && state === 'done' && detailed ? <span className="pms">{s.ms} ms</span> : null}
            </li>
          );
        })}
      </ol>
      {sel && detailed ? <div className="pipe-calls"><span className="muted small">Lookups run in this step:</span>{sel.calls.length ? sel.calls.map((c) => <code key={c}>{c}</code>) : <span className="muted small">none, computed locally</span>}</div> : null}
    </div>
  );
}

function Behind({ r }: { r: Result }) {
  const w = r.evidence.intent?.w ?? {};
  const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="behind">
      <div>
        <span className="u-k">Kind of answer (lens scores)</span>
        <div className="bh-lens">{[...LENSES].sort((a, b) => r.parsed.p[b] - r.parsed.p[a]).map((l) => <div key={l}><span>{LENS_INFO[l].label}</span><span className="bh-t"><span style={{ width: pct(r.parsed.p[l]), background: LENS_INFO[l].color }} /></span><b>{pct(r.parsed.p[l])}</b></div>)}</div>
        <span className="muted small">Entropy {r.parsed.H.toFixed(2)} → {r.parsed.reading} reading</span>
      </div>
      <div>
        <span className="u-k">Developer intent (the RIAF router)</span>
        <IntentBar w={w} />
        <span className="muted small">{top ? `${INTENT_LABEL[top[0]] ?? top[0]} ${pct(top[1])}` : ''} · {r.evidence.intent?.branch} branch · H {r.evidence.intent?.H.toFixed(2)}</span>
        {r.evidence.pack ? <><span className="u-k" style={{ marginTop: 12 }}>Context pack</span>
          <span className="small"><code>{r.evidence.pack.packId}</code> · {r.evidence.pack.items} items · {r.evidence.pack.tokensUsed.toLocaleString()} / {r.evidence.pack.budget.toLocaleString()} tokens · {r.evidence.pack.files.length} files</span></> : null}
      </div>
    </div>
  );
}

/* ───────── answer blocks ───────── */
function BlockView({ b, go, onCopy }: { b: Block; go: (p: string, a?: string) => void; onCopy: (s: string, what: string) => void }) {
  switch (b.kind) {
    case 'pieces': return (
      <section className="blk wide"><h4>{b.title}</h4>
        <div className="pieces">{b.items.map((p) => (
          <button key={p.symbol} className="piece" onClick={() => go('repository', p.symbol)} title="Open in Repository">
            <span className="piece-h"><b>{p.name}</b><span className="area-chip" style={{ ['--c' as string]: toneOf(p.area) }}>{p.area}</span></span>
            <span className="piece-w">{p.what}</span>
            <code>{p.where}</code>
          </button>))}</div>
      </section>);
    case 'areas': {
      const max = Math.max(1, ...b.items.map((i) => i.weight));
      return (
        <section className="blk wide"><h4>{b.title}</h4>
          <div className="areas">{b.items.map((a) => (
            <div key={a.id} className="area" style={{ ['--c' as string]: toneOf(a.name), flexGrow: 1 + (a.weight / max) * 2 }}>
              <div className="area-h"><b>{a.name}</b><span className="muted small">{a.weight} file{a.weight === 1 ? '' : 's'}</span></div>
              <ul>{a.files.slice(0, 4).map((f) => <li key={f.name}><code>{f.name}</code> {f.text.replace(/^Defines /, '')}</li>)}</ul>
            </div>))}</div>
        </section>);
    }
    case 'flow': return (
      <section className="blk wide"><h4>{b.title}</h4>
        <div className="flow">{b.steps.map((s, i) => <div key={s.symbol + i} className="flow-step"><button className={`flow-n ${i === b.steps.length - 1 ? 'focus' : ''}`} onClick={() => go('repository', s.symbol)}><b>{s.name}</b><span>{s.what}</span></button>{i < b.steps.length - 1 ? <span className="flow-link" aria-hidden="true" /> : null}</div>)}</div>
      </section>);
    case 'rings': return <section className="blk wide"><h4>{b.title}</h4><Rings b={b} go={go} /></section>;
    case 'risk': return <section className="blk"><h4>{b.title}</h4><RiskGauge b={b} /></section>;
    case 'timeline': return (
      <section className="blk wide"><h4>{b.title}</h4>
        {b.items.length ? <ol className="atl">{b.items.map((c) => (
          <li key={c.commit} className={c.flag ?? ''}><span className="atl-d">{c.date}</span><span className="atl-dot" /><div><span className="atl-type">{c.type}</span>{c.flag ? <span className={`atl-flag ${c.flag}`}>{c.flag === 'reverted' ? 'rolled back' : 'incident'}</span> : null}<p>{c.summary}</p><span className="muted small">{c.author} · {c.commit.slice(0, 8)}</span></div></li>))}</ol>
          : <p className="muted">No changes on record for this period.</p>}
        {b.decisions.map((d) => <div key={d.path} className="decision"><div><b>{d.title}</b> <span className="chip quiet">{d.status}</span><p className="muted small">{d.excerpt}</p></div></div>)}
      </section>);
    case 'people': return (
      <section className="blk"><h4>{b.title}</h4>
        <div className="people">{b.items.map((p, i) => (
          <div key={p.name} className={`person ${i === 0 ? 'lead-p' : ''}`}>
            <span className="avatar" style={{ background: toneOf(p.name) }}>{initials(p.name)}</span>
            <div className="person-b"><b>{p.name}</b><span className="muted small">{p.changes} change{p.changes === 1 ? '' : 's'} · {p.lines} lines · last {p.last}</span><span className="share"><span style={{ width: pct(p.share) }} /></span></div>
            <span className="num">{pct(p.share)}</span>
          </div>))}</div>
      </section>);
    case 'effort': return (
      <section className="blk wide effort"><h4>{b.title}</h4>
        <div className="effort-g">
          <div>
            <div className="sizes">{(['S', 'M', 'L', 'XL'] as const).map((s) => <span key={s} className={`size ${s === b.size ? 'on' : ''}`}>{s}</span>)}</div>
            <div className="drivers">{b.drivers.map((d) => <div key={d.label}><b className="num">{d.value}</b><span className="muted small">{d.label}</span></div>)}</div>
            <p className="muted small">A starting point for refinement, not an estimate. Confirm with the team.</p>
          </div>
          <div>
            <span className="u-k">Questions to settle first</span>
            <ul className="qs">{b.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            <Btn sm kind="primary" icon="copy" onClick={() => onCopy(b.brief, 'Ticket brief')}>Copy ticket brief</Btn>
          </div>
        </div>
        <details className="brief"><summary>Preview the ticket brief</summary><pre>{b.brief}</pre></details>
      </section>);
    case 'tests': {
      const share = b.total ? b.covered / b.total : 0;
      return (
        <section className="blk"><h4>{b.title}</h4>
          <div className="tests">
            <svg viewBox="0 0 80 80" width="88" height="88" role="img" aria-label={`${pct(share)} covered`}><circle cx="40" cy="40" r="32" className="donut-track" /><circle cx="40" cy="40" r="32" fill="none" stroke={share > 0.6 ? 'var(--moss)' : share > 0.3 ? 'var(--i-merge)' : 'var(--ember)'} strokeWidth="9" strokeDasharray={`${share * 201} 201`} transform="rotate(-90 40 40)" /><text x="40" y="45" textAnchor="middle" className="donut-v" style={{ fontSize: 15 }}>{b.items.length}</text></svg>
            <div><b>{b.items.length ? `${b.items.length} automated check${b.items.length === 1 ? '' : 's'}` : 'No automated checks'}</b>
              <ul>{b.items.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        </section>);
    }
  }
}

function Rings({ b, go }: { b: Extract<Block, { kind: 'rings' }>; go: (p: string, a?: string) => void }) {
  const W = 360, C = W / 2, R0 = 40, step = (C - R0 - 22) / Math.max(1, b.rings.length);
  const total = b.rings.reduce((a, r) => a + r.items.length, 0);
  const areas = Object.entries(b.byArea).sort((x, y) => y[1] - x[1]);
  return (
    <div className="rings">
      <svg viewBox={`-50 0 ${W + 100} ${W}`} width="100%" style={{ maxWidth: 480 }} role="img" aria-label={`${total} parts affected`}>
        {b.rings.map((r, ri) => <circle key={r.distance} cx={C} cy={C} r={R0 + step * (ri + 1)} className="ring" />)}
        {b.rings.map((r, ri) => {
          const rad = R0 + step * (ri + 1);
          const shown = r.items.slice(0, 10);
          return shown.map((it, i) => {
            const ang = -Math.PI / 2 + (2 * Math.PI * (i + ri * 0.5)) / shown.length;
            const x = C + rad * Math.cos(ang), y = C + rad * Math.sin(ang);
            return <g key={it.symbol} className="ring-n" onClick={() => go('repository', it.symbol)}>
              <line x1={C} y1={C} x2={x} y2={y} className="ring-l" />
              <circle cx={x} cy={y} r={7} style={{ fill: toneOf(it.area) }}><title>{`${it.name} · ${it.area}`}</title></circle>
              <text x={x} y={y + (y > C ? 19 : -12)} textAnchor="middle" className="ring-t">{it.name.length > 18 ? `${it.name.slice(0, 17)}…` : it.name}</text>
            </g>;
          });
        })}
        <circle cx={C} cy={C} r={R0} className="ring-c" />
        <text x={C} y={C + 4} textAnchor="middle" className="ring-ct">{b.center.length > 14 ? `${b.center.slice(0, 13)}…` : b.center}</text>
      </svg>
      <div className="ring-legend">
        <div><b className="num">{total}</b><span className="muted small"> parts affected</span></div>
        {areas.map(([a, n]) => <div key={a} className="rl"><i className="sw" style={{ background: toneOf(a) }} />{a}<span className="num">{n}</span></div>)}
        <div className="rl">automated checks<span className="num">{b.tests.length}</span></div>
      </div>
    </div>
  );
}

function RiskGauge({ b }: { b: Extract<Block, { kind: 'risk' }> }) {
  const ang = Math.PI * (1 - b.score);
  const x = 100 + 72 * Math.cos(ang), y = 100 - 72 * Math.sin(ang);
  const color = b.level === 'Low' ? 'var(--moss)' : b.level === 'Medium' ? 'var(--i-merge)' : 'var(--ember)';
  return (
    <div className="risk">
      <svg viewBox="0 0 200 116" width="210" role="img" aria-label={`Risk ${b.level}`}>
        <path d="M20 100 A80 80 0 0 1 73 25" className="arc low" /><path d="M77 23 A80 80 0 0 1 123 23" className="arc mid" /><path d="M127 25 A80 80 0 0 1 180 100" className="arc high" />
        <line x1="100" y1="100" x2={x} y2={y} className="needle" /><circle cx="100" cy="100" r="6" className="needle-c" />
      </svg>
      <div className="risk-l" style={{ color }}>{b.level}<span className="muted small"> {Math.round(b.score * 100)}/100</span></div>
      <div className="factors">{b.factors.map((f) => <div key={f.label}><span>{f.label}</span><span className="bh-t"><span style={{ width: pct(f.value), background: f.value > 0.6 ? 'var(--ember)' : f.value > 0.3 ? 'var(--i-merge)' : 'var(--moss)' }} /></span><span className="muted small">{f.note}</span></div>)}</div>
    </div>
  );
}

