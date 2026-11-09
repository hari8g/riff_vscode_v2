import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ask, brand, repoName, save, saved } from './api.js';
import { DetailProvider, Icon, Palette, symName, ToastHost, useTheme, type PaletteItem } from './kit.js';
import { Adapters } from './pages/adapters.js';
import { Ask } from './pages/ask.js';
import { Governance } from './pages/governance.js';
import { Overview } from './pages/overview.js';
import { PoliciesPage } from './pages/policies.js';
import { Repository } from './pages/repository.js';
import { Savings } from './pages/savings.js';
import { Studio } from './pages/studio.js';

/** The RIAF console: a rail, a top bar with search, and its pages. Admin pages show only in the detailed view. */

const PAGES = [
  { id: 'overview', label: 'Home', key: 'o', admin: false },
  { id: 'ask', label: 'Ask a question', key: 'q', admin: false },
  { id: 'studio', label: 'Prepare a task', key: 's', admin: false },
  { id: 'repository', label: 'Explore the code', key: 'r', admin: false },
  { id: 'savings', label: 'Savings', key: 'v', admin: false },
  { id: 'governance', label: 'AI activity', key: 'g', admin: true },
  { id: 'policies', label: 'Rules', key: 'p', admin: true },
  { id: 'adapters', label: 'Setup', key: 'a', admin: true },
] as const;
type Page = (typeof PAGES)[number]['id'];

