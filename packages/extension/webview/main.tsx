import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/** The RIAF console: Overview, Repository, Policies, Sessions, Adapters. Data comes from the extension host. */

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();
let nextId = 1;
const pending = new Map<number, (v: Msg) => void>();
type Msg = { id?: number; type: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
window.addEventListener('message', (e: MessageEvent<Msg>) => {
  const r = e.data.id !== undefined ? pending.get(e.data.id) : undefined;
  if (r && e.data.id !== undefined) {
    pending.delete(e.data.id);
    r(e.data);
  }
});
function ask(req: Record<string, unknown>): Promise<Msg> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    vscode.postMessage({ ...req, id });
  });
}

const PAGES = ['overview', 'repository', 'policies', 'sessions', 'adapters'] as const;
type Page = (typeof PAGES)[number];

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((100 * value) / total) : 0;
  return <div className="bar"><span className="bar-label">{label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span><span className="bar-value">{value}</span></div>;
}

function Overview({ d }: { d: Msg }) {
  const s = d['status'];
  const t = d['telemetry'];
  const branches = Object.entries(t.branches as Record<string, number>);
  const total = branches.reduce((a, [, n]) => a + n, 0);
  return <>
    <section className="cards">
      <div className="card"><b>{s.blobs}</b><span>files</span></div>
      <div className="card"><b>{s.symbols}</b><span>symbols</span></div>
      <div className="card"><b>{s.edges}</b><span>edges</span></div>
      <div className="card"><b>{t.packs}</b><span>packs</span></div>
      <div className="card"><b>{t.skills}</b><span>skills</span></div>
    </section>
    <h3>Index stages</h3>
    <table><thead><tr><th>stage</th><th>pending</th><th>done</th><th>last run</th></tr></thead><tbody>
      {s.stages.map((x: Msg) => <tr key={x['stage']}><td>{x['stage']}</td><td>{x['pending']}</td><td>{x['done']}</td><td>{x['lastMs'] !== undefined ? `${Math.round(x['lastMs'])} ms` : '–'}{x['lastError'] ? ` ⚠ ${x['lastError']}` : ''}</td></tr>)}
    </tbody></table>
    <h3>Branch distribution</h3>
    {branches.length ? branches.map(([b, n]) => <Bar key={b} label={b} value={n} total={total} />) : <p className="muted">No routes yet.</p>}
  </>;
}

function Tree({ n }: { n: Msg }) {
  return <li><code>{n['id'] || '/'}</code> <span className="muted">{n['summary']}</span>{n['children'].length > 0 && <ul>{n['children'].map((c: Msg) => <Tree key={c['id']} n={c} />)}</ul>}</li>;
}

function Policies({ d }: { d: Msg }) {
  const [policies, setPolicies] = useState<string>(d['policies']);
  const [governance, setGovernance] = useState<string>(d['governance']);
  const [diag, setDiag] = useState<Msg[] | undefined>();
  const [saved, setSaved] = useState(false);
  const check = async () => setDiag((await ask({ type: 'validatePolicies', policies, governance }))['diagnostics']);
  const save = async () => {
    const r = await ask({ type: 'savePolicies', policies, governance });
    if (r.type === 'saved') { setSaved(true); setDiag([]); } else setDiag(r['diagnostics']);
  };
  return <>
    <p className="muted">Version {d['version']}. Policies are data: changes apply to the next route without a release.</p>
    <div className="editors"><label>policies.yaml<textarea value={policies} onChange={(e) => { setPolicies(e.target.value); setSaved(false); }} /></label>
      <label>governance.yaml<textarea value={governance} onChange={(e) => { setGovernance(e.target.value); setSaved(false); }} /></label></div>
    <button onClick={() => void check()}>Validate</button> <button onClick={() => void save()}>Save</button> {saved && <span className="ok">saved</span>}
    {diag && (diag.length ? <ul className="diag">{diag.map((x, i) => <li key={i}>{x['file']}:{x['path']} — {x['message']}</li>)}</ul> : <p className="ok">Valid.</p>)}
  </>;
}

function Sessions({ d }: { d: Msg }) {
  const t = d['telemetry'];
  const decisions = Object.entries(t.toolCalls.byDecision as Record<string, number>);
  return <>
    <section className="cards"><div className="card"><b>{t.sessions}</b><span>sessions</span></div><div className="card"><b>{t.toolCalls.total}</b><span>tool calls</span></div><div className="card"><b>{t.skills}</b><span>skills</span></div></section>
    <h3>Tool-call decisions</h3>
    {decisions.length ? decisions.map(([k, n]) => <Bar key={k} label={k} value={n} total={t.toolCalls.total} />) : <p className="muted">No governed sessions yet.</p>}
    <h3>Pack utilisation by rule</h3>
    <table><thead><tr><th>rule</th><th>intent</th><th>read / delivered</th></tr></thead><tbody>
      {t.utilisation.map((u: Msg) => <tr key={`${u['rule']}:${u['intent']}`}><td>{u['rule']}</td><td>{u['intent']}</td><td>{u['read']} / {u['delivered']}</td></tr>)}
    </tbody></table>
    <h3>Intent priors</h3>
    {Object.entries(t.priors as Record<string, number>).map(([k, v]) => <Bar key={k} label={k} value={Math.round(v * 100)} total={100} />)}
  </>;
}

function App() {
  const [page, setPage] = useState<Page>('overview');
  const [data, setData] = useState<Msg | undefined>();
  useEffect(() => {
    setData(undefined);
    void ask({ type: 'load', page }).then(setData);
  }, [page]);
  return <main>
    <nav>{PAGES.map((p) => <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>{p[0]!.toUpperCase() + p.slice(1)}</button>)}</nav>
    {!data ? <p className="muted">Loading…</p> : data.type === 'error' ? <p className="error">{data['message']}</p>
      : page === 'overview' ? <Overview d={data} />
      : page === 'repository' ? <><h3>Structure</h3><ul className="tree"><Tree n={data['tree']} /></ul><h3>Run-book</h3><pre>{data['runbook']}</pre></>
      : page === 'policies' ? <Policies d={data} />
      : page === 'sessions' ? <Sessions d={data} />
      : <><h3>Daemon</h3><pre>{JSON.stringify(data['daemon'], null, 2)}</pre><h3>Model adapters (riaf.models)</h3><pre>{JSON.stringify(data['models'], null, 2) || '{}'}</pre></>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
