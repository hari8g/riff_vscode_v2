import { useEffect, useState } from 'react';
import { ask, repoName, type Msg } from '../api.js';
import { Btn, Card, Chip, Count, Detail, Donut, Empty, fmtK, Icon, Skeleton, Stat, useDetailed, useToast } from '../kit.js';

const STAGES = ['scan', 'parse', 'graph', 'history', 'summaries', 'lsp'];
const STAGE_TEXT: Record<string, string> = { scan: 'reads the files', parse: 'finds names in the code', graph: 'links what uses what', history: 'reads the change history', summaries: 'writes short summaries', lsp: 'asks the language tools' };
const BRANCH_TEXT: Record<string, string> = { single: 'clear', blended: 'two things at once', probe: 'needed a closer look', clarify: 'needed a question back', generic: 'too vague' };
const BRANCH_COLORS: Record<string, string> = { single: 'var(--teal)', blended: 'var(--i-refactor)', probe: 'var(--i-review)', clarify: 'var(--ember)', generic: 'var(--slate)' };

export function Overview({ go }: { go: (page: string, arg?: string) => void }) {
  const toast = useToast();
  const { detailed } = useDetailed();
  const [d, setD] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => void ask({ type: 'load', page: 'overview' }).then(setD).catch((e: Error) => toast(e.message, 'err'));
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="stack-lg"><Skeleton h={180} /><Skeleton h={220} /></div>;
  const s = d['status'];
  const t = d['telemetry'];
  const stages = (s.stages as Msg[]).filter((x) => STAGES.includes(x['stage']));
  const branches = Object.entries(t.branches as Record<string, number>);
  const routes = branches.reduce((a, [, n]) => a + n, 0);
  const pending = stages.reduce((a, x) => a + (x['pending'] as number), 0);
  const reindex = async () => {
    setBusy(true);
    try {
      const r = await ask({ type: 'reindex' });
      toast(detailed ? `Re-indexed in ${Math.round(r['run']?.ms ?? 0)} ms` : 'Up to date with the latest code');
      load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-lg">
      <section className="hero">
        <div className="hero-l">
          <span className="eyebrow">Repository</span>
          <h1 className="hero-t">{repoName}</h1>
          <div className="row wrap">
            <Chip tone={pending ? 'ember' : 'moss'} dot={pending ? 'var(--ember)' : 'var(--moss)'}>{pending ? `Updating, ${pending} files left` : 'Up to date'}</Chip>
            <Detail>{s.head && <Chip mono>{String(s.head).slice(0, 10)}</Chip>}<Chip>schema {s.schemaVersion}</Chip></Detail>
          </div>
          <div className="stats4">
            <Stat v={<Count to={s.blobs} />} l="files" />
            <Stat v={<Count to={s.symbols} />} l={detailed ? 'symbols' : 'parts of the code'} />
            {detailed ? <Stat v={<Count to={s.edges} />} l="graph edges" /> : <Stat v={<Count to={t.toolCalls.total} />} l="AI steps checked" />}
            <Stat v={<Count to={t.packs} />} l={detailed ? 'packs compiled' : 'tasks prepared'} />
          </div>
        </div>
        <div className="hero-r">
          <Btn kind="primary" onClick={() => go('studio')}>Prepare a task</Btn>
          <Btn kind="soft" onClick={() => go('live')}>Claude Code live</Btn>
          <Btn kind="soft" icon="refresh" onClick={() => void reindex()} disabled={busy}>{busy ? 'Updating…' : detailed ? 'Re-index' : 'Refresh'}</Btn>
        </div>
      </section>


      <Detail>
      <Card title="How RIAF keeps up with the code" sub="Each step only redoes what changed since its last run.">
        <div className="pipeline">
          {stages.map((x, i) => (
            <div key={x['stage']} className={`pnode ${x['pending'] ? 'busy' : ''} ${x['lastError'] ? 'err' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="pnode-h"><span className="pnode-n">{i + 1}</span><b>{x['stage']}</b></div>
              <div className="pnode-s">{STAGE_TEXT[x['stage']] ?? ''}</div>
              <div className="pnode-v"><b>{fmtK(x['done'])}</b><span>done</span></div>
              <div className="pnode-f">{x['pending'] ? <span className="ember">{x['pending']} pending</span> : x['lastMs'] !== undefined ? `${Math.round(x['lastMs'])} ms last run` : 'idle'}</div>
              {i < stages.length - 1 && <span className="pflow" aria-hidden="true"><i /></span>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid2">
        <Card title="How requests were read" sub="Whether each request was clear, mixed two things, or needed a question back.">
          {routes ? (
            <div className="donut-wrap">
              <Donut parts={branches.map(([b, n]) => ({ label: b, value: n, color: BRANCH_COLORS[b] ?? 'var(--slate)' }))} label={<Count to={routes} />} sub="requests" />
              <div className="legend col">{branches.sort((a, b) => b[1] - a[1]).map(([b, n]) => <span key={b}><i className="sw" style={{ background: BRANCH_COLORS[b] }} />{BRANCH_TEXT[b] ?? b}<b>{n}</b></span>)}</div>
            </div>
          ) : <Empty icon="studio" title="No requests yet">Prepare a task to see how RIAF reads requests.</Empty>}
        </Card>
        <Card title="Learning from use" sub="Each AI session teaches RIAF which context was useful.">
          <div className="stats3">
            <Stat v={<Count to={t.sessions} />} l="AI sessions" />
            <Stat v={<Count to={t.toolCalls.total} />} l="AI steps checked" />
            <Stat v={<Count to={t.skills} />} l="habits learned" accent="var(--moss)" />
          </div>
          <div className="row" style={{ marginTop: 14 }}><Btn kind="ghost" sm icon="governance" onClick={() => go('governance')}>Open AI activity</Btn></div>
        </Card>
      </div>
      </Detail>
    </div>
  );
}