function App() {
  const [page, setPage] = useState<Page>(() => { const p = saved<Page>('page', 'overview'); return PAGES.find((x) => x.id === p)?.admin && !saved('detailed', false) ? 'overview' : p; });
  const [focus, setFocus] = useState<string | undefined>();
  const [pal, setPal] = useState(false);
  const [theme, setTheme] = useTheme();
  const [detailed, setDetailedState] = useState<boolean>(() => saved('detailed', false));
  const setDetailed = (v: boolean) => { setDetailedState(v); save('detailed', v); if (!v && PAGES.find((p) => p.id === page)?.admin) go('overview'); };
  const pages = PAGES.filter((p) => detailed || !p.admin);
  const [live, setLive] = useState<{ ok: boolean; files?: number; pending?: number }>({ ok: false });
  const go = (p: string, arg?: string) => {
    setPage(p as Page);
    save('page', p);
    if (p === 'repository') setFocus(arg);
  };
  useEffect(() => {
    const poll = () => void ask({ type: 'load', page: 'overview' }).then((r) => setLive({ ok: true, files: r['status'].blobs, pending: (r['status'].stages as { pending: number }[]).reduce((a, s) => a + s.pending, 0) })).catch(() => setLive({ ok: false }));
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let chord = 0;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((v) => !v); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); go('studio'); setTimeout(() => (document.querySelector('.taskline textarea') as HTMLTextAreaElement | null)?.focus(), 40); return; }
      if (chord && Date.now() - chord < 1200) {
        const hit = PAGES.find((p) => p.key === e.key.toLowerCase() && (!p.admin || saved('detailed', false)));
        chord = 0;
        if (hit) { e.preventDefault(); go(hit.id); }
        return;
      }
      if (e.key === 'g') chord = Date.now();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const items: PaletteItem[] = useMemo(() => [
    ...pages.map((p) => ({ id: `page:${p.id}`, label: `Go to ${p.label}`, hint: `g ${p.key}`, icon: p.id, run: () => go(p.id) })),
    { id: 'detail', label: detailed ? 'Switch to the simple view' : 'Show technical details', hint: 'view', icon: 'code', run: () => setDetailed(!detailed) },
    { id: 'theme', label: `Theme: ${theme} (switch)`, hint: 'setting', icon: theme === 'dark' ? 'moon' : 'sun', run: () => setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto') },
    { id: 'reindex', label: 'Refresh what RIAF knows about the code', hint: 'action', icon: 'refresh', run: () => void ask({ type: 'reindex' }) },
  ], [theme, detailed]);
  const search = async (q: string): Promise<PaletteItem[]> => {
    const r = await ask({ type: 'jump', query: q });
    const d = r['result']?.definition;
    if (!d) return [];
    return [{ id: `sym:${d.symbol}`, label: symName(d.symbol), hint: `${d.kind} · ${d.path}:${d.startLine}`, icon: 'target', run: () => go('repository', d.symbol) }];
  };
  const label = PAGES.find((p) => p.id === page)?.label ?? 'Home';
  const nextTheme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  return (
    <DetailProvider value={{ detailed, setDetailed }}>
    <div className="shell">
      <div className="supergraphic" aria-hidden="true" />
      <nav className="rail" aria-label="Pages">
        <div className="brand">
          {brand.mps ? <span className="mps-plate"><img src={brand.mps} alt="Bosch MPS — Mobility Platform and Services" /></span> : null}
          <div className="brand-t"><b>RIAF Console</b><small>Bosch MPS · Know your code</small></div>
        </div>
        <div className="product">
          {brand.mlff && <img className="mlff-mark" src={brand.mlff} alt="MLFF" />}
          <div><b>MLFF</b><small>Multi-Lane Free Flow tolling</small></div>
        </div>
        <div className="repo-pill" title={repoName}><Icon name="folder" size={14} /><span>{repoName}</span></div>
        <div className="navs">
          {pages.filter((p) => !p.admin).map((p) => (
            <button key={p.id} className={`nav ${page === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
              <Icon name={p.id} /><span>{p.label}</span>{detailed ? <kbd>{p.key}</kbd> : null}
            </button>
          ))}
          {detailed ? <><div className="nav-sep">For engineers</div>{pages.filter((p) => p.admin).map((p) => (
            <button key={p.id} className={`nav ${page === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
              <Icon name={p.id} /><span>{p.label}</span><kbd>{p.key}</kbd>
            </button>
          ))}</> : null}
        </div>
        <div className="grow" />
        <div className="rail-foot">
          <div className={`daemon ${live.ok ? 'ok' : 'down'}`}><span className="live-dot" />{live.ok ? (live.pending ? `Updating · ${live.pending} files left` : `Ready · ${live.files?.toLocaleString()} files`) : 'Connecting…'}</div>
          {detailed ? <div className="hint"><kbd>/</kbd> new task · <kbd>g</kbd> + letter</div> : null}
          <div className="internal">Bosch internal · runs locally, nothing leaves this machine</div>
        </div>
      </nav>
      <div className="content">
        <header className="topbar">
          <div className="crumbs"><span className="muted">{repoName}</span><span className="sep">/</span><b>{label}</b></div>
          <span className="grow" />
          <button className="searchbtn" onClick={() => setPal(true)}><Icon name="search" /><span>Search</span><kbd>⌘K</kbd></button>
          <div className="viewswitch" role="radiogroup" aria-label="How much detail to show">
            <button role="radio" aria-checked={!detailed} className={!detailed ? 'on' : ''} onClick={() => setDetailed(false)} title="Plain words, only what you need">Simple</button>
            <button role="radio" aria-checked={detailed} className={detailed ? 'on' : ''} onClick={() => setDetailed(true)} title="Show scores, sizes and engineering pages">Detailed</button>
          </div>
          <button className="iconbtn" onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} — click for ${nextTheme}`} aria-label="Switch theme"><Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto'} /></button>
        </header>
        <main className="main" key={page}>
          {page === 'overview' && <Overview go={go} />}
          {page === 'ask' && <Ask go={go} />}
          {page === 'studio' && <Studio go={go} />}
          {page === 'repository' && <Repository {...(focus ? { focus } : {})} />}
          {page === 'policies' && <PoliciesPage />}
          {page === 'governance' && <Governance />}
          {page === 'savings' && <Savings />}
          {page === 'adapters' && <Adapters />}
        </main>
      </div>
      <Palette open={pal} onClose={() => setPal(false)} items={items} search={search} />
    </div>
    </DetailProvider>
  );
}

createRoot(document.getElementById('root')!).render(<ToastHost><App /></ToastHost>);
