import { useEffect, useMemo, useState } from 'react';
import { ask, save, saved, type Msg } from '../api.js';
import { Card, Chip, Count, Detail, fmtK, pct, Skeleton, Stat, useDetailed } from '../kit.js';
import { bench, BENCHMARKS, contextCost, DEFAULT_ASSUMPTIONS, MEASURED_REPLACED, project, reduction, type Assumptions, type Condition, type LiveSavings } from '../../src/savings.js';

const TONE: Record<Condition['id'], string> = { scripted: 'var(--slate)', claude: 'var(--i-review)', riaf: 'var(--teal)' };
const usd = (x: number) => (x >= 1000 ? `$${Math.round(x).toLocaleString()}` : x >= 10 ? `$${x.toFixed(0)}` : x >= 0.1 ? `$${x.toFixed(2)}` : `$${x.toFixed(4)}`);

/** Horizontal bars comparing one metric across conditions; `better` says which direction wins. */
function Compare({ title, rows, fmt, better, note }: { title: string; rows: { c: Condition; v: number }[]; fmt: (v: number) => string; better: 'lower' | 'higher'; note?: string }) {
  const max = Math.max(...rows.map((r) => r.v));
  const best = better === 'lower' ? Math.min(...rows.map((r) => r.v)) : max;
  return (
    <div className="cmp">
      <div className="cmp-h"><b>{title}</b>{note ? <span className="muted small">{note}</span> : null}</div>
      {rows.map(({ c, v }) => (
        <div key={c.id} className={`cmp-row ${v === best ? 'best' : ''}`}>
          <span className="cmp-l"><i className="sw" style={{ background: TONE[c.id] }} />{c.label}</span>
          <span className="cmp-t"><span style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: TONE[c.id] }} /></span>
          <span className="num">{fmt(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; hint?: string }) {
  return (
    <label className="slider">
      <span className="slider-h"><span>{label}</span><b className="num">{fmt(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint ? <span className="muted small">{hint}</span> : null}
    </label>
  );
}

export function Savings() {
  const { detailed } = useDetailed();
  const [liveData, setLive] = useState<LiveSavings | null>(null);
  const [a, setA] = useState<Assumptions>(() => ({ ...DEFAULT_ASSUMPTIONS, ...(saved<Partial<Assumptions>>('savings', {})) }));
  useEffect(() => {
    const load = () => void ask({ type: 'load', page: 'savings' }).then((r: Msg) => setLive(r['live']));
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, []);
  const set = (k: keyof Assumptions) => (v: number) => setA((p) => { const n = { ...p, [k]: v }; save('savings', n); return n; });
  const p = useMemo(() => project(a), [a]);
  const scripted = bench('scripted'), claude = bench('claude'), riaf = bench('riaf');
  const ctxSaved = reduction(scripted.tokens, riaf.tokens);
  const callsSaved = reduction(scripted.toolCalls, riaf.toolCalls);
  const perTask = reduction(p.baselineUsd, p.riafUsd);

  return (
    <div className="stack-lg">
      <div className="page-h"><div>
        <h1>Savings</h1>
        <p className="lead">What RIAF saves compared with other ways of giving an AI assistant the code it needs. The top part is <b>measured</b> on 30 test tasks. The calculator below is an <b>estimate</b> you can adjust to your team.</p>
      </div></div>

      <section className="save-hero">
        <div className="save-big">
          <span className="eyebrow">Measured · 30 tasks</span>
          <div className="save-num"><Count to={Math.round(ctxSaved * 100)} />%</div>
          <div className="muted">less text sent to the AI than searching and reading files, while finding more of the right files ({pct(riaf.recall)} vs {pct(scripted.recall)})</div>
        </div>
        <div className="save-side">
          <Stat v={`${pct(callsSaved)}`} l={`fewer steps for the AI (${scripted.toolCalls.toFixed(1)} → ${riaf.toolCalls})`} accent="var(--teal)" />
          <Stat v={`+${Math.round((riaf.recall - scripted.recall) * 100)} pts`}  l="more of the right files found" accent="var(--moss)" />
          <Stat v={usd(claude.usdPerTask ?? 0)} l="cost per task with Claude Code alone (measured)" accent="var(--i-review)" />
        </div>
      </section>

      <Card title="Side by side" sub={detailed ? `Same 30 tasks. Claude Code alone spends ${fmtK(claude.tokens)} session tokens per task; context tokens compare only the explorer and the pack.` : 'The same 30 test tasks, done three ways.'}>
        <div className="cmp-grid">
          <Compare title="Steps the AI takes per task" rows={BENCHMARKS.map((c) => ({ c, v: c.toolCalls }))} fmt={(v) => v.toFixed(1)} better="lower" />
          <Compare title="Right files found" rows={BENCHMARKS.map((c) => ({ c, v: c.recall }))} fmt={pct} better="higher" />
          <Compare title={detailed ? 'Context tokens per task' : 'Text sent to the AI (tokens)'} rows={[scripted, riaf].map((c) => ({ c, v: c.tokens }))} fmt={fmtK} better="lower" />
        </div>
        <div className="cmp-foot muted small">{BENCHMARKS.map((c) => <span key={c.id}><b style={{ color: TONE[c.id] }}>{c.label}</b>: {c.what}.{detailed ? <> <code>{c.source}</code></> : null}</span>)}</div>
      </Card>

      <div className="grid2">
        <Card title="Estimate: Claude Code with RIAF" sub={detailed ? <>Not yet measured. Each agent turn replays the session, so tokens scale with turns; the pack replaces a share of the exploration calls. The benchmark replaced {pct(MEASURED_REPLACED)} of a scripted explorer's calls; the default assumes {pct(DEFAULT_ASSUMPTIONS.replaced)}.</> : <>Not measured yet. Set the numbers to match your team. In tests RIAF saved up to {pct(MEASURED_REPLACED)} of the AI's search steps; the default assumes {pct(DEFAULT_ASSUMPTIONS.replaced)}.</>}>
          <div className="sliders">
            <Slider label="Search steps RIAF saves the AI" value={a.replaced} min={0} max={0.95} step={0.05} onChange={set('replaced')} fmt={pct} hint={`best measured: ${pct(MEASURED_REPLACED)}`} />
            <Slider label="Developers" value={a.developers} min={1} max={500} step={1} onChange={set('developers')} fmt={String} />
            <Slider label="Agent tasks per developer per day" value={a.tasksPerDay} min={1} max={40} step={1} onChange={set('tasksPerDay')} fmt={String} />
            <Slider label="Working days per month" value={a.workdays} min={1} max={23} step={1} onChange={set('workdays')} fmt={String} />
          </div>
        </Card>
        <Card title="Estimated monthly AI cost" sub={`${p.tasksPerMonth.toLocaleString()} AI tasks a month at the measured ${usd(p.baselineUsd)} per task.`}>
          <div className="proj">
            <div className="proj-row"><span>Claude Code alone</span><span className="proj-t"><span style={{ width: '100%', background: TONE.claude }} /></span><b className="num">{usd(p.monthlyBaselineUsd)}</b></div>
            <div className="proj-row"><span>With RIAF</span><span className="proj-t"><span style={{ width: pct(p.monthlyBaselineUsd ? p.monthlyRiafUsd / p.monthlyBaselineUsd : 0), background: TONE.riaf }} /></span><b className="num">{usd(p.monthlyRiafUsd)}</b></div>
          </div>
          <div className="proj-out">
            <div><span className="eyebrow">Estimated saving</span><div className="save-num sm">{usd(p.monthlySavedUsd)}<span className="muted small"> / month</span></div></div>
            <div className="proj-facts">
              <Chip dot="var(--teal)">{pct(perTask)} per task</Chip>
              <Chip>{p.baselineCalls.toFixed(1)} → {p.riafCalls.toFixed(1)} AI steps</Chip>
              <Detail><Chip>{fmtK(p.baselineTokens)} → {fmtK(p.riafTokens)} tokens</Chip><Chip>{fmtK(p.monthlySavedTokens)} tokens / month</Chip></Detail>
            </div>
          </div>
          <p className="muted small">This is an estimate. A measured test run of Claude Code with RIAF would replace it; that run has not been done yet.</p>
        </Card>
      </div>

      <div className={detailed ? 'grid2' : ''}>
         <Detail><Card title="What the context itself costs" sub="Input price of one task's context, scripted explorer vs pack, per million-token list price.">
          <table className="ptable">
            <thead><tr><th>Model</th><th className="num">Explorer</th><th className="num">Pack</th><th className="num">Saved / 1k tasks</th></tr></thead>
            <tbody>{contextCost(scripted.tokens).map((e, i) => {
              const r = contextCost(riaf.tokens)[i]!;
              return <tr key={e.model}><td>{e.model}</td><td className="num">{usd(e.usd)}</td><td className="num">{usd(r.usd)}</td><td className="num ok">{usd((e.usd - r.usd) * 1000)}</td></tr>;
            })}</tbody>
          </table>
        </Card></Detail>
        <Card title="In this repository" sub="Live counts from your own use. Only the last number is an estimate.">
          {liveData ? <div className="stats2">
            <Stat v={<Count to={liveData.packs} />} l="tasks prepared" accent="var(--teal)" />
            <Stat v={<Count to={liveData.served} />} l={`of ${fmtK(liveData.governed)} AI searches answered instantly by RIAF`} accent="var(--i-refactor)" />
            <Stat v={<Count to={liveData.blocked} />} l="times an AI going in circles was stopped" accent="var(--ember)" />
            <Stat v={<>≈<Count to={liveData.callsAvoidedEst} /></>} l="AI search steps saved (estimate)" accent="var(--moss)" />
          </div> : <Skeleton h={140} />}
        </Card>
      </div>
    </div>
  );
}
