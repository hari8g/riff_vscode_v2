import { useEffect, useMemo, useRef, useState } from 'react';
import { ask, save, saved, type Pack, type PackItem, type Policy } from '../api.js';
import { BRANCH_TEXT, Btn, Card, Chip, Code, copy, Empty, EntropyGauge, fmtK, Icon, INTENT_LABEL, INTENTS, IntentBar, IntentRows, intentVar, pct, shortPath, symKind, symName, symPath, useToast } from '../kit.js';

const EXAMPLES = [
  'Fix the off-by-one in Gantry.lane: the last lane of every gantry fails',
  'Add a GET /disputes/next endpoint that returns the oldest open dispute',
  'Rename Ledger.post to Ledger.record everywhere',
  'How does a gantry camera reading end up as a charge in the ledger?',
  'Fix the null check in TollSession.close() and then add a config flag so ops can disable it',
];
const TIERS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Orientation', cls: 't1' }, 2: { label: 'Code', cls: 't2' }, 3: { label: 'History & conventions', cls: 't3' }, 4: { label: 'Run-book', cls: 't4' },
};
const KIND_ICON: Record<string, string> = { body: 'code', signature: 'code', test: 'check', summary: 'overview', commit: 'commit', convention: 'rule', skill: 'sparkle', runbook: 'rule', co_change: 'graph', diff: 'code' };
const RENDERS = ['claude', 'copilot', 'fragment', 'json'] as const;

const where = (i: PackItem) => i.source.path ? `${i.source.path}${i.source.range ? `:${i.source.range.startLine}-${i.source.range.endLine}` : ''}` : i.source.commit ? `commit ${i.source.commit.slice(0, 10)}` : (i.source.virtual ?? '');

