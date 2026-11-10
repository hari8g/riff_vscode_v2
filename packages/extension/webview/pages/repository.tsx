import { useEffect, useMemo, useState } from 'react';
import { ask, type Msg } from '../api.js';
import { Btn, Card, Chip, Detail, Empty, Icon, shortLabel, shortPath, Skeleton, symKind, symName, useDetailed, useToast } from '../kit.js';
import { humanize, kindWord } from '../../src/ask.js';

const CHANGE_WORD: Record<string, string> = { feat: 'new', fix: 'fix', refactor: 'restructure', perf: 'speed-up', revert: 'rollback', incident: 'incident', test: 'checks', docs: 'docs', chore: 'housekeeping' };

interface Node { id: string; level: string; title: string; summary: string; children: Node[] }

export function Repository({ focus }: { focus?: string }) {
  const toast = useToast();
  const { detailed } = useDetailed();
  const [tree, setTree] = useState<Node | null>(null);
  const [runbook, setRunbook] = useState('');
  const [sel, setSel] = useState<string>('');
  const [page, setPage] = useState<Msg | null>(null);
  const [sym, setSym] = useState<string | null>(focus ?? null);
  const [q, setQ] = useState('');
  useEffect(() => {
    void ask({ type: 'load', page: 'repository' }).then((r) => {
      setTree(r['tree'] as Node);
      setRunbook(r['runbook'] as string);
    }).catch((e: Error) => toast(e.message, 'err'));
  }, []);
  useEffect(() => { if (focus) setSym(focus); }, [focus]);
  useEffect(() => {
    void ask({ type: 'wikiPage', node: sel || '' }).then((r) => setPage(r['page'])).catch(() => setPage(null));
  }, [sel]);
  const search = () => { if (q.trim()) setSym(q.trim()); };
  if (!tree) return <div className="stack-lg"><Skeleton h={60} /><Skeleton h={380} /></div>;
  return (
    <div className="stack-lg">
      <div className="page-h">
        <div><h1>Explore the code</h1><p className="lead">{detailed ? 'Structure with summaries built bottom-up from the code. Pick a symbol to see who depends on it, which tests cover it, and why it looks the way it does.' : 'Browse the product area by area. Pick a part to see what uses it, which automated checks cover it, and how it has changed.'}</p></div>
        <div className="searchbox"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder={detailed ? 'Class.method, name or path:line' : 'Find a part by name'} /></div>
      </div>
      <div className="split">
        <Card className="tree-card" title={detailed ? 'Structure' : 'Areas'}>
          <ul className="tree"><TreeNode n={tree} sel={sel} onSel={setSel} depth={0} /></ul>
        </Card>
        <div className="stack">
          {sym ? <SymbolView query={sym} onClose={() => setSym(null)} onPick={setSym} /> : (
            <Card title={<span className="row">{page?.['id'] || 'repository'}</span>} {...(detailed ? { sub: page?.['level'] } : {})}>
              {page ? <>
                <p className="summary">{String(page['summary'] ?? '').split('\n')[0]}</p>
                {(page['symbols'] as Msg[]).length > 0 && <div className="symlist">{(page['symbols'] as Msg[]).map((s) => (
                  <button key={String(s['id'])} className="symrow" onClick={() => setSym(String(s['id']))}><Chip tone="quiet" mono={detailed}>{detailed ? s['kind'] : kindWord(s['kind'])}</Chip><span className={detailed ? 'mono' : ''}>{detailed ? s['signature'] : humanize(String(s['id']))}</span>{s['doc'] && <span className="muted small">{s['doc']}</span>}</button>
                ))}</div>}
                {(page['children'] as Msg[]).length > 0 && <div className="children">{(page['children'] as Msg[]).map((c) => (
                  <button key={String(c['id'])} className="childrow" onClick={() => setSel(String(c['id']))}><Icon name={String(c['id']).endsWith('/') ? 'folder' : 'file'} size={15} /><span className="mono">{shortPath(String(c['id']), 2)}</span><span className="muted small">{c['summary']}</span></button>
                ))}</div>}
              </> : <Skeleton h={160} />}
            </Card>
          )}
          <Detail><details className="card runbook"><summary>Run-book <span className="muted small">generated, ≤ 60 lines</span></summary><pre className="render-pre">{runbook}</pre></details></Detail>
        </div>
      </div>
    </div>
  );
}

