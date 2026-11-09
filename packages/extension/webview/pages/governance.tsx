import { useEffect, useState } from 'react';
import { ask, type Msg } from '../api.js';
import { Card, Count, Empty, fmtK, INTENT_LABEL, intentVar, pct, Radar, Skeleton, Stat } from '../kit.js';

const DECISIONS: { key: string; label: string; color: string; text: string }[] = [
  { key: 'allow', label: 'Allowed', color: 'var(--line-2)', text: 'ran normally' },
  { key: 'serve:index', label: 'Served from index', color: 'var(--teal)', text: 'grep/glob answered without a process' },
  { key: 'serve:cache', label: 'Served from cache', color: 'var(--i-refactor)', text: 'repeat read of an unchanged file' },
  { key: 'reflect', label: 'Reflect', color: 'var(--i-merge)', text: 'soft limit: checkpoint' },
  { key: 'block', label: 'Blocked', color: 'var(--ember)', text: 'loop or hard limit' },
];

export function Governance() {
  const [t, setT] = useState<Msg | null>(null);
  useEffect(() => {
    const load = () => void ask({ type: 'load', page: 'sessions' }).then((r) => setT(r['telemetry']));
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, []);
  if (!t) return <div className="stack-lg"><Skeleton h={160} /><Skeleton h={260} /></div>;
  const by = t.toolCalls.byDecision as Record<string, number>;
  const total = t.toolCalls.total as number;
  const served = (by['serve:index'] ?? 0) + (by['serve:cache'] ?? 0);
  const util = (t.utilisation as Msg[]).filter((u) => u['delivered'] > 0);
  return (
    <div className="stack-lg">
      <div className="page-h"><div><h1>Governance</h1><p className="lead">Every tool call in a governed Claude Code session passes the governor first. It applies the phase budgets, the loop guard and the repeat-read cache, and answers search from the index. What worked becomes priors and skills.</p></div></div>
      <section className="stats4 cardish">
        <Stat v={<Count to={t.sessions} />} l="sessions" />
        <Stat v={<Count to={total} />} l="tool calls governed" />
        <Stat v={total ? pct(served / total) : '–'} l="answered without running the tool" accent="var(--teal)" />
        <Stat v={<Count to={t.skills} />} l="skills learned" accent="var(--moss)" />
      </section>
      <Card title="Tool-call decisions" sub="What the PreToolUse hook decided for each call.">
        {total ? <>
          <div className="stackbar">{DECISIONS.map((d) => by[d.key] ? <i key={d.key} style={{ flexGrow: by[d.key], background: d.color }} title={`${d.label}: ${by[d.key]}`} /> : null)}</div>
          <div className="declist">{DECISIONS.map((d) => <div key={d.key}><i className="sw" style={{ background: d.color }} /><b>{d.label}</b><span className="muted small">{d.text}</span><span className="num">{fmtK(by[d.key] ?? 0)}</span></div>)}</div>
        </> : <Empty icon="governance" title="No governed sessions yet">Run <code>riaf init --host claude</code> and start Claude Code in the repository; the hooks report here.</Empty>}
      </Card>
      <div className="grid2">
        <Card title="Intent priors" sub="How often each reading wins in this repository, fed back into the router (blended half-and-half with uniform).">
          {Object.keys(t.priors).length ? <div className="center"><Radar values={t.priors as Record<string, number>} /></div> : <Empty title="No priors yet">They appear after the first session ends.</Empty>}
        </Card>
        <Card title="Pack utilisation by rule" sub="Share of delivered items the agent actually read or edited: the evidence for tuning policies.">
          {util.length ? <div className="util">{util.slice(0, 12).map((u) => (
            <div key={`${u['rule']}:${u['intent']}`} className="urow">
              <span className="urow-l"><i className="chip-dot" style={{ background: intentVar(u['intent']) }} />{String(u['rule']).replace(/_/g, ' ')}<span className="muted small"> {INTENT_LABEL[u['intent']] ?? u['intent']}</span></span>
              <span className="urow-t"><span style={{ width: pct(u['read'] / u['delivered']) }} /></span>
              <span className="num">{u['read']}/{u['delivered']}</span>
            </div>
          ))}</div> : <Empty title="No utilisation yet">Utilisation is measured when a session that received a pack ends.</Empty>}
        </Card>
      </div>
    </div>
  );
}