export function Studio({ go }: { go: (page: string, arg?: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState<string>(() => saved('studio.text', ''));
  const [budget, setBudget] = useState<number>(() => saved('studio.budget', 16000));
  const [route, setRoute] = useState<Policy | null>(null);
  const [routing, setRouting] = useState(false);
  const [pack, setPack] = useState<Pack | null>(() => saved('studio.pack', null));
  const [busy, setBusy] = useState(false);
  const [hl, setHl] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'items' | (typeof RENDERS)[number]>('items');
  const [rendered, setRendered] = useState<Record<string, string>>({});
  const [ph, setPh] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => save('studio.text', text), [text]);
  useEffect(() => save('studio.budget', budget), [budget]);
  useEffect(() => save('studio.pack', pack), [pack]);
  useEffect(() => {
    const t = setInterval(() => setPh((p) => (p + 1) % EXAMPLES.length), 3800);
    return () => clearInterval(t);
  }, []);
  // live routing while typing
  useEffect(() => {
    if (text.trim().split(/\s+/).length < 3) {
      setRoute(null);
      return;
    }
    setRouting(true);
    const t = setTimeout(() => void ask({ type: 'route', text }).then((r) => setRoute(r['policy'] as Policy)).catch(() => undefined).finally(() => setRouting(false)), 320);
    return () => clearTimeout(t);
  }, [text]);

  const compile = async () => {
    if (!text.trim()) return ta.current?.focus();
    setBusy(true);
    try {
      const r = await ask({ type: 'compile', text, budget });
      const p = r['pack'] as Pack;
      setPack(p);
      setRendered({ claude: r['rendered'] as string });
      setView('items');
      setOpen(null);
      toast(`Compiled ${p.items.length} items · ${fmtK(p.tokensUsed)} tokens`);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!pack || view === 'items' || rendered[view]) return;
    void ask({ type: 'render', packId: pack.packId, target: view }).then((r) => setRendered((m) => ({ ...m, [view]: r['text'] as string })));
  }, [view, pack]);

  const tiers = useMemo(() => {
    const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const i of pack?.items ?? []) out[i.tier] = (out[i.tier] ?? 0) + i.tokens;
    return out;
  }, [pack]);
  const byStage = useMemo(() => {
    const m = new Map<string, PackItem[]>();
    for (const i of pack?.items ?? []) {
      const k = i.tier === 2 ? `Code · stage ${i.stage + 1}` : TIERS[i.tier]!.label;
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [pack]);

  const handoff = async (to: 'copilot' | 'claude') => {
    if (!pack) return;
    try {
      await ask({ type: 'handoff', to, text, packId: pack.packId });
      toast(to === 'copilot' ? 'Opened Copilot agent mode with the pack' : 'Started Claude Code with the pack');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-h">
        <div><h1>Studio</h1><p className="lead">Describe the task. RIAF reads it as a <em>distribution</em> of intents, grounds it in your code, and compiles the smallest context a model can act on.</p></div>
      </div>

      <section className={`taskline ${busy ? 'busy' : ''}`}>
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[ph]} rows={2} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void compile(); } }} />
        <div className="taskline-bar">
          <label className="budget"><span>Budget</span><input type="range" min={2000} max={32000} step={1000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /><b>{fmtK(budget)}</b></label>
          <span className="grow" />
          {routing && <span className="muted small pulse">reading…</span>}
          <Btn kind="primary" icon="bolt" onClick={() => void compile()} disabled={busy}>{busy ? 'Compiling…' : 'Compile pack'}</Btn>
          <kbd className="hint-kbd">⌘↵</kbd>
        </div>
        {!text && <div className="examples">{EXAMPLES.slice(0, 4).map((x) => <Chip key={x} onClick={() => setText(x)}>{x.length > 58 ? `${x.slice(0, 56)}…` : x}</Chip>)}</div>}
      </section>

      {route && <RouteView route={route} go={go} />}

      {pack ? (
        <Card className="rise" title={<span className="row">Context pack <Chip mono>{pack.packId}</Chip></span>}
          sub={`${pack.items.length} items · ${fmtK(pack.tokensUsed)} of ${fmtK(pack.budget)} tokens · ${pack.policyVersion}`}
          actions={<>
            <Btn kind="soft" sm icon="send" onClick={() => void handoff('copilot')}>Copilot agent</Btn>
            <Btn kind="soft" sm icon="send" onClick={() => void handoff('claude')}>Claude Code</Btn>
            <Btn kind="ghost" sm icon="copy" onClick={() => void copy(rendered['claude'] ?? '').then(() => toast('Copied the Claude render'))}>Copy</Btn>
          </>}>
          <div className="meter fill" onMouseLeave={() => setHl(null)}>
            {pack.items.map((i) => (
              <span key={i.id} className={`seg ${TIERS[i.tier]!.cls} ${hl === i.id ? 'hl' : ''}`} style={{ flexGrow: i.tokens }} title={`${where(i)} · ${i.tokens} tokens`}
                onMouseEnter={() => setHl(i.id)} onClick={() => { setOpen(i.id); setView('items'); document.getElementById(`it-${i.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }} />
            ))}
          </div>
          <div className="budgetrail" title="The budget is a ceiling, not a target: compilation stops once the pack is sufficient">
            <span className="budgetrail-t"><span style={{ width: `${Math.max(1.5, (100 * pack.tokensUsed) / pack.budget)}%` }} /></span>
            <span className="small muted">{fmtK(pack.tokensUsed)} of {fmtK(pack.budget)} budget · stopped at sufficiency, {pct(1 - pack.tokensUsed / pack.budget)} left unused</span>
          </div>
          <div className="legend">
            {Object.entries(TIERS).map(([t, v]) => tiers[Number(t)] ? <span key={t}><i className={`sw ${v.cls}`} />{v.label} <b>{fmtK(tiers[Number(t)]!)}</b></span> : null)}
          </div>

          <nav className="tabs">
            <button className={view === 'items' ? 'on' : ''} onClick={() => setView('items')}>Items</button>
            {RENDERS.map((r) => <button key={r} className={view === r ? 'on' : ''} onClick={() => setView(r)}>{r === 'claude' ? 'Claude' : r === 'copilot' ? 'Copilot' : r === 'fragment' ? 'Any model' : 'JSON'}</button>)}
          </nav>

          {view === 'items' ? (
            <div className="stack">
              {byStage.map(([group, items]) => (
                <div key={group}>
                  <div className="group-h">{group}</div>
                  <div className="items">
                    {items.map((i) => (
                      <div key={i.id} id={`it-${i.id}`} className={`item ${hl === i.id ? 'hl' : ''} ${open === i.id ? 'open' : ''}`} onMouseEnter={() => setHl(i.id)}>
                        <button className="item-row" onClick={() => setOpen(open === i.id ? null : i.id)}>
                          <span className={`item-ic ${TIERS[i.tier]!.cls}`}><Icon name={KIND_ICON[i.kind] ?? 'code'} size={14} /></span>
                          <span className="item-main"><span className="item-path">{where(i)}</span><span className="item-why"><i className="chip-dot" style={{ background: intentVar(i.why.intent) }} />{i.why.rule.replace(/_/g, ' ')} · {i.kind}</span></span>
                          <span className="score" title={`score ${i.why.score}`}><span style={{ width: `${Math.min(1, i.why.score) * 100}%` }} /></span>
                          <span className="item-tok">{fmtK(i.tokens)}</span>
                          <Icon name="chevron" size={14} />
                        </button>
                        {open === i.id && <div className="item-body"><Code text={i.content} start={i.source.range?.startLine ?? 1} /></div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {pack.openLookups.length > 0 && (
                <div>
                  <div className="group-h">Suggested next lookups</div>
                  <div className="lookups">{pack.openLookups.map((l, k) => <div key={k} className="lookup"><Chip mono tone="ember">{l.tool}</Chip><span className="mono small">{JSON.stringify(l.args)}</span><span className="muted small">{l.reason}</span></div>)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="render">
              <div className="row end"><Btn kind="ghost" sm icon="copy" onClick={() => void copy(rendered[view] ?? '').then(() => toast('Copied'))}>Copy</Btn></div>
              {rendered[view] === undefined ? <p className="muted pulse">Rendering…</p> : <pre className="render-pre">{rendered[view]}</pre>}
            </div>
          )}
        </Card>
      ) : !route && (
        <Empty icon="studio" title="Nothing compiled yet">Type a task above. The reading updates as you type; <kbd>⌘↵</kbd> compiles the pack.</Empty>
      )}
    </div>
  );
}

function RouteView({ route, go }: { route: Policy; go: (page: string, arg?: string) => void }) {
  const top = INTENTS.map((i) => [i, route.w[i] ?? 0] as const).sort((a, b) => b[1] - a[1])[0]!;
  const unitOf = new Map(route.units.map((u) => [u.id, u]));
  return (
    <section className="route rise">
      <div className="route-gauge">
        <EntropyGauge H={route.H} />
        <div className={`branch b-${route.branch}`}>{route.branch}</div>
      </div>
      <div className="route-main">
        <div className="route-title"><span className="big" style={{ color: intentVar(top[0]) }}>{INTENT_LABEL[top[0]]}</span><span className="muted">{pct(top[1])} · {BRANCH_TEXT[route.branch]}</span></div>
        <IntentBar w={route.w} height={10} />
        <IntentRows w={route.w} />
        {route.question && <div className="ask"><Icon name="alert" size={15} /><span>{route.question.question}</span></div>}
      </div>
      <div className="route-side">
        <div className="mini-h">Task units</div>
        <div className="stages">
          {route.stages.map((st, s) => (
            <div key={s} className="stage">
              <span className="stage-n">{s + 1}</span>
              <div className="stage-units">{st.map((id) => {
                const u = unitOf.get(id)!;
                const t = INTENTS.map((i) => [i, u.w[i] ?? 0] as const).sort((a, b) => b[1] - a[1])[0]![0];
                return <div key={id} className="unit"><i className="chip-dot" style={{ background: intentVar(t) }} /><span>{u.text}</span></div>;
              })}</div>
            </div>
          ))}
        </div>
        <div className="mini-h">Grounded in</div>
        <div className="row wrap">
          {route.anchors.slice(0, 8).map((a) => <Chip key={a} mono onClick={() => go('repository', a)} title={a}><Icon name={symKind(a) === 'file' ? 'file' : 'target'} size={12} />{symKind(a) === 'file' ? shortPath(symPath(a)) : symName(a)}</Chip>)}
          {route.units.flatMap((u) => u.ungrounded).slice(0, 4).map((u) => <Chip key={u} tone="ember" mono title="not in the index — new code, or a different name">{u}?</Chip>)}
          {!route.anchors.length && <span className="muted small">nothing named; the pack will search</span>}
        </div>
        <div className="mini-h">Policy</div>
        <div className="row wrap">{route.primitives.map((p) => <Chip key={p.intent} dot={intentVar(p.intent)}>{INTENT_LABEL[p.intent]} {pct(p.weight)}</Chip>)}{route.expansion.slice(0, 5).map((r) => <Chip key={r.rule} tone="quiet">{r.rule.replace(/_/g, ' ')}{r.hops && r.hops > 1 ? ` ×${r.hops}` : ''}</Chip>)}</div>
      </div>
    </section>
  );
}
