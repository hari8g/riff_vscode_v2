import { useEffect, useMemo, useState } from 'react';
import { parse } from 'yaml';
import { ask, type Msg } from '../api.js';
import { Btn, Card, Chip, INTENT_LABEL, INTENTS, intentVar, pct, Skeleton, useToast } from '../kit.js';

interface Primitive { anchors: string[]; expansion: { rule: string; hops?: number; cap?: number; exclude?: string }[]; history: string[]; weights: Record<string, number> }
interface Policies { router: { entropy: { single_below: number; blend_below: number }; top_intent_min: number; blend_floor: number }; budget: { default_total: number; fixed: { map: number; runbook: number } }; primitives: Record<string, Primitive> }
const BUCKET_COLORS = ['var(--teal)', 'var(--i-feature)', 'var(--ember)', 'var(--i-review)', 'var(--moss)', 'var(--i-merge)'];

export function PoliciesPage() {
  const toast = useToast();
  const [src, setSrc] = useState<Msg | null>(null);
  const [pol, setPol] = useState('');
  const [gov, setGov] = useState('');
  const [diag, setDiag] = useState<Msg[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'visual' | 'policies' | 'governance'>('visual');
  useEffect(() => {
    void ask({ type: 'load', page: 'policies' }).then((r) => { setSrc(r); setPol(r['policies']); setGov(r['governance']); });
  }, []);
  // validate as you type
  useEffect(() => {
    if (!src) return;
    const t = setTimeout(() => void ask({ type: 'validatePolicies', policies: pol, governance: gov }).then((r) => setDiag(r['diagnostics'] as Msg[])), 350);
    return () => clearTimeout(t);
  }, [pol, gov]);
  const parsed = useMemo<Policies | null>(() => { try { return parse(pol) as Policies; } catch { return null; } }, [pol]);
  if (!src) return <div className="stack-lg"><Skeleton h={200} /><Skeleton h={300} /></div>;
  const save = async () => {
    const r = await ask({ type: 'savePolicies', policies: pol, governance: gov });
    if (r.type === 'saved') { setDirty(false); toast('Saved: the next request uses these policies'); } else { setDiag(r['diagnostics'] as Msg[]); toast('Not saved: fix the highlighted problems', 'err'); }
  };
  return (
    <div className="stack-lg">
      <div className="page-h">
        <div><h1>Policies</h1><p className="lead">Policies are data. How the router reads intent, how each intent retrieves context and how budgets split all live in <code>.riaf/*.yaml</code>, versioned with the code. Edits apply to the next request; no release needed.</p></div>
        <div className="row">
          <Chip mono>{src['version']}</Chip>
          {diag.length ? <Chip tone="ember" dot="var(--ember)">{diag.length} problem{diag.length === 1 ? '' : 's'}</Chip> : <Chip tone="moss" dot="var(--moss)">valid</Chip>}
          <Btn kind="primary" icon="check" onClick={() => void save()} disabled={!dirty || diag.length > 0}>Save</Btn>
        </div>
      </div>
      <nav className="tabs big">
        <button className={tab === 'visual' ? 'on' : ''} onClick={() => setTab('visual')}>Visual</button>
        <button className={tab === 'policies' ? 'on' : ''} onClick={() => setTab('policies')}>policies.yaml</button>
        <button className={tab === 'governance' ? 'on' : ''} onClick={() => setTab('governance')}>governance.yaml</button>
      </nav>
      {diag.length > 0 && <div className="diag">{diag.map((x, i) => <div key={i}><b>{x['file']}</b> <code>{x['path'] || '(root)'}</code> {x['message']}</div>)}</div>}
      {tab === 'visual' && parsed?.router && (
        <>
          <Card title="Entropy gate" sub="Normalised entropy of the intent vector decides how the request is served.">
            <div className="hscale">
              <div className="hz single" style={{ width: pct(parsed.router.entropy.single_below) }}><b>single</b><span>one policy</span></div>
              <div className="hz blend" style={{ width: pct(parsed.router.entropy.blend_below - parsed.router.entropy.single_below) }}><b>blended</b><span>weighted union</span></div>
              <div className="hz probe" style={{ flex: 1 }}><b>probe → clarify / generic</b><span>gather evidence, then ask (live) or go generic (unattended)</span></div>
            </div>
            <div className="hticks"><span>0</span><span style={{ left: pct(parsed.router.entropy.single_below) }}>{parsed.router.entropy.single_below}</span><span style={{ left: pct(parsed.router.entropy.blend_below) }}>{parsed.router.entropy.blend_below}</span><span style={{ left: '100%' }}>1</span></div>
            <div className="row wrap" style={{ marginTop: 12 }}>
              <Chip>top intent ≥ {pct(parsed.router.top_intent_min)} for single</Chip><Chip>blend floor {pct(parsed.router.blend_floor)}</Chip>
              <Chip>budget {parsed.budget.default_total.toLocaleString()} tokens</Chip><Chip>map ≤ {parsed.budget.fixed.map}</Chip><Chip>run-book ≤ {parsed.budget.fixed.runbook}</Chip>
            </div>
          </Card>
          <div className="prims">
            {INTENTS.map((i) => {
              const p = parsed.primitives?.[i];
              if (!p) return null;
              const buckets = Object.entries(p.weights ?? {});
              return (
                <section key={i} className="prim" style={{ ['--accent' as string]: intentVar(i) }}>
                  <header><i className="chip-dot" style={{ background: intentVar(i) }} /><h3>{INTENT_LABEL[i]}</h3></header>
                  <div className="wbar">{buckets.map(([b, v], k) => <i key={b} style={{ width: pct(v), background: BUCKET_COLORS[k % BUCKET_COLORS.length] }} title={`${b} ${pct(v)}`} />)}</div>
                  <div className="wlegend">{buckets.map(([b, v], k) => <span key={b}><i className="sw" style={{ background: BUCKET_COLORS[k % BUCKET_COLORS.length] }} />{b.replace(/_/g, ' ')} {pct(v)}</span>)}</div>
                  <div className="mini-h">Anchors from</div>
                  <div className="row wrap">{p.anchors.map((a) => <Chip key={a} tone="quiet">{a.replace(/_/g, ' ')}</Chip>)}</div>
                  <div className="mini-h">Expands along</div>
                  <div className="row wrap">{p.expansion.map((r) => <Chip key={r.rule} mono>{r.rule}{r.hops ? ` ×${r.hops}` : ''}{r.cap ? ` ≤${pct(r.cap)}` : ''}</Chip>)}</div>
                  {p.history.length > 0 && <><div className="mini-h">History</div><div className="row wrap">{p.history.map((h) => <Chip key={h} tone="ember">{h.replace(/_/g, ' ')}</Chip>)}</div></>}
                </section>
              );
            })}
          </div>
        </>
      )}
      {tab === 'visual' && !parsed?.router && <Card title="Cannot draw the policies"><p className="muted">policies.yaml does not parse; fix it in the editor tab.</p></Card>}
      {tab !== 'visual' && (
        <textarea className="editor" spellCheck={false} value={tab === 'policies' ? pol : gov} onChange={(e) => { (tab === 'policies' ? setPol : setGov)(e.target.value); setDirty(true); }} />
      )}
    </div>
  );
}
