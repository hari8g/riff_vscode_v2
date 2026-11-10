import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ask, brand, repoName, repoRoot, save, saved } from './api.js';
import { DetailProvider, Drawer, Icon, Palette, symName, ToastHost, useTheme, type PaletteItem } from './kit.js';
import { Adapters } from './pages/adapters.js';
import { Ask } from './pages/ask.js';
import { Governance } from './pages/governance.js';
import { Health } from './pages/health.js';
import { PromptPage } from './pages/prompt.js';
import { Live } from './pages/live.js';
import { Overview } from './pages/overview.js';
import { PoliciesPage } from './pages/policies.js';
import { RepoPicker } from './pages/repos.js';
import { Repository } from './pages/repository.js';
import { Savings } from './pages/savings.js';
import { Studio } from './pages/studio.js';

/** The RIAF console: a rail, a top bar with search, and its pages. One developer view; governance pages are grouped last. */

const PAGES = [
  { id: 'overview', label: 'Home', key: 'h', admin: false },
  { id: 'studio', label: 'Prepare a task', key: 't', admin: false },
  { id: 'repository', label: 'Explore the code', key: 'e', admin: false },
  { id: 'ask', label: 'Ask a question', key: 'q', admin: false },
  { id: 'prompt', label: 'AI prompt', key: 'p', admin: false },
  { id: 'health', label: 'Code health', key: 'c', admin: false },
  { id: 'live', label: 'Claude Code live', key: 'l', admin: false },
  { id: 'savings', label: 'Savings', key: 's', admin: false },
  { id: 'governance', label: 'AI activity', key: 'g', admin: true },
  { id: 'policies', label: 'Rules', key: 'r', admin: true },
  { id: 'adapters', label: 'Setup', key: 'u', admin: true },
] as const;
type Page = (typeof PAGES)[number]['id'];

function App() {
  const [page, setPage] = useState<Page>(() => { const p = saved<Page>('page', 'overview'); return PAGES.some((x) => x.id === p) ? p : 'overview'; });
  const [focus, setFocus] = useState<string | undefined>();
  const [pal, setPal] = useState(false);
  const [repos, setRepos] = useState(false);
  const [theme, setTheme] = useTheme();
  const pages = PAGES;
  const [live, setLive] = useState<{ ok: boolean; files?: number; pending?: number }>({ ok: false });
  const go = (p: string, arg?: string) => {
    setPage(p as Page);
    save('page', p);
    if (p === 'repository') setFocus(arg);
  };
  useEffect(() => {
    if (!repoRoot) return;
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
        const hit = PAGES.find((p) => p.key === e.key.toLowerCase());
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
    { id: 'theme', label: `Theme: ${theme} (switch)`, hint: 'setting', icon: theme === 'dark' ? 'moon' : 'sun', run: () => setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto') },
    { id: 'repo', label: 'Open another repository…', hint: 'action', icon: 'folder', run: () => setRepos(true) },
    { id: 'reindex', label: 'Refresh what RIAF knows about the code', hint: 'action', icon: 'refresh', run: () => void ask({ type: 'reindex' }) },
  ], [theme]);
  const search = async (q: string): Promise<PaletteItem[]> => {
    const r = await ask({ type: 'jump', query: q });
    const d = r['result']?.definition;
    if (!d) return [];
    return [{ id: `sym:${d.symbol}`, label: symName(d.symbol), hint: `${d.kind} · ${d.path}:${d.startLine}`, icon: 'target', run: () => go('repository', d.symbol) }];
  };
  const label = PAGES.find((p) => p.id === page)?.label ?? 'Home';
  const nextTheme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  return (
    <DetailProvider value={{ detailed: true, setDetailed: () => undefined }}>
    <div className="shell">
      <div className="supergraphic" aria-hidden="true" />
      <nav className="rail" aria-label="Pages">
        <div className="brand">
          {brand.mps ? <span className="mps-plate"><img src={brand.mps} alt="Bosch MPS — Mobility Platform and Services" /></span> : null}
          <div className="brand-t"><b>RIAF</b><small>Repository intelligence</small></div>
        </div>
        <button className="repo-pill" title={repoRoot ? `${repoRoot} (click to open another repository)` : 'Open a repository'} onClick={() => setRepos(true)}><Icon name="folder" size={14} /><span>{repoRoot ? repoName : 'Open a repository…'}</span><Icon name="chevron" size={12} /></button>
        <div className="navs">
          {pages.filter((p) => !p.admin).map((p) => (
            <button key={p.id} className={`nav ${page === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
              <Icon name={p.id} /><span>{p.label}</span>
            </button>
          ))}
          <div className="nav-sep">Governance</div>
          {pages.filter((p) => p.admin).map((p) => (
            <button key={p.id} className={`nav ${page === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
              <Icon name={p.id} /><span>{p.label}</span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="rail-foot">
          <div className={`daemon ${live.ok ? 'ok' : 'down'}`}><span className="live-dot" />{!repoRoot ? 'No repository open' : live.ok ? (live.pending ? `Updating · ${live.pending} files left` : `Ready · ${live.files?.toLocaleString()} files`) : 'Starting RIAF…'}</div>
          <div className="internal">Runs locally · nothing leaves this machine</div>
        </div>
      </nav>
      <div className="content">
        <header className="topbar">
          <div className="crumbs"><span className="muted">{repoName}</span><span className="sep">/</span><b>{label}</b></div>
          <span className="grow" />
          <button className="searchbtn" onClick={() => setPal(true)}><Icon name="search" /><span>Search</span><kbd>⌘K</kbd></button>
          <button className="iconbtn" onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} — click for ${nextTheme}`} aria-label="Switch theme"><Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto'} /></button>
        </header>
        <main className="main" key={page}>
          {!repoRoot ? <NoRepo /> : <>
          {page === 'live' && <Live />}
          {page === 'overview' && <Overview go={go} />}
          {page === 'ask' && <Ask go={go} />}
          {page === 'prompt' && <PromptPage go={go} />}
          {page === 'health' && <Health go={go} />}
          {page === 'studio' && <Studio go={go} />}
          {page === 'repository' && <Repository {...(focus ? { focus } : {})} />}
          {page === 'policies' && <PoliciesPage />}
          {page === 'governance' && <Governance />}
          {page === 'savings' && <Savings />}
          {page === 'adapters' && <Adapters />}
          </>}
        </main>
      </div>
      <Drawer open={repos} onClose={() => setRepos(false)} title="Repository"><RepoPicker onOpened={() => setRepos(false)} /></Drawer>
      <Palette open={pal} onClose={() => setPal(false)} items={items} search={search} />
    </div>
    </DetailProvider>
  );
}

/** Shown until a repository is chosen (VS Code opened without a folder). */
function NoRepo() {
  return (
    <div className="stack-lg norepo">
      <div className="page-h"><div><h1>Open a repository</h1><p className="lead">Pick the code RIAF should learn. It indexes the folder on this machine and keeps up with every change.</p></div></div>
      <section className="card"><RepoPicker /></section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ToastHost><App /></ToastHost>);
