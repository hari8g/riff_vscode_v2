import { useEffect, useMemo, useRef, useState } from 'react';
import { ask, save, saved, type Msg } from '../api.js';
import { Btn, Card, Chip, copy, Detail, Empty, fmtK, Icon, INTENT_LABEL, intentVar, pct, Skeleton, useDetailed, useToast } from '../kit.js';

/**
 * What the AI receives: the detailed prompt RIAF injects after reading the task (intent routing) and
 * gathering the context (pack compilation), how it spends the model's context window, and the token
 * settings behind it (`.riaf/tokens.yaml`), editable with presets.
 */

type Host = 'claude' | 'copilot' | 'generic';
interface Section { id: string; title: string; tokens: number; cacheable: boolean }
interface TokenPlan {
  model: string; contextWindow: number; usable: number; reasoning: number; output: number; packBudget: number; packUsed: number;
  frame: number; prompt: number; cacheable: number; headroom: number; summarizeAt: number; planGate: boolean;
  intentMix: { intent: string; weight: number; pack: number; output: number; planGate: boolean }[];
}
interface Prompt { promptId: string; host: Host; text: string; stableHash: string; sections: Section[]; plan: TokenPlan }
interface IntentTokens { pack: number; output: number; plan_gate: boolean }
interface Settings {
  version: 1; model: { name: string; context_window: number; use_ratio: number }; reasoning: number;
  sections: { protocol: number; plan: number; notes: number }; intents: Record<string, IntentTokens>;
  plan_gate_min_weight: number; cache: { stable_prefix: boolean; ttl: '5m' | '1h' }; summarize_at: number;
}

const HOSTS: { id: Host; label: string }[] = [{ id: 'claude', label: 'Claude Code' }, { id: 'copilot', label: 'Copilot' }, { id: 'generic', label: 'Any model' }];
const SECTION_PLAIN: Record<string, string> = {
  protocol: 'How to work here', repository: 'Team rules and commands', reply: 'How to reply', task: 'Your task, as RIAF read it',
  plan: 'Step-by-step plan', budget: 'Token and tool budget', notes: 'What to watch', context: 'The code and history', finish: 'Checklist before finishing',
};
const PART = [
  { key: 'cache', label: 'Instructions (cached)', color: 'var(--i-review)' },
  { key: 'frame', label: 'Instructions for this task', color: 'var(--i-refactor)' },
  { key: 'context', label: 'Code and history', color: 'var(--teal)' },
  { key: 'output', label: 'Reply reserve', color: 'var(--i-merge)' },
  { key: 'reasoning', label: 'Reasoning reserve', color: 'var(--ember)' },
  { key: 'headroom', label: 'Room for the AI\'s own reading', color: 'var(--moss)' },
] as const;
const EXAMPLES = [
  'Fix the null check in TollSession.close() and then add a config flag so ops can disable it',
  'Add a GET /disputes/next endpoint that returns the oldest open dispute',
  'Rename Ledger.post to Ledger.record everywhere',
];
const INTENT_ORDER = ['bugfix', 'feature', 'refactor', 'review', 'merge', 'onboarding', 'unknown'];