function TreeNode({ n, sel, onSel, depth }: { n: Node; sel: string; onSel: (id: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const has = n.children.length > 0;
  return (
    <li>
      <button className={`tnode ${sel === n.id ? 'sel' : ''}`} onClick={() => { onSel(n.id); if (has) setOpen(!open); }} title={n.summary}>
        {has ? <span className={`tchev ${open ? 'open' : ''}`}><Icon name="chevron" size={12} /></span> : <span className="tchev" />}
        <Icon name="folder" size={14} /><span className="tname">{n.id === '' ? n.title : n.id.split('/').filter(Boolean).pop()}</span>
      </button>
      {has && open && <ul>{n.children.map((c) => <TreeNode key={c.id} n={c} sel={sel} onSel={onSel} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function SymbolView({ query, onClose, onPick }: { query: string; onClose: () => void; onPick: (q: string) => void }) {
  const [imp, setImp] = useState<Msg | null>(null);
  const [hist, setHist] = useState<Msg | null>(null);
  useEffect(() => {
    setImp(null);
    setHist(null);
    void ask({ type: 'impact', query }).then(setImp);
    void ask({ type: 'history', query }).then(setHist).catch(() => setHist(null));
  }, [query]);
  const { detailed } = useDetailed();
  if (!imp) return <Skeleton h={420} />;
  const d = imp['definition'];
  if (!d) return <Card title={query} actions={<Btn kind="ghost" sm onClick={onClose}>Close</Btn>}><Empty icon="search" title="Nothing found">{detailed ? <>Try a qualified name such as <code>Class.method</code>, or <code>path:line</code>.</> : 'Try another name, or ask the question on the Ask page.'}</Empty></Card>;
  const refs = imp['references'] as Msg[];
  const impact = imp['impact'];
  return (
    <Card className="rise" title={<span className="row"><Chip mono={detailed} tone="teal">{detailed ? d['kind'] : kindWord(d['kind'])}</Chip>{detailed ? symName(d['symbol']) : humanize(d['symbol'])}</span>} sub={detailed ? `${d['path']}:${d['startLine']}-${d['endLine']}` : `in ${d['path']}`} actions={<Btn kind="ghost" sm onClick={onClose}>Close</Btn>}>
      <Detail><pre className="sig">{d['signature']}</pre></Detail>
      {d['doc'] && <p className="summary">{String(d['doc']).split('\n')[0]}</p>}
      <div className="grid2 tight">
        <div>
          <div className="mini-h">{detailed ? 'Blast radius' : 'What depends on it'}</div>
          <ImpactGraph center={d['symbol']} closure={impact.closure} tests={impact.tests} coChange={impact.coChange} onPick={onPick} />
          <div className="legend"><span><i className="sw" style={{ background: 'var(--teal)' }} />{detailed ? 'direct' : 'uses it'}</span><span><i className="sw" style={{ background: 'var(--teal-tint-2)' }} />{detailed ? '2 hops' : 'uses it indirectly'}</span><span><i className="sw" style={{ background: 'var(--moss)' }} />{detailed ? 'tests' : 'automated checks'}</span><span><i className="sw" style={{ background: 'var(--ember)' }} />{detailed ? 'changes with it' : 'often changed with it'}</span></div>
        </div>
        <div>
          <div className="mini-h">{detailed ? `References (${refs.length})` : `Where it is used (${refs.length})`}</div>
          <div className="reflist">{refs.slice(0, 14).map((r, k) => <button key={k} className={`refrow ${detailed ? "" : "plain"}`} onClick={() => onPick(r["symbol"])}>{detailed ? <><span className="mono small">{shortPath(r['path'], 2)}:{r['line']}</span><span className="muted small">{r['kind']}</span><span className="small">{symName(r['symbol'])}</span></> : <><span className="small">{humanize(r['symbol'])}</span><span className="muted small">{shortPath(r['path'], 2)}</span></>}</button>)}
            {!refs.length && <p className="muted small">{detailed ? 'No references in the index.' : 'Nothing else uses it.'}</p>}</div>
        </div>
      </div>
      <div className="mini-h">{detailed ? 'History' : 'Changes over time'}</div>
      {hist && (hist['commits'] as Msg[]).length ? <Timeline commits={hist['commits'] as Msg[]} reverts={hist['reverts'] as Msg[]} /> : <p className="muted small">{hist ? (detailed ? 'No history recorded (not a git repository, or no commits own these lines yet).' : 'No changes recorded yet.') : 'Loading…'}</p>}
    </Card>
  );
}

/** Radial blast-radius graph: the symbol at the centre, dependents on rings by distance, tests and co-change partners outside. */
function ImpactGraph({ center, closure, tests, coChange, onPick }: { center: string; closure: Msg[]; tests: string[]; coChange: Msg[]; onPick: (q: string) => void }) {
  const W = 360, H = 300, cx = W / 2, cy = H / 2;
  const nodes = useMemo(() => {
    const ring = (ids: string[], r: number, cls: string, off = 0) => ids.map((id, i) => {
      const a = off + (2 * Math.PI * i) / Math.max(1, ids.length) - Math.PI / 2;
      return { id, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), cls };
    });
    const d1 = closure.filter((c) => c['distance'] === 1).map((c) => c['symbol'] as string).slice(0, 10);
    const d2 = closure.filter((c) => c['distance'] === 2).map((c) => c['symbol'] as string).slice(0, 12);
    return [...ring(d1, 68, 'd1'), ...ring(d2, 108, 'd2', 0.3), ...ring(tests.slice(0, 8), 132, 'test', 0.6), ...ring(coChange.map((c) => c['symbol'] as string).slice(0, 6), 132, 'co', 2.2)];
  }, [center, closure, tests, coChange]);
  return (
    <svg className="impact" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="impact graph">
      <circle cx={cx} cy={cy} r="68" className="ring" /><circle cx={cx} cy={cy} r="108" className="ring" />
      {nodes.map((n, i) => <line key={`l${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className={`edge ${n.cls}`} style={{ animationDelay: `${i * 25}ms` }} />)}
      {nodes.map((n, i) => (
        <g key={`n${i}`} className={`gnode ${n.cls}`} onClick={() => onPick(n.id)} style={{ animationDelay: `${120 + i * 25}ms` }}>
          <circle cx={n.x} cy={n.y} r={n.cls === 'd1' ? 6 : 4.5} /><title>{n.id}</title>
          <text x={n.x} y={n.y - 9} textAnchor="middle">{shortLabel(n.id, 16)}</text>
        </g>
      ))}
      <circle cx={cx} cy={cy} r="11" className="gcenter" />
      <text x={cx} y={cy + 26} textAnchor="middle" className="gcenter-t">{shortLabel(center, 24)}</text>
      {!nodes.length && <text x={cx} y={cy + 46} textAnchor="middle" className="muted-t">nothing depends on it</text>}
    </svg>
  );
}

function Timeline({ commits, reverts }: { commits: Msg[]; reverts: Msg[] }) {
  const reverted = new Set(reverts.map((r) => r['reverted']));
  return (
    <ol className="timeline">
      {commits.slice(0, 8).map((c) => (
        <li key={c['commit']} className={`tl-${c['kind']} ${reverted.has(c['commit']) ? 'reverted' : ''}`}>
          <span className="tl-dot" />
          <div className="tl-b"><span className="muted small">{String(c['at']).slice(0, 10)} · {c['author']}</span>{c['kind'] !== 'other' && <Chip tone={c['kind'] === 'fix' || c['kind'] === 'incident' ? 'ember' : 'quiet'}>{CHANGE_WORD[c['kind']] ?? c['kind']}</Chip>}
            <div>{c['summary']}{(c['refs'] as string[]).map((r) => <Chip key={r} mono tone="ember">{r}</Chip>)}</div></div>
        </li>
      ))}
    </ol>
  );
}
