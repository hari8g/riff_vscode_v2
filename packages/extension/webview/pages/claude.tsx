import { useEffect, useRef, useState } from 'react';
import { ask, onPush, save, saved } from '../api.js';
import { Btn, Card, copy, Empty, fmtK, Icon, Skeleton, useToast } from '../kit.js';
import { Live } from './live.js';
import { CopyPair } from './prompt.js';

/**
 * Claude Code: every prompt RIAF compiled, keyed to the Claude Code session that ran it, with what
 * Claude Code did for it (its reply, the code it wrote, the commands it ran), and the live console.
 */

type Status = 'compiled' | 'exported' | 'running' | 'done' | 'failed';
interface Run {
  promptId: string; packId: string; task: string; host: string; tokens: number; createdAt: string; source: 'console' | 'hook';
  sessionId?: string; exportedAt?: string; status: Status; session?: { id: string; title: string; active: boolean; updatedAt: string };
}
interface Edit { path: string; before?: string; after: string }
interface Result {
  run: Run; prompt: string; response?: string; command: string; message: string;
  activity: { id: string; at: string; kind: 'prompt' | 'text' | 'tool' | 'result'; text: string; tool?: string; error?: boolean }[];
  files: { path: string; edits: Edit[] }[]; commands: { text: string; status: string }[];
  turns: { id: string; prompt: string; stages: { phase: string; steps: unknown[]; failed: number }[]; steps: number; failed: number; response?: string; open: boolean }[];
  totals: { steps: number; failed: number; filesChanged: number; durationMs: number };
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  compiled: { label: 'Compiled', cls: 'st-compiled' }, exported: { label: 'Sent', cls: 'st-sent' }, running: { label: 'Running', cls: 'st-running' },
  done: { label: 'Done', cls: 'st-done' }, failed: { label: 'Needs a look', cls: 'st-failed' },
};
const ago = (iso?: string) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};
/** Light rendering of Claude Code's markdown reply: paragraphs, **bold** and `code`. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/\n+/).map((para, i) => (
    <p key={i}>{para.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, k) => part.startsWith('**') && part.endsWith('**') ? <b key={k}>{part.slice(2, -2)}</b> : part.startsWith('`') && part.endsWith('`') ? <code key={k}>{part.slice(1, -1)}</code> : part)}</p>
  ))}</>;
}
const sessionName = (t: string) => t.replace(/^\[RIAF pr_\w+\]\s*/, '').replace(/ — RIAF compiled.*$/, '');
const dur = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

export function ClaudePage({ focus }: { focus?: string }) {
  const [tab, setTab] = useState<'runs' | 'live'>(() => saved('claude.tab', 'runs'));
  useEffect(() => save('claude.tab', tab), [tab]);
  useEffect(() => { if (focus) setTab('runs'); }, [focus]);
  return (
    <div className="stack-lg">
      <div className="page-h">
        <div><h1>Claude Code</h1><p className="lead">Each prompt you compile, and what Claude Code did with it: its reply, the code it wrote and the commands it ran. The live console follows every session in this repository.</p></div>
        <nav className="tabs pill" aria-label="Claude Code views">
          <button className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}><Icon name="prompt" size={14} />Runs</button>
          <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}><Icon name="live" size={14} />Live console</button>
        </nav>
      </div>
      {tab === 'runs' ? <Runs {...(focus ? { focus } : {})} onLive={() => setTab('live')} /> : <div className="embed"><Live /></div>}
    </div>
  );
}

