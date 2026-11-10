import { useEffect, useMemo, useRef, useState } from 'react';
import { ask, onPush, repoName } from '../api.js';
import { Card, Empty, Skeleton, useToast } from '../kit.js';
import { buildWorkflow, PHASES, toolName, type Phase, type Turn } from '../../src/workflow.js';

/**
 * Claude Code in this repository, as it happens: each session's workflow (turns, stages, files,
 * commands, failures) and the raw activity stream. Read from Claude Code's own session log.
 */

interface LiveEvent { id: string; session: string; at: string; kind: 'prompt' | 'text' | 'tool' | 'result'; text: string; tool?: string; error?: boolean; ref?: string; sidechain?: boolean }
interface LiveSession { id: string; title: string; updatedAt: string; active: boolean; events: number }

const KEEP = 4000;
/** A session title without RIAF's prompt marker, and whether it ran a RIAF prompt. */
const plainTitle = (t: string) => t.replace(/^\[RIAF pr_\w+\]\s*/, '').replace(/ — RIAF compiled.*$/, '');
const fromRiaf = (t: string) => /^\[RIAF pr_\w+\]/.test(t);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};
const dur = (ms: number) => (ms < 1000 ? '<1s' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`);
const PHASE_LABEL = Object.fromEntries(PHASES.map((p) => [p.id, p.label])) as Record<Phase, string>;
const merge = (cur: LiveEvent[], more: LiveEvent[]) => {
  const seen = new Set(cur.map((e) => e.id));
  const next = [...cur, ...more.filter((e) => !seen.has(e.id))];
  return next.length > KEEP ? next.slice(-KEEP) : next;
};

export function Live() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [dir, setDir] = useState({ dir: '', found: false });
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [tab, setTab] = useState<'workflow' | 'activity'>('workflow');
  const pickRef = useRef<string | null>(null);
  pickRef.current = pick;

  const refresh = () => void ask({ type: 'live' }).then((r) => {
    setDir({ dir: r['dir'], found: r['found'] });
    const list = r['sessions'] as LiveSession[];
    setSessions(list);
    setPick((p) => p ?? (list.find((s) => s.active) ?? list[0])?.id ?? null);
    setLoaded(true);
  }).catch((e: Error) => toast(e.message, 'err'));

  useEffect(() => {
    refresh();
    const off = onPush('live', (m) => {
      const fresh = m['events'] as LiveEvent[];
      const mine = fresh.filter((e) => e.session === pickRef.current);
      if (mine.length) setEvents((cur) => merge(cur, mine));
      setSessions((cur) => {
        const ids = new Set(fresh.map((e) => e.session));
        if ([...ids].some((id) => !cur.some((s) => s.id === id))) refresh();
        return cur.map((s) => (ids.has(s.id) ? { ...s, active: true, updatedAt: new Date().toISOString(), events: s.events + fresh.filter((e) => e.session === s.id).length } : s));
      });
    });
    const t = setInterval(refresh, 15000);
    return () => { off(); clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!pick) return;
    setEvents([]);
    void ask({ type: 'liveSession', session: pick }).then((r) => setEvents((cur) => merge(r['events'] as LiveEvent[], cur))).catch((e: Error) => toast(e.message, 'err'));
  }, [pick]);

  const flow = useMemo(() => buildWorkflow(events), [events]);
  const session = sessions.find((s) => s.id === pick);

  if (!loaded) return <div className="stack-lg"><Skeleton h={90} /><Skeleton h={320} /></div>;
  return (
    <div className="stack-lg">
      <div className="page-h"><div>
        <h1>Claude Code</h1>
        <p className="lead">The work Claude Code does in <b>{repoName}</b>, live: every prompt, the stages it moves through, the files it reads and changes, and every command with its outcome. Read from Claude Code’s own session log on this machine.</p>
      </div></div>

      {!dir.found || !sessions.length ? (
        <Card>
          <Empty title="No Claude Code sessions in this repository yet">
            Start Claude Code in <code>{repoName}</code> (run <code>claude</code> in a terminal, or use <b>Prepare a task</b> and hand the task to Claude Code). Its work appears here within a second.
            {dir.dir ? <div className="muted small" style={{ marginTop: 8 }}>Watching <code>{dir.dir}</code></div> : null}
          </Empty>
        </Card>
      ) : (
        <div className="livegrid">
          <Card title="Sessions" sub={`${sessions.filter((s) => s.active).length} running · ${sessions.length} total`} className="live-sessions">
            <div className="live-slist">
              {sessions.map((s) => (
                <button key={s.id} className={pick === s.id ? 'on' : ''} onClick={() => setPick(s.id)} title={s.id}>
                  <span className={`live-state ${s.active ? 'on' : ''}`} />
                  <span><b>{fromRiaf(s.title) ? <i className="riaf-b">RIAF prompt</i> : null}{plainTitle(s.title)}</b><small className="muted">{s.active ? 'Running' : ago(s.updatedAt)} · {s.events} events</small></span>
                </button>
              ))}
            </div>
          </Card>

          <div className="stack">
            <section className="card wf-head">
              <div className="wf-title">
                <div>
                  <span className="eyebrow">Session {pick?.slice(0, 8)}</span>
                  <h2>{session ? plainTitle(session.title) : 'Session'}</h2>
                </div>
                <span className={`status ${session?.active ? 'run' : 'idle'}`}>{session?.active ? 'Running' : 'Idle'}</span>
              </div>
              <div className="kpis">
                <Kpi v={flow.totals.turns} l="Turns" />
                <Kpi v={flow.totals.steps} l="Tool calls" />
                <Kpi v={flow.totals.filesRead} l="Files read" />
                <Kpi v={flow.totals.filesChanged} l="Files changed" />
                <Kpi v={flow.totals.commands} l="Commands" />
                <Kpi v={flow.totals.failed} l="Failures" warn={flow.totals.failed > 0} />
                <Kpi v={dur(flow.totals.durationMs)} l="Active time" />
              </div>
              <Lifecycle phases={flow.phases} />
              <div className="tabs-u" role="tablist">
                <button role="tab" aria-selected={tab === 'workflow'} className={tab === 'workflow' ? 'on' : ''} onClick={() => setTab('workflow')}>Workflow</button>
                <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity stream</button>
              </div>
            </section>

            {tab === 'workflow'
              ? (flow.turns.length ? [...flow.turns].reverse().map((t, i) => <TurnCard key={t.id} t={t} n={flow.turns.length - i} defaultOpen={i === 0} />) : <Card><Empty title="Waiting for the first prompt" /></Card>)
              : <Activity events={events} />}
          </div>
        </div>
      )}
    </div>
  );
}

const Kpi = ({ v, l, warn }: { v: number | string; l: string; warn?: boolean }) => (
  <div className={`kpi ${warn ? 'warn' : ''}`}><b>{typeof v === 'number' ? v.toLocaleString() : v}</b><span>{l}</span></div>
);

/** Where the session's effort went, phase by phase, in workflow order. */
function Lifecycle({ phases }: { phases: Record<Phase, number> }) {
  const total = Object.values(phases).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="lifecycle">
      <div className="lc-bar">{PHASES.map((p) => phases[p.id] ? <i key={p.id} className={`ph-${p.id}`} style={{ flexGrow: phases[p.id] }} title={`${p.label}: ${phases[p.id]}`} /> : null)}</div>
      <ol className="lc-steps">
        <li className="lc-io"><b>Prompt</b></li>
        {PHASES.map((p) => (
          <li key={p.id} className={phases[p.id] ? '' : 'none'} title={p.detail}>
            <span className={`sw ph-${p.id}`} /><b>{p.label}</b><span className="muted">{phases[p.id]} · {Math.round((phases[p.id] / total) * 100)}%</span>
          </li>
        ))}
        <li className="lc-io"><b>Response</b></li>
      </ol>
    </div>
  );
}

function TurnCard({ t, n, defaultOpen }: { t: Turn; n: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const state = t.open ? 'In progress' : t.failed ? `Completed · ${t.failed} failed step${t.failed > 1 ? 's' : ''}` : 'Completed';
  return (
    <section className={`card turn-c ${t.open ? 'is-open' : ''}`}>
      <button className="turn-h" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="turn-n">Turn {n}</span>
        <span className="turn-p">{t.prompt}</span>
        <span className="turn-m">
          <span className={`status ${t.open ? 'run' : t.failed ? 'warn' : 'ok'}`}>{state}</span>
          <span className="muted">{time(t.startedAt)} · {dur(t.durationMs)} · {t.steps} calls</span>
        </span>
      </button>

      <div className="stageflow">
        <span className="sf-node io">Prompt</span>
        {t.stages.map((s, i) => (
          <span key={i} className="sf-seg">
            <span className="sf-link" />
            <span className={`sf-node ph-${s.phase} ${s.failed ? 'bad' : ''}`} title={s.steps.map((x) => `${x.tool} ${x.target}`).join('\n')}>
              {PHASE_LABEL[s.phase]}<em>{s.steps.length}</em>{s.failed ? <small>{s.failed} failed</small> : null}
            </span>
          </span>
        ))}
        <span className="sf-seg"><span className="sf-link" /><span className={`sf-node io ${t.open ? 'pending' : ''}`}>{t.open ? 'Working' : 'Response'}</span></span>
      </div>

      {open ? (
        <div className="turn-body">
          <div className="turn-cols">
            <div>
              <div className="mini-h">Files changed ({t.filesChanged.length})</div>
              {t.filesChanged.length ? <ul className="flist">{t.filesChanged.map((f) => <li key={f}><code>{f}</code></li>)}</ul> : <p className="muted small">None</p>}
              <div className="mini-h">Files read ({t.filesRead.length})</div>
              {t.filesRead.length ? <ul className="flist">{t.filesRead.slice(0, 12).map((f) => <li key={f}><code>{f}</code></li>)}{t.filesRead.length > 12 ? <li className="muted">and {t.filesRead.length - 12} more</li> : null}</ul> : <p className="muted small">None</p>}
            </div>
            <div>
              <div className="mini-h">Commands ({t.commands.length})</div>
              {t.commands.length ? <ul className="clist">{t.commands.slice(-15).map((c, i) => <li key={i} title={c.text}><span className={`st st-${c.status}`}>{c.status === 'ok' ? 'OK' : c.status === 'failed' ? 'FAIL' : 'RUN'}</span><span className="ph-tag">{PHASE_LABEL[c.phase]}</span><code>{c.text}</code></li>)}{t.commands.length > 15 ? <li className="muted small">Latest 15 of {t.commands.length}; all are in the steps table below.</li> : null}</ul> : <p className="muted small">None</p>}
            </div>
          </div>

          <div className="mini-h">Steps</div>
          <table className="steps">
            <thead><tr><th>Time</th><th>Stage</th><th>Tool</th><th>Target</th><th>Outcome</th></tr></thead>
            <tbody>
              {t.stages.flatMap((s) => s.steps).map((x) => (
                <tr key={x.id} className={x.status === 'failed' ? 'bad' : ''}>
                  <td className="mono muted">{time(x.at)}</td>
                  <td><span className={`ph-tag ph-${x.phase}`}>{PHASE_LABEL[x.phase]}</span></td>
                  <td className="mono">{x.tool}{x.sidechain ? <small className="muted"> · sub-agent</small> : null}</td>
                  <td className="mono tgt" title={x.target}>{x.target}</td>
                  <td title={x.result}><span className={`st st-${x.status}`}>{x.status === 'ok' ? 'OK' : x.status === 'failed' ? 'Failed' : 'Running'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          {t.response ? <><div className="mini-h">Claude’s response</div><div className="response">{t.response}</div></> : null}
        </div>
      ) : null}
    </section>
  );
}

function Activity({ events }: { events: LiveEvent[] }) {
  const [follow, setFollow] = useState(true);
  const [results, setResults] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const shown = events.filter((e) => results || e.kind !== 'result').slice(-800);
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: 'end' }); }, [shown.length, follow]);
  return (
    <Card title="Activity stream" sub="Every event in order, newest at the bottom." actions={<>
      <button className={`toggle ${results ? 'on' : ''}`} onClick={() => setResults((v) => !v)}>Tool output</button>
      <button className={`toggle ${follow ? 'on' : ''}`} onClick={() => setFollow((v) => !v)}>Follow</button>
    </>}>
      <div className="live-feed" onWheel={(e) => { if (e.deltaY < 0 && follow) setFollow(false); }}>
        {shown.length ? shown.map((e) => <Row key={e.id} e={e} />) : <Empty title="No events yet" />}
        <div ref={end} />
      </div>
    </Card>
  );
}

function Row({ e }: { e: LiveEvent }) {
  const [open, setOpen] = useState(false);
  const long = e.text.length > 220 || e.text.includes('\n');
  const label = e.kind === 'prompt' ? 'Prompt' : e.kind === 'text' ? 'Claude' : e.kind === 'tool' ? toolName(e.tool) : e.error ? 'Error' : 'Output';
  return (
    <div className={`lrow k-${e.kind} ${e.error ? 'err' : ''} ${e.sidechain ? 'side' : ''}`}>
      <span className="lrow-t mono">{time(e.at)}</span>
      <span className="lrow-k">{label}</span>
      <div className={`lrow-x ${e.kind === 'tool' || e.kind === 'result' ? 'mono' : ''} ${long && !open ? 'clamp' : ''}`} onClick={() => long && setOpen((v) => !v)}>{e.text || <span className="muted">(empty)</span>}</div>
    </div>
  );
}
