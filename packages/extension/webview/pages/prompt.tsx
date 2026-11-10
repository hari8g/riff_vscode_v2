import { useEffect, useMemo, useRef, useState } from 'react';
import { ask, save, saved, type Msg } from '../api.js';
import { Btn, Card, Chip, copy, Detail, Empty, fmtK, Icon, INTENT_LABEL, intentVar, pct, Skeleton, useDetailed, useToast } from '../kit.js';
import { humanize } from '../../src/ask.js';

/**
 * Prompt: describe a task, watch RIAF compile it (read the task → gather the context → build the
 * prompt), then export it to Claude Code. The run that follows is keyed to the prompt and shown on
 * the Claude Code page.
 */

type Host = 'claude' | 'copilot' | 'generic';
interface Section { id: string; title: string; tokens: number; cacheable: boolean }
interface TokenPlan {
  model: string; contextWindow: number; usable: number; reasoning: number; output: number; packBudget: number; packUsed: number;
  frame: number; prompt: number; cacheable: number; headroom: number; summarizeAt: number; planGate: boolean;
  intentMix: { intent: string; weight: number; pack: number; output: number; planGate: boolean }[];
}
interface Prompt { promptId: string; host: Host; text: string; stableHash: string; sections: Section[]; plan: TokenPlan }
interface PackItem { id: string; tier: number; kind: string; source: { path?: string; virtual?: string; commit?: string }; why: { rule: string }; tokens: number; content: string }
interface Compiled { prompt: Prompt; pack: { packId: string; items: PackItem[]; tokensUsed: number; budget: number }; route?: { w: Record<string, number>; branch: string; H: number } }
interface IntentTokens { pack: number; output: number; plan_gate: boolean }
interface Settings {
  version: 1; model: { name: string; context_window: number; use_ratio: number }; reasoning: number;
  sections: { protocol: number; plan: number; notes: number }; intents: Record<string, IntentTokens>;
  plan_gate_min_weight: number; cache: { stable_prefix: boolean; ttl: '5m' | '1h' }; summarize_at: number;
}