export function PromptPage({ go }: { go: (page: string, arg?: string) => void }) {
  const toast = useToast();
  const { detailed } = useDetailed();
  const [text, setText] = useState<string>(() => saved('prompt.text', EXAMPLES[0]!));
  const [host, setHost] = useState<Host>(() => saved('prompt.host', 'claude'));
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ prompt: Prompt; pack: Msg } | null>(() => saved('prompt.last', null));
  const [step, setStep] = useState(r ? 3 : 0);
  const preview = useRef<HTMLPreElement>(null);

  useEffect(() => save('prompt.text', text), [text]);
  useEffect(() => save('prompt.host', host), [host]);
  useEffect(() => save('prompt.last', r), [r]);

  const build = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setStep(1);
    const t1 = setTimeout(() => setStep(2), 260);
    try {
      const res = await ask({ type: 'prompt', text, host });
      setR({ prompt: res['prompt'] as Prompt, pack: res['pack'] as Msg });
      setStep(3);
      toast(detailed ? `Prompt ${(res['prompt'] as Prompt).promptId}: ${fmtK((res['prompt'] as Prompt).plan.prompt)} tokens` : 'Prompt ready');
    } catch (e) {
      toast((e as Error).message, 'err');
      setStep(0);
    } finally {
      clearTimeout(t1);
      setBusy(false);
    }
  };
  const jumpTo = (title: string) => {
    const el = preview.current;
    if (!el) return;
    const at = el.textContent?.indexOf(`## ${title}`) ?? -1;
    if (at < 0) return;
    const ratio = at / Math.max(1, el.textContent!.length);
    el.scrollTo({ top: ratio * el.scrollHeight - 12, behavior: 'smooth' });
  };

  return (
    <div className="stack-lg">
      <div className="page-h"><div>
        <h1>AI prompt</h1>
        <p className="lead">{detailed
          ? 'The detailed prompt RIAF injects after intent routing and pack compilation: protocol, task, plan, token and tool budget, notes from the graph and history, the context pack and a finishing checklist. Stable sections come first so the provider can cache them.'
          : 'Exactly what RIAF hands the AI assistant once it has read your task and gathered the code: clear instructions, a plan, a budget, things to watch, and the code itself.'}</p>
      </div></div>

      <section className={`taskline ${busy ? 'busy' : ''}`}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Describe a task" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void build(); } }} />
        <div className="taskline-bar">
          <div className="seg-ctl" role="radiogroup" aria-label="Where the prompt goes">
            {HOSTS.map((h) => <button key={h.id} role="radio" aria-checked={host === h.id} className={host === h.id ? 'on' : ''} onClick={() => setHost(h.id)}>{h.label}</button>)}
          </div>
          <span className="grow" />
          <Btn kind="primary" icon="bolt" onClick={() => void build()} disabled={busy}>{busy ? 'Building…' : 'Build prompt'}</Btn>
        </div>
        <div className="examples">{EXAMPLES.map((x) => <Chip key={x} onClick={() => setText(x)}>{x.length > 58 ? `${x.slice(0, 56)}…` : x}</Chip>)}</div>
      </section>

      <ol className="steps3">
        {['Read the task', 'Gather the context', 'Build the prompt'].map((s, i) => (
          <li key={s} className={step > i ? 'done' : step === i + 1 && busy ? 'active' : ''}><span>{step > i ? <Icon name="check" size={13} /> : i + 1}</span>{s}</li>
        ))}
      </ol>

      {r ? <PromptView r={r} jumpTo={jumpTo} previewRef={preview} go={go}
        onCopy={() => void copy(r.prompt.text).then(() => toast('Prompt copied'))}
        onSend={(to) => void ask({ type: 'handoff', to, text, packId: String(r.pack['packId']) }).then(() => toast(to === 'claude' ? 'Sent to Claude Code' : 'Sent to Copilot')).catch((e: Error) => toast(e.message, 'err'))} />
        : <Empty icon="prompt" title="No prompt yet">Describe a task and press <b>Build prompt</b>.</Empty>}

      <TokenSettingsCard onSaved={() => { if (r) void build(); }} />
    </div>
  );
}

