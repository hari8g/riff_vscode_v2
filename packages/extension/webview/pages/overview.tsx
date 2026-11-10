import { useEffect, useState } from 'react';
import { ask, brand, repoName, save, type Msg } from '../api.js';
import { Btn, fmtK, Icon, INTENT_LABEL, intentVar, pct } from '../kit.js';
import { bench, reduction } from '../../src/savings.js';

/** Home: one place to start a task, the four steps from code to change, and the latest runs. */

interface Run { promptId: string; task: string; createdAt: string; status: 'compiled' | 'exported' | 'running' | 'done' | 'failed' }
const STATUS: Record<Run['status'], string> = { compiled: 'Compiled', exported: 'Sent', running: 'Running', done: 'Done', failed: 'Needs a look' };
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

export function Overview({ go }: { go: (page: string, arg?: string) => void }) {
  const [d, setD] = useState<Msg | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [text, setText] = useState('');
  const [ideas, setIdeas] = useState<{ text: string; intent: string; why: string }[]>([]);
  useEffect(() => void ask({ type: 'suggestTasks' }).then((r) => setIdeas((r['tasks'] as typeof ideas).slice(0, 4))).catch(() => undefined), []);
  useEffect(() => {
    const load = () => {
      void ask({ type: 'load', page: 'overview' }).then(setD).catch(() => undefined);
      void ask({ type: 'runs' }).then((r) => setRuns(r['runs'] as Run[])).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  const start = (task = text) => {
    if (!task.trim()) return;
    save('prompt.text', task.trim());
    save('prompt.auto', true);
    go('prompt');
  };
  const s = d?.['status'];
  const t = d?.['telemetry'];
  const pending = s ? (s.stages as { pending: number }[]).reduce((a, x) => a + x.pending, 0) : 0;
  const done = runs.filter((r) => r.status === 'done').length;
  const running = runs.filter((r) => r.status === 'running').length;
  const saving = reduction(bench('scripted').tokens, bench('riaf').tokens);
  const steps = [
    { page: 'repository', icon: 'repository', title: 'Read the repository', value: s ? `${fmtK(s.blobs)} files` : '…', sub: s ? `${fmtK(s.symbols)} parts indexed` : 'indexing' },
    { page: 'prompt', icon: 'prompt', title: 'Compile a prompt', value: `${runs.length}`, sub: runs.length === 1 ? 'prompt compiled' : 'prompts compiled' },
    { page: 'claude', icon: 'live', title: 'Run in Claude Code', value: running ? `${running} running` : `${done}`, sub: running ? `${done} done` : 'runs done' },
    { page: 'savings', icon: 'savings', title: 'Measure the savings', value: `−${pct(saving)}`, sub: 'context per task' },
  ];
  return (
    <div className="home">
      <section className="home-hero">
        {brand.mark ? <img className="hero-mark" src={brand.mark} alt="" /> : null}
        <span className="eyebrow">Repository</span>
        <h1>{repoName}</h1>
        <p className="home-status"><i className={pending ? 'busy' : 'ok'} />{!s ? 'Starting RIAF…' : pending ? `Reading the latest changes · ${pending} files left` : 'Up to date with the code'}</p>
        <div className="home-ask">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What should Claude Code do?"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(); } }} />
          <Btn kind="primary" icon="bolt" onClick={() => start()} disabled={!text.trim()}>Compile</Btn>
        </div>
        {ideas.length ? (
          <div className="ideas-row" aria-label="Suggested tasks">
            <span className="muted small">Try one:</span>
            {ideas.map((i) => (
              <button key={i.text} className="idea-chip" style={{ ['--c' as string]: intentVar(i.intent) }} onClick={() => start(i.text)} data-tip={`${INTENT_LABEL[i.intent] ?? i.intent} · ${i.why}`}>
                <i />{i.text.replace(/`/g, '').slice(0, 64)}{i.text.length > 64 ? '…' : ''}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <ol className="flow4">
        {steps.map((x, i) => (
          <li key={x.page}>
            <button onClick={() => go(x.page)}>
              <span className="f4-i"><Icon name={x.icon} size={18} /></span>
              <span className="f4-n">{i + 1}</span>
              <b>{x.title}</b>
              <span className="f4-v">{x.value}</span>
              <span className="muted small">{x.sub}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="home-recent">
        <div className="hr-h"><b>Recent runs</b>{runs.length ? <button className="linkbtn" onClick={() => go('claude')}>All runs →</button> : null}</div>
        {runs.length ? runs.slice(0, 4).map((r) => (
          <button key={r.promptId} className="hr-row" onClick={() => go('claude', r.promptId)}>
            <span className={`stp st-${r.status === 'exported' ? 'sent' : r.status}`}>{r.status === 'running' ? <i className="pulse-dot" /> : null}{STATUS[r.status]}</span>
            <span className="hr-t">{r.task}</span>
            <span className="muted small">{ago(r.createdAt)}</span>
          </button>
        )) : <p className="muted small">Nothing yet. Describe a task above to compile your first prompt.</p>}
      </section>

      {t ? <p className="home-foot muted small">{fmtK(t.toolCalls.total)} AI steps checked · {fmtK(t.packs)} context packs · runs locally, nothing leaves this machine</p> : null}
    </div>
  );
}