function Runs({ focus, onLive }: { focus?: string; onLive: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [pick, setPick] = useState<string | null>(focus ?? saved('claude.pick', null));
  const load = () => void ask({ type: 'runs' }).then((r) => {
    const list = r['runs'] as Run[];
    setRuns(list);
    setPick((p) => (p && list.some((x) => x.promptId === p) ? p : list[0]?.promptId ?? null));
  });
  useEffect(() => {
    load();
    const off = onPush('live', () => load());
    const t = setInterval(load, 5000);
    return () => { off(); clearInterval(t); };
  }, []);
  useEffect(() => { if (focus) setPick(focus); }, [focus]);
  useEffect(() => { if (pick) save('claude.pick', pick); }, [pick]);
  if (!runs) return <Skeleton h={320} />;
  if (!runs.length) return (
    <Card><Empty icon="prompt" title="No prompts yet">Compile a task on the <b>Prompt</b> page and export it. Prompts that the Claude Code hook injects show up here too.</Empty></Card>
  );
  return (
    <div className="runs">
      <aside className="runlist" aria-label="Prompts">
        {runs.map((r) => (
          <button key={r.promptId} className={`runitem ${pick === r.promptId ? 'on' : ''}`} onClick={() => setPick(r.promptId)}>
            <span className={`stp ${STATUS[r.status].cls}`}>{r.status === 'running' ? <i className="pulse-dot" /> : null}{STATUS[r.status].label}</span>
            <b>{r.task}</b>
            <span className="muted small">{ago(r.createdAt)} · {r.source === 'hook' ? 'typed in Claude Code' : 'from the console'}</span>
          </button>
        ))}
      </aside>
      {pick ? <RunView key={pick} promptId={pick} onLive={onLive} /> : null}
    </div>
  );
}

function RunView({ promptId, onLive }: { promptId: string; onLive: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<Result | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const status = useRef<Status | null>(null);
  const load = () => void ask({ type: 'run', promptId }).then((x) => { setR(x as unknown as Result); status.current = (x as unknown as Result).run.status; }).catch((e: Error) => toast(e.message, 'err'));
  useEffect(() => {
    load();
    const off = onPush('live', () => { if (status.current !== 'done') load(); });
    const t = setInterval(() => { if (status.current === 'running' || status.current === 'exported') load(); }, 3000);
    return () => { off(); clearInterval(t); };
  }, [promptId]);
  if (!r) return <Skeleton h={320} />;
  const run = r.run;
  const linked = !!run.session;
  const exportIt = async () => {
    const x = await ask({ type: 'exportPrompt', promptId });
    if (x['launched']) toast(`Claude Code is starting in ${String(x['how'] ?? 'a terminal')}`);
    else toast(`${x['reason'] ? String(x['reason']) : 'Could not open a terminal'}: copy the shell command below`, 'err');
    load();
  };
  return (
    <section className="runview rise">
      <header className="run-h">
        <div>
          <span className={`stp ${STATUS[run.status].cls}`}>{run.status === 'running' ? <i className="pulse-dot" /> : null}{STATUS[run.status].label}</span>
          <h2>{run.task}</h2>
          <span className="muted small">Prompt <code>{run.promptId}</code> · {fmtK(run.tokens)} tokens · compiled {ago(run.createdAt)}{run.session ? <> · Claude Code session <span title={run.session.id}>“{sessionName(run.session.title).slice(0, 48)}{sessionName(run.session.title).length > 48 ? '…' : ''}”</span></> : null}</span>
        </div>
        <div className="row">
          {!linked ? <Btn kind="primary" sm icon="send" onClick={() => void exportIt()}>Export to Claude Code</Btn> : null}
          <Btn sm kind="ghost" icon="prompt" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? 'Hide prompt' : 'Show prompt'}</Btn>
        </div>
      </header>
      {showPrompt ? <pre className="prompt-pre short">{r.prompt}</pre> : null}

      {!linked ? (
        <div className="waiting">
          <Icon name="live" size={20} />
          <div>
            <b>{run.status === 'exported' ? 'Waiting for Claude Code to start' : 'Not sent to Claude Code yet'}</b>
            <p className="muted small">When a Claude Code session in this repository starts with this prompt, it is linked here automatically. <b>Export to Claude Code</b> opens one for you; to start it yourself, paste this into a <b>shell</b>, or paste the prompt into a Claude Code session that is already open:</p>
            <pre className="cmd">{r.command}</pre>
            <div className="row"><CopyPair command={r.command} message={r.message} /></div>
          </div>
        </div>
      ) : (
        <>
          <div className="run-kpis">
            <div><b>{r.totals.filesChanged}</b><span>files changed</span></div>
            <div><b>{r.commands.length}</b><span>commands</span></div>
            <div><b>{r.totals.steps}</b><span>steps</span></div>
            <div className={r.totals.failed ? 'bad' : ''}><b>{r.totals.failed}</b><span>failed steps</span></div>
            <div><b>{r.totals.durationMs ? dur(r.totals.durationMs) : '–'}</b><span>time</span></div>
          </div>

          <Console lines={r.activity} running={run.status === 'running'} />

          <div className="reply">
            <div className="mini-h">Claude Code's reply</div>
            {r.response ? <Rich text={r.response} /> : <p className="muted">{run.status === 'running' ? 'Working… the reply appears when it finishes.' : 'No reply recorded.'}</p>}
          </div>

          <div>
            <div className="mini-h">Code it wrote</div>
            {r.files.length ? r.files.map((f) => <FileDiff key={f.path} f={f} />) : <p className="muted small">{run.status === 'running' ? 'No edits yet.' : 'No files were changed for this prompt.'}</p>}
          </div>

          {r.commands.length ? (
            <div>
              <div className="mini-h">Commands it ran</div>
              <ul className="cmds">{r.commands.slice(-12).map((c, i) => <li key={i}><span className={`cst ${c.status}`}>{c.status === 'ok' ? 'OK' : c.status === 'failed' ? 'FAIL' : 'RUN'}</span><code>{c.text}</code></li>)}</ul>
            </div>
          ) : null}
          <button className="linkbtn" onClick={onLive}>Open the full session in the live console →</button>
        </>
      )}
    </section>
  );
}

/** Claude Code's activity for the prompt, as a terminal: prompts, its messages, tool calls and their results. */
function Console({ lines, running }: { lines: Result['activity']; running: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length, follow]);
  if (!lines.length) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="term">
      <div className="term-h"><span className="dots"><i /><i /><i /></span><b>Claude Code</b>{running ? <span className="term-live"><i className="pulse-dot" />working</span> : <span className="muted small">finished</span>}
        <label className="term-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />follow</label></div>
      <div className="term-b" ref={box}>
        {lines.map((l) => (
          <div key={l.id} className={`tm tm-${l.kind} ${l.error ? 'err' : ''}`}>
            <span className="tm-t">{time(l.at)}</span>
            {l.kind === 'prompt' ? <span><b className="tm-p">❯</b> {l.text.replace(/^\[RIAF pr_\w+\]\s*/, '').replace(/ — RIAF compiled.*$/, '')}</span>
              : l.kind === 'tool' ? <span><b>{(l.tool ?? 'tool').replace(/^mcp__[^_]+__/, '')}</b> {l.text}</span>
              : l.kind === 'result' ? <span className="tm-r">{l.error ? '✗ ' : '⎿ '}{l.text.split('\n')[0]}</span>
              : <span className="tm-m">● {l.text}</span>}
          </div>
        ))}
        {running ? <div className="tm tm-cursor"><span className="tm-t" /><span className="cursor">▍</span></div> : null}
      </div>
    </div>
  );
}

function FileDiff({ f }: { f: { path: string; edits: Edit[] } }) {
  const [open, setOpen] = useState(true);
  const added = f.edits.reduce((a, e) => a + e.after.split('\n').length, 0);
  const removed = f.edits.reduce((a, e) => a + (e.before ? e.before.split('\n').length : 0), 0);
  return (
    <div className="filediff">
      <button className="fd-h" onClick={() => setOpen((v) => !v)}>
        <Icon name="file" size={14} /><b>{f.path}</b>
        <span className="fd-n"><i className="add">+{added}</i>{removed ? <i className="del">−{removed}</i> : <i className="new">new</i>}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open ? f.edits.map((e, k) => (
        <pre key={k} className="diff">
          {e.before ? e.before.split('\n').map((l, i) => <span key={`b${i}`} className="dl del">- {l}{'\n'}</span>) : null}
          {e.after.split('\n').map((l, i) => <span key={`a${i}`} className="dl add">+ {l}{'\n'}</span>)}
        </pre>
      )) : null}
    </div>
  );
}