function PromptView({ r, jumpTo, previewRef, onCopy, onSend, go }: { r: { prompt: Prompt; pack: Msg }; jumpTo: (t: string) => void; previewRef: React.RefObject<HTMLPreElement>; onCopy: () => void; onSend: (to: 'claude' | 'copilot') => void; go: (p: string, a?: string) => void }) {
  const { detailed } = useDetailed();
  const p = r.prompt.plan;
  const ctx = r.prompt.sections.find((s) => s.id === 'context')?.tokens ?? 0;
  const parts: Record<string, number> = { cache: p.cacheable, frame: Math.max(0, p.prompt - p.cacheable - ctx), context: ctx, output: p.output, reasoning: p.reasoning, headroom: p.headroom };
  const margin = p.contextWindow - p.usable;
  return (
    <div className="stack-lg rise">
      <Card title="How the context window is spent" sub={`${p.model} · ${fmtK(p.contextWindow)} tokens, RIAF plans to use ${pct(p.usable / p.contextWindow)} and keeps the rest as a safety margin.`}>
        <div className="window">
          {PART.map((x) => parts[x.key]! > 0 ? <i key={x.key} style={{ flexGrow: parts[x.key], background: x.color }} title={`${x.label}: ${fmtK(parts[x.key]!)}`} /> : null)}
          <i className="margin" style={{ flexGrow: margin }} title={`Safety margin: ${fmtK(margin)}`} />
        </div>
        <div className="window-legend">
          {PART.map((x) => parts[x.key]! > 0 ? <span key={x.key}><i className="sw" style={{ background: x.color }} />{x.label}<b>{fmtK(parts[x.key]!)}</b></span> : null)}
          <span><i className="sw margin" />Safety margin<b>{fmtK(margin)}</b></span>
        </div>
        <div className="kpis">
          <div><b>{fmtK(p.prompt)}</b><span>prompt size</span></div>
          <div><b>{fmtK(p.packUsed)}<small> / {fmtK(p.packBudget)}</small></b><span>code and history used / allowed</span></div>
          <div><b>{fmtK(p.output)}</b><span>kept for the reply</span></div>
          <div><b>{fmtK(p.headroom)}</b><span>room left for the AI</span></div>
          <Detail><div><b>{fmtK(p.summarizeAt)}</b><span>summarise at</span></div></Detail>
          <Detail><div><b>{fmtK(p.cacheable)}</b><span>cacheable prefix</span></div></Detail>
        </div>
      </Card>

      <div className="grid2">
        <Card title={detailed ? 'Budget by intent' : 'What kind of work it is'} sub={detailed ? 'Per-intent pack and reply budgets from tokens.yaml, blended by the route\'s weights.' : 'The budget follows the kind of work: each kind brings its own share of code and reply space.'}>
          <div className="mixrows">{p.intentMix.filter((m) => m.weight >= 0.01).map((m) => (
            <div key={m.intent} className="mixrow">
              <span className="mix-l"><i className="chip-dot" style={{ background: intentVar(m.intent) }} />{INTENT_LABEL[m.intent] ?? m.intent}</span>
              <span className="mix-t"><span style={{ width: pct(m.weight), background: intentVar(m.intent) }} /></span>
              <b>{pct(m.weight)}</b>
              <span className="muted small">code {fmtK(m.pack)} · reply {fmtK(m.output)}{m.planGate ? ' · plan first' : ''}</span>
            </div>))}</div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <div className={`gate ${p.planGate ? 'on' : ''}`}><Icon name={p.planGate ? 'alert' : 'check'} size={14} />{p.planGate ? 'The AI will show its plan and wait for your approval before editing.' : 'The AI can start editing straight away.'}</div>
          </div>
        </Card>
        <Card title="What is in the prompt" sub="Click a part to see it below.">
          <div className="sections">{r.prompt.sections.map((s) => (
            <button key={s.id} className="secrow" onClick={() => jumpTo(s.title)}>
              <span className="sec-n">{detailed ? s.title : SECTION_PLAIN[s.id] ?? s.title}</span>
              {s.cacheable ? <span className="cache-b" title="Same for every task; the AI provider can cache it">cached</span> : null}
              <span className="sec-t"><span style={{ width: pct(s.tokens / Math.max(...r.prompt.sections.map((x) => x.tokens))) }} /></span>
              <span className="num">{fmtK(s.tokens)}</span>
            </button>))}</div>
          <Detail><p className="muted small" style={{ marginTop: 10 }}>Prompt <code>{r.prompt.promptId}</code> · stable prefix <code>{r.prompt.stableHash}</code> · pack <code>{String(r.pack['packId'])}</code></p></Detail>
        </Card>
      </div>

      <Card title="The prompt" sub={`${r.prompt.sections.length} parts · ${fmtK(p.prompt)} tokens · for ${HOSTS.find((h) => h.id === r.prompt.host)?.label}`}
        actions={<>
          <Btn kind="primary" sm icon="send" onClick={() => onSend('claude')}>Send to Claude Code</Btn>
          <Btn kind="soft" sm icon="send" onClick={() => onSend('copilot')}>Send to Copilot</Btn>
          <Btn kind="ghost" sm icon="copy" onClick={onCopy}>Copy</Btn>
          <Btn kind="ghost" sm icon="repository" onClick={() => go('studio')}>See the context</Btn>
        </>}>
        <pre ref={previewRef} className="prompt-pre">{r.prompt.text}</pre>
      </Card>
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