/** What each kind of prompt means: what RIAF gathers and what Claude Code is told to do. */
const KINDS: { id: string; label: string; icon: string; gathers: string; does: string }[] = [
  { id: 'bugfix', label: 'Bug fix', icon: 'alert', gathers: 'the failing code, its callers and callees, the test that exercises it, and the commits that last touched it', does: 'reproduce the bug with a test, make the smallest fix, and rerun the tests' },
  { id: 'feature', label: 'New feature', icon: 'sparkle', gathers: 'the closest existing feature to copy from, the extension points and their tests', does: 'show its plan first, follow the existing pattern, and add tests for the new behaviour' },
  { id: 'refactor', label: 'Refactor', icon: 'refresh', gathers: 'every reference to what changes, the class hierarchy and indirect callers', does: 'show its plan first, change in small steps, and keep behaviour identical' },
  { id: 'review', label: 'Code review', icon: 'check', gathers: 'the changed code, its invariants, past incidents and files that usually change with it', does: 'report findings with file and line, without editing' },
  { id: 'merge', label: 'Merge', icon: 'commit', gathers: 'both branches\' changes, files that usually change together, and the tests over them', does: 'resolve keeping both intents, then run the tests' },
  { id: 'onboarding', label: 'Explain', icon: 'overview', gathers: 'summaries of the areas involved, the repository map and recorded decisions', does: 'explain with file references, without editing' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
interface Reading { w: Record<string, number>; H: number; branch: string; question: { question: string } | null; units: { id: string; text: string }[]; anchors: string[] }

const HOSTS: { id: Host; label: string }[] = [{ id: 'claude', label: 'Claude Code' }, { id: 'copilot', label: 'Copilot' }, { id: 'generic', label: 'Any model' }];
const SECTION_PLAIN: Record<string, string> = {
  protocol: 'How to work here', repository: 'Team rules', reply: 'Reply format', task: 'The task',
  plan: 'Plan', budget: 'Token budget', notes: 'What to watch', context: 'Code and history', finish: 'Checklist',
};
const GROUP: Record<number, string> = { 1: 'Overview of the product', 2: 'Code to look at', 3: 'Past changes and team rules', 4: 'How to build and test' };
const PART = [
  { key: 'cache', label: 'Cached instructions', color: 'var(--i-review)' },
  { key: 'frame', label: 'Task instructions', color: 'var(--i-refactor)' },
  { key: 'context', label: 'Code and history', color: 'var(--teal)' },
  { key: 'output', label: 'Reply reserve', color: 'var(--i-merge)' },
  { key: 'reasoning', label: 'Reasoning', color: 'var(--ember)' },
  { key: 'headroom', label: 'Room to work', color: 'var(--moss)' },
] as const;
const INTENT_ORDER = ['bugfix', 'feature', 'refactor', 'review', 'merge', 'onboarding', 'unknown'];
const EXAMPLES = [
  'Fix the null check in TollSession.close() and then add a config flag so ops can disable it',
  'Add a GET /disputes/next endpoint that returns the oldest open dispute',
  'Rename Ledger.post to Ledger.record everywhere',
];
const itemTitle = (i: PackItem) => {
  const named = i.content.match(/(?:class|function|interface|type)\s+(\w+)/)?.[1];
  if (i.source.path) return i.tier === 2 && named ? humanize(named) : i.source.path.split('/').slice(-2).join('/');
  if (i.source.commit) return `Change ${i.source.commit.slice(0, 8)}`;
  return (i.source.virtual ?? '').replace(/^summary:\/?$/, 'Summary of the product').replace(/^summary:/, 'Summary of ').replace('repo-map', 'Map of the code').replace('architecture', 'Project set-up');
};

export function PromptPage({ go }: { go: (page: string, arg?: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState<string>(() => saved('prompt.text', ''));
  const [host, setHost] = useState<Host>(() => saved('prompt.host', 'claude'));
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [c, setC] = useState<Compiled | null>(() => saved('prompt.last', null));
  const [tab, setTab] = useState<'prompt' | 'context' | 'tokens'>('prompt');
  const [exported, setExported] = useState<{ promptId: string; launched: boolean; command: string; reason?: string; how?: string } | null>(() => saved('prompt.exported', null));
  const [reading, setReading] = useState<Reading | null>(null);
  const [reading_busy, setReadingBusy] = useState(false);
  const [forced, setForced] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLPreElement>(null);

  useEffect(() => save('prompt.text', text), [text]);
  useEffect(() => save('prompt.host', host), [host]);
  useEffect(() => save('prompt.last', c), [c]);
  useEffect(() => save('prompt.exported', exported), [exported]);
  useEffect(() => {
    // Home hands over a task with "compile now"
    if (saved('prompt.auto', false) && text.trim()) { save('prompt.auto', false); void compile(); }
    else if (!text) ta.current?.focus();
  }, []);

  // read the task live while typing: what kind of prompt it will compile to
  useEffect(() => {
    if (text.trim().split(/\s+/).length < 3) { setReading(null); return; }
    setReadingBusy(true);
    const t = setTimeout(() => void ask({ type: 'route', text, ...(forced ? { intent: forced } : {}) })
      .then((r) => setReading(r['policy'] as Reading)).catch(() => undefined).finally(() => setReadingBusy(false)), 300);
    return () => clearTimeout(t);
  }, [text, forced]);

  const compile = async () => {
    if (!text.trim()) return ta.current?.focus();
    setBusy(true);
    setExported(null);
    setPhase(1);
    const t1 = setTimeout(() => setPhase(2), 220), t2 = setTimeout(() => setPhase(3), 440);
    try {
      const r = await ask({ type: 'prompt', text, host, ...(forced ? { intent: forced } : {}) });
      setC({ prompt: r['prompt'], pack: r['pack'], route: r['route'] } as Compiled);
      setPhase(4);
    } catch (e) {
      toast((e as Error).message, 'err');
      setPhase(0);
    } finally {
      clearTimeout(t1); clearTimeout(t2);
      setBusy(false);
    }
  };
  const exportIt = async () => {
    if (!c) return;
    try {
      const r = await ask({ type: 'exportPrompt', promptId: c.prompt.promptId });
      setExported({ promptId: c.prompt.promptId, launched: !!r['launched'], command: String(r['command']), ...(r['reason'] ? { reason: String(r['reason']) } : {}), ...(r['how'] ? { how: String(r['how']) } : {}) });
      toast(r['launched'] ? `Claude Code is starting in ${String(r['how'] ?? 'a terminal')}` : 'Could not open a terminal: copy the command below');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const jumpTo = (title: string) => {
    const el = preview.current;
    if (!el?.textContent) return;
    const at = el.textContent.indexOf(`## ${title}`);
    if (at >= 0) el.scrollTo({ top: (at / el.textContent.length) * el.scrollHeight - 12, behavior: 'smooth' });
  };

  const p = c?.prompt.plan;
  const mix = p?.intentMix.filter((m) => m.weight >= 0.05) ?? [];
  const done = (n: number) => (busy ? phase > n : !!c);
  const stale = !!c && !busy && exported?.promptId !== c.prompt.promptId;
  return (
    <div className="stack-lg">
      <div className="page-h"><div>
        <h1>Prompt</h1>
        <p className="lead">Describe the change. RIAF reads the task, gathers the code it needs, and compiles one prompt you can hand to Claude Code.</p>
      </div></div>

      <section className={`composer ${busy ? 'busy' : ''}`}>
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should Claude Code do?" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void compile(); } }} />
        <div className="composer-bar">
          <div className="seg-ctl" role="radiogroup" aria-label="Where the prompt goes">
            {HOSTS.map((h) => <button key={h.id} role="radio" aria-checked={host === h.id} className={host === h.id ? 'on' : ''} onClick={() => setHost(h.id)}>{h.label}</button>)}
          </div>
          <span className="grow" />
          <span className="muted small hide-sm">⌘↵</span>
          <Btn kind="primary" icon="bolt" onClick={() => void compile()} disabled={busy || !text.trim()}>{busy ? 'Compiling…' : 'Compile'}</Btn>
        </div>
        {!text && !c ? <div className="examples">{EXAMPLES.map((x) => <Chip key={x} onClick={() => setText(x)}>{x.length > 60 ? `${x.slice(0, 58)}…` : x}</Chip>)}</div> : null}
      </section>

      {text.trim() && (reading || reading_busy) ? <PromptType reading={reading} busy={reading_busy} forced={forced} onForce={(k) => setForced((f) => (f === k ? null : k))} /> : null}

      {busy || c ? (
        <ol className="pipeline4">
          <li className={done(1) ? 'done' : phase === 1 ? 'active' : ''}>
            <span className="p4-n">{done(1) ? <Icon name="check" size={13} /> : 1}</span>
            <div><b>Read the task</b>{c && !busy ? <span className="p4-v">{mix.map((m) => <i key={m.intent} style={{ color: intentVar(m.intent) }}>{INTENT_LABEL[m.intent]} {pct(m.weight)}</i>)}</span> : <span className="p4-v muted">kind of work, parts named</span>}</div>
          </li>
          <li className={done(2) ? 'done' : phase === 2 ? 'active' : ''}>
            <span className="p4-n">{done(2) ? <Icon name="check" size={13} /> : 2}</span>
            <div><b>Gather the context</b>{c && !busy ? <span className="p4-v">{c.pack.items.length} pieces · {fmtK(c.pack.tokensUsed)} of {fmtK(c.pack.budget)} tokens</span> : <span className="p4-v muted">code, history, rules</span>}</div>
          </li>
          <li className={done(3) ? 'done' : phase === 3 ? 'active' : ''}>
            <span className="p4-n">{done(3) ? <Icon name="check" size={13} /> : 3}</span>
            <div><b>Build the prompt</b>{c && !busy ? <span className="p4-v">{c.prompt.sections.length} sections · {fmtK(p!.prompt)} tokens{p!.planGate ? ' · plan first' : ''}</span> : <span className="p4-v muted">plan, budget, checks</span>}</div>
          </li>
          <li className={`p4-go ${exported && !stale ? 'done' : ''}`}>
            <span className="p4-n">{exported && !stale ? <Icon name="check" size={13} /> : 4}</span>
            <div><b>Run in Claude Code</b>
              {c && !busy ? (exported && !stale
                ? <button className="linkbtn" onClick={() => go('claude', c.prompt.promptId)}>See what Claude Code does →</button>
                : <Btn kind="primary" sm icon="send" onClick={() => void exportIt()}>Export to Claude Code</Btn>)
                : <span className="p4-v muted">export and follow</span>}
            </div>
          </li>
        </ol>
      ) : null}

      {exported && exported.launched && c && exported.promptId === c.prompt.promptId ? (
        <section className="cmdbox ok rise">
          <div className="cmd-live"><i className="pulse-dot" /><div><b>Claude Code is starting in {exported.how ?? 'a terminal'}</b><span className="muted small">It opens in the repository with the whole prompt as its first message and starts working; a new terminal window can take up to a minute while your shell starts. Approve Claude Code's steps there; every change it makes shows up here, keyed to prompt <code>{exported.promptId}</code>.</span></div></div>
          <div className="row"><Btn sm kind="primary" icon="live" onClick={() => go('claude', exported.promptId)}>Follow it live</Btn><CopyPair command={exported.command} message={c.prompt ? `[RIAF ${exported.promptId}] ${text.trim().replace(/\s+/g, ' ')}\n\n${c.prompt.text.trim()}\n` : ''} /></div>
        </section>
      ) : null}
      {exported && !exported.launched && c && exported.promptId === c.prompt.promptId ? (
        <section className="cmdbox rise">
          <div><b>{exported.reason ? `Could not open a terminal: ${exported.reason}` : 'Start Claude Code yourself'}</b><span className="muted small">Paste this into a <b>shell</b> (not into Claude Code): it changes into the repository and starts Claude Code with the whole prompt. Already in a Claude Code session? Use <b>Copy the prompt</b> and paste it there instead.</span></div>
          <pre>{exported.command}</pre>
          <div className="row"><CopyPair command={exported.command} message={`[RIAF ${exported.promptId}] ${text.trim().replace(/\s+/g, ' ')}\n\n${c.prompt.text.trim()}\n`} /><Btn sm kind="ghost" icon="live" onClick={() => go('claude', exported.promptId)}>Open Claude Code page</Btn></div>
        </section>
      ) : null}

      {c && !busy ? (
        <Card className="rise" title={<span className="row">Compiled prompt <Chip mono>{c.prompt.promptId}</Chip></span>}
          actions={<nav className="tabs mini">{(['prompt', 'context', 'tokens'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'prompt' ? 'Prompt' : t === 'context' ? 'Context' : 'Token budget'}</button>)}</nav>}>
          {tab === 'prompt' ? (
            <div className="promptview">
              <div className="toc">{c.prompt.sections.map((s) => (
                <button key={s.id} onClick={() => jumpTo(s.title)} title={s.title}>
                  <span>{SECTION_PLAIN[s.id] ?? s.title}</span>{s.cacheable ? <i className="cache-dot" title="cached across tasks" /> : null}<b>{fmtK(s.tokens)}</b>
                </button>))}
                <Btn sm kind="ghost" icon="copy" onClick={() => void copy(c.prompt.text).then(() => toast('Prompt copied'))}>Copy</Btn>
              </div>
              <pre ref={preview} className="prompt-pre">{c.prompt.text}</pre>
            </div>
          ) : tab === 'context' ? <ContextList items={c.pack.items} go={go} /> : <Budget p={p!} sections={c.prompt.sections} />}
        </Card>
      ) : !busy ? <Empty icon="prompt" title="Nothing compiled yet">Describe a task above and press <b>Compile</b>.</Empty> : null}

      {tab === 'tokens' && c && !busy ? <TokenSettingsCard onSaved={() => void compile()} /> : null}
    </div>
  );
}

/** Two clearly different copies: a command for a shell, and the prompt itself for an open Claude Code session. */
export function CopyPair({ command, message }: { command: string; message: string }) {
  const toast = useToast();
  return <>
    <Btn sm kind="soft" icon="terminal" onClick={() => void copy(command).then(() => toast('Shell command copied: paste it into a terminal'))} title="For a shell: changes into the repository and starts Claude Code with the prompt">Copy shell command</Btn>
    {message ? <Btn sm kind="ghost" icon="copy" onClick={() => void copy(message).then(() => toast('Prompt copied: paste it into Claude Code'))} title="For a Claude Code session that is already open">Copy the prompt</Btn> : null}
  </>;
}

/** Live: what kind of prompt the task will compile to, what that means, and a one-click correction. */
function PromptType({ reading, busy, forced, onForce }: { reading: Reading | null; busy: boolean; forced: string | null; onForce: (k: string) => void }) {
  const ranked = reading ? KINDS.map((k) => ({ ...k, w: reading.w[k.id] ?? 0 })).sort((a, b) => b.w - a.w) : [];
  const chosen = forced ? ranked.find((k) => k.id === forced) : undefined;
  const top = chosen ?? ranked[0];
  const leader = ranked[0];
  const second = !chosen && ranked[1] && reading && reading.branch === 'blended' && ranked[1].w >= 0.2 ? ranked[1] : undefined;
  const unclear = !chosen && !!reading && (reading.branch === 'clarify' || reading.branch === 'generic' || (reading.w['unknown'] ?? 0) > (top?.w ?? 0));
  const sure = reading ? (unclear ? 'unclear' : reading.branch === 'single' ? 'clear' : 'mixed') : '';
  return (
    <section className={`ptype ${busy ? 'reading' : ''}`} aria-live="polite">
      {!reading || !top ? <div className="ptype-h"><span className="ptype-i"><Icon name="sparkle" size={18} /></span><div><span className="eyebrow">Reading your task…</span></div></div> : <>
        <div className="ptype-h">
          <span className="ptype-i" style={{ ['--c' as string]: unclear ? 'var(--slate)' : intentVar(top.id) }}><Icon name={unclear ? 'alert' : top.icon} size={18} /></span>
          <div className="ptype-t">
            <span className="eyebrow">{forced ? 'Compiling as you chose' : 'This prompt will compile as'}</span>
            <h3>{unclear ? 'Not clear yet' : <><b style={{ color: intentVar(top.id) }}>{top.label}</b>{second ? <> + <b style={{ color: intentVar(second.id) }}>{second.label}</b></> : null}</>}
              <span className={`sure ${chosen ? 'chosen' : sure}`}>{chosen ? 'your choice' : sure === 'clear' ? 'clear reading' : sure === 'mixed' ? 'two kinds of work' : 'needs a question'}</span></h3>
            {unclear
              ? <p>{reading.question?.question ?? 'Name the part of the code or say what should change, or pick a kind of prompt below.'}</p>
              : <p>RIAF will gather {top.gathers}{second ? <>, plus {second.gathers}</> : null}. Claude Code will be told to {top.does}{second ? <>; for the {second.label.toLowerCase()} part, {second.does}</> : null}.</p>}
            {chosen && leader && leader.id !== chosen.id ? <p className="ptype-note"><Icon name="alert" size={13} />Your choice weighs {pct(chosen.w)} in RIAF's reading; the task still reads mostly as {leader.label.toLowerCase()} ({pct(leader.w)}), so the gathered context mixes both.</p> : null}
            {reading.units.length > 1 ? <ol className="ptype-parts">{reading.units.map((u) => <li key={u.id}>{u.text}</li>)}</ol> : null}
          </div>
        </div>
        <div className="ptype-pick" role="radiogroup" aria-label="Kind of prompt">
          <span className="muted small">{forced ? 'Change it:' : 'Not right? Compile it as'}</span>
          {ranked.map((k) => (
            <button key={k.id} role="radio" aria-checked={forced === k.id} className={`kchip ${forced === k.id ? 'on' : ''} ${!forced && k.id === top.id && !unclear ? 'top' : ''}`} style={{ ['--c' as string]: intentVar(k.id) }} onClick={() => onForce(k.id)} title={`RIAF gathers ${k.gathers}`}>
              <span className="kfill" style={{ width: pct(k.w) }} /><Icon name={k.icon} size={13} /><span>{k.label}</span><b>{pct(k.w)}</b>
            </button>
          ))}
        </div>
      </>}
    </section>
  );
}

function ContextList({ items, go }: { items: PackItem[]; go: (p: string, a?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">{[1, 2, 3, 4].map((tier) => {
      const seen = new Set<string>();
      const list = items.filter((i) => i.tier === tier).filter((i) => { const k = itemTitle(i) + (i.source.path ?? ''); if (seen.has(k)) return false; seen.add(k); return true; });
      if (!list.length) return null;
      return (
        <div key={tier}>
          <div className="group-h">{GROUP[tier]} <span className="muted small">({list.length})</span></div>
          <div className="plainlist">{list.slice(0, 12).map((i) => (
            <div key={i.id}>
              <button className="plainrow" onClick={() => setOpen(open === i.id ? null : i.id)}>
                <Icon name={i.kind === 'test' ? 'check' : i.kind === 'commit' ? 'commit' : i.tier === 1 ? 'overview' : 'code'} size={15} />
                <span><b>{itemTitle(i)}</b><span className="muted small">{i.why.rule.replace(/_/g, ' ')}{i.source.path ? <> · <code>{i.source.path}</code></> : null}</span></span>
                <span className="muted small">{fmtK(i.tokens)}</span>
              </button>
              {open === i.id ? <pre className="item-code">{i.content}</pre> : null}
              {open === i.id && i.source.path ? <button className="linkbtn" onClick={() => go('repository', i.source.path)}>Open in Repository →</button> : null}
            </div>))}
            {list.length > 12 ? <span className="muted small">and {list.length - 12} more</span> : null}
          </div>
        </div>
      );
    })}</div>
  );
}

function Budget({ p, sections }: { p: TokenPlan; sections: Section[] }) {
  const ctx = sections.find((s) => s.id === 'context')?.tokens ?? 0;
  const parts: Record<string, number> = { cache: p.cacheable, frame: Math.max(0, p.prompt - p.cacheable - ctx), context: ctx, output: p.output, reasoning: p.reasoning, headroom: p.headroom };
  const margin = p.contextWindow - p.usable;
  return (
    <div className="stack">
      <p className="muted small">{p.model} · {fmtK(p.contextWindow)} tokens · RIAF plans to use {pct(p.usable / p.contextWindow)} and keeps the rest as a safety margin.</p>
      <div className="window">
        {PART.map((x) => parts[x.key]! > 0 ? <i key={x.key} style={{ flexGrow: parts[x.key], background: x.color }} title={`${x.label}: ${fmtK(parts[x.key]!)}`} /> : null)}
        <i className="margin" style={{ flexGrow: margin }} title={`Safety margin: ${fmtK(margin)}`} />
      </div>
      <div className="window-legend">
        {PART.map((x) => parts[x.key]! > 0 ? <span key={x.key}><i className="sw" style={{ background: x.color }} />{x.label}<b>{fmtK(parts[x.key]!)}</b></span> : null)}
        <span><i className="sw margin" />Safety margin<b>{fmtK(margin)}</b></span>
      </div>
      <div className="mixrows">{p.intentMix.filter((m) => m.weight >= 0.01).map((m) => (
        <div key={m.intent} className="mixrow">
          <span className="mix-l"><i className="chip-dot" style={{ background: intentVar(m.intent) }} />{INTENT_LABEL[m.intent] ?? m.intent}</span>
          <span className="mix-t"><span style={{ width: pct(m.weight), background: intentVar(m.intent) }} /></span>
          <b>{pct(m.weight)}</b>
          <span className="muted small">code {fmtK(m.pack)} · reply {fmtK(m.output)}{m.planGate ? ' · plan first' : ''}</span>
        </div>))}</div>
      <div className={`gate ${p.planGate ? 'on' : ''}`}><Icon name={p.planGate ? 'alert' : 'check'} size={14} />{p.planGate ? 'Claude Code will show its plan and wait for approval before editing.' : 'Claude Code can start editing straight away.'}</div>
    </div>
  );
}

/* ───────── token settings (.riaf/tokens.yaml) ───────── */
function TokenSettingsCard({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const { detailed } = useDetailed();
  const [t, setT] = useState<Msg | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [yaml, setYaml] = useState('');
  const [tab, setTab] = useState<'form' | 'yaml'>('form');
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const load = () => void ask({ type: 'tokens' }).then((r) => { setT(r); setS(r['settings'] as Settings); setYaml(r['text'] as string); setErrors(r['errors'] as string[]); setDirty(false); });
  useEffect(load, []);
  const edit = (f: (x: Settings) => Settings) => { setS((x) => (x ? f(structuredClone(x)) : x)); setDirty(true); };
  const fits = useMemo(() => s ? INTENT_ORDER.filter((i) => s.intents[i] && s.intents[i]!.pack + s.intents[i]!.output + s.reasoning >= s.model.context_window * s.model.use_ratio) : [], [s]);
  if (!t || !s) return <Skeleton h={220} />;
  const presets = t['presets'] as Record<string, Settings>;
  const doSave = async () => {
    const r = await ask(tab === 'yaml' ? { type: 'saveTokens', text: yaml } : { type: 'saveTokens', settings: s });
    if (r.type === 'tokensSaved') { toast('Token settings saved'); load(); onSaved(); }
    else setErrors(r['errors'] as string[]);
  };
  return (
    <Card title="Token settings" sub={<>How much of the model's window each kind of work may use. Saved to <code>.riaf/tokens.yaml</code>{t['source'] === 'builtin' ? ' (currently using the built-in defaults)' : ''}.</>}
      actions={<>
        <Detail><nav className="tabs mini"><button className={tab === 'form' ? 'on' : ''} onClick={() => setTab('form')}>Form</button><button className={tab === 'yaml' ? 'on' : ''} onClick={() => setTab('yaml')}>YAML</button></nav></Detail>
        <Btn kind="primary" sm icon="check" onClick={() => void doSave()} disabled={!dirty && tab === 'form'}>Save</Btn>
      </>}>
      <div className="presets">
        <span className="muted small">Start from:</span>
        {(['economy', 'balanced', 'thorough'] as const).map((k) => (
          <button key={k} className="preset" onClick={() => { setS(presets[k]!); setDirty(true); }}>
            <b>{k === 'economy' ? 'Economy' : k === 'balanced' ? 'Balanced' : 'Thorough'}</b>
            <span className="muted small">{k === 'economy' ? 'smallest prompts, lowest cost' : k === 'balanced' ? 'the defaults' : 'more context, longer replies'}</span>
          </button>))}
      </div>
      {errors.length ? <div className="errs">{errors.map((e) => <div key={e}><Icon name="alert" size={13} />{e}</div>)}</div> : null}
      {tab === 'yaml' && detailed ? <textarea className="yaml-ed" value={yaml} onChange={(e) => { setYaml(e.target.value); setDirty(true); }} spellCheck={false} rows={22} /> : <>
        <div className="tokform">
          <label><span>Model</span><input value={s.model.name} onChange={(e) => edit((x) => { x.model.name = e.target.value; return x; })} /></label>
          <label><span>Context window</span><input type="number" step={1000} value={s.model.context_window} onChange={(e) => edit((x) => { x.model.context_window = Number(e.target.value); return x; })} /></label>
          <label><span>Use up to <b>{pct(s.model.use_ratio)}</b> of it</span><input type="range" min={0.5} max={0.95} step={0.05} value={s.model.use_ratio} onChange={(e) => edit((x) => { x.model.use_ratio = Number(e.target.value); return x; })} /></label>
          <Detail><label><span>Reasoning reserve</span><input type="number" step={1024} min={0} value={s.reasoning} onChange={(e) => edit((x) => { x.reasoning = Number(e.target.value); return x; })} /></label></Detail>
          <Detail><label><span>Summarise at <b>{pct(s.summarize_at)}</b></span><input type="range" min={0.3} max={0.9} step={0.05} value={s.summarize_at} onChange={(e) => edit((x) => { x.summarize_at = Number(e.target.value); return x; })} /></label></Detail>
          <Detail><label className="check"><input type="checkbox" checked={s.cache.stable_prefix} onChange={(e) => edit((x) => { x.cache.stable_prefix = e.target.checked; return x; })} /><span>Cacheable instructions first</span></label></Detail>
        </div>
        <table className="ptable tok">
          <thead><tr><th>Kind of work</th><th className="num">Code and history</th><th className="num">Reply</th><th>Plan first</th></tr></thead>
          <tbody>{INTENT_ORDER.filter((i) => s.intents[i]).map((i) => (
            <tr key={i} className={fits.includes(i) ? 'bad' : ''}>
              <td><i className="chip-dot" style={{ background: intentVar(i) }} />{INTENT_LABEL[i]}</td>
              <td className="num"><input type="number" step={500} value={s.intents[i]!.pack} onChange={(e) => edit((x) => { x.intents[i]!.pack = Number(e.target.value); return x; })} /></td>
              <td className="num"><input type="number" step={256} value={s.intents[i]!.output} onChange={(e) => edit((x) => { x.intents[i]!.output = Number(e.target.value); return x; })} /></td>
              <td><input type="checkbox" checked={s.intents[i]!.plan_gate} onChange={(e) => edit((x) => { x.intents[i]!.plan_gate = e.target.checked; return x; })} aria-label={`Plan first for ${INTENT_LABEL[i]}`} /></td>
            </tr>))}</tbody>
        </table>
        {fits.length ? <p className="ember small">{fits.map((i) => INTENT_LABEL[i]).join(', ')}: code + reply + reasoning no longer fit in the usable window.</p> : null}
        <Detail><p className="muted small">Section caps: protocol {s.sections.protocol}, plan {s.sections.plan}, notes {s.sections.notes} tokens · plan gate applies at weight ≥ {pct(s.plan_gate_min_weight)} · cache TTL {s.cache.ttl}. Edit them in YAML.</p></Detail>
      </>}
    </Card>
  );
}
