import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/* ───────────── formatting ───────────── */
export const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n)));
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const symName = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || id.slice(0, id.indexOf('#')).split('/').pop() || id;
/** A short, readable label for any symbol id: file ids use the file name, tests their innermost title. */
export const shortLabel = (id: string, max = 18) => {
  const q = id.slice(id.indexOf('#') + 1, id.lastIndexOf('@'));
  const base = q ? (q.includes(' > ') ? q.slice(q.lastIndexOf(' > ') + 3) : q.slice(q.lastIndexOf('.') + 1)) : (id.slice(0, id.indexOf('#')).split('/').pop() ?? id).replace(/\.[^.]+$/, '');
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
};
export const symKind = (id: string) => id.slice(id.lastIndexOf('@') + 1);
export const symPath = (id: string) => id.slice(0, id.indexOf('#'));
export const shortPath = (p: string, keep = 2) => {
  const parts = p.split('/');
  return parts.length > keep + 1 ? `…/${parts.slice(-keep).join('/')}` : p;
};

/* ───────────── intents: one hue each, used everywhere ───────────── */
export const INTENTS = ['bugfix', 'feature', 'refactor', 'review', 'merge', 'onboarding', 'unknown'] as const;
export const INTENT_LABEL: Record<string, string> = { bugfix: 'Bug fix', feature: 'Feature', refactor: 'Refactor', review: 'Review', merge: 'Merge', onboarding: 'Onboarding', unknown: 'Unclear' };
export const intentVar = (i: string) => `var(--i-${INTENTS.includes(i as never) ? i : 'unknown'})`;
export const BRANCH_TEXT: Record<string, string> = {
  single: 'One clear reading: a single policy',
  blended: 'More than one reading: the policies are blended',
  probe: 'Uncertain: the index was probed for evidence',
  clarify: 'Too uncertain: one question first',
  generic: 'Too uncertain to specialise: a generic pack',
};

/* ───────────── icons (24px stroke) ───────────── */
const P: Record<string, ReactNode> = {
  ask: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" /><path d="M9.5 8.2a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.3" /><path d="M12 14h.01" /></>,
  savings: <><path d="M4 19h16" /><path d="M6 15l4-4 3 3 5-6" /><path d="M15 8h3v3" /></>,
  overview: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="11" width="8" height="10" rx="2" /><rect x="3" y="14" width="8" height="7" rx="2" /></>,
  studio: <><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  repository: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" /></>,
  policies: <><path d="M4 7h10M4 17h6" /><circle cx="17" cy="7" r="3" /><circle cx="13" cy="17" r="3" /><path d="M20 17h-4" /></>,
  governance: <><path d="M12 3l8 3.5v5.2c0 4.6-3.3 7.9-8 9.3-4.7-1.4-8-4.7-8-9.3V6.5z" /><path d="M8.8 12.2l2.2 2.2 4.4-4.6" /></>,
  adapters: <><path d="M9 7V3M15 7V3M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0zM12 16v5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  auto: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></>,
  bolt: <path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></>,
  send: <><path d="M4 12l16-8-6 16-2.5-6.5z" /><path d="M11.5 13.5L20 4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5" /><path d="M5 3v4h4M19 21v-4h-4" /></>,
  code: <><path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" /></>,
  commit: <><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>,
  rule: <><path d="M5 5h14v14H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  file: <><path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z" /><path d="M14 3.5v5h5" /></>,
  folder: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  sparkle: <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4.5l3 2" /></>,
  graph: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="18" r="2.5" /><path d="M8.3 7.2l7.4.6M7 8.4l1.4 7.2M16.4 10l-5.6 6.4" /></>,
};
export const Icon = ({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) => (
  <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{P[name] ?? P['sparkle']}</svg>
);

/* ───────────── theme: follows VS Code unless overridden ───────────── */
export type Theme = 'auto' | 'light' | 'dark';
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('riaf.theme') as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    const vsDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const vsLight = document.body.classList.contains('vscode-light');
    const resolved = t !== 'auto' ? t : vsDark ? 'dark' : vsLight ? 'light' : undefined;
    if (resolved) el.setAttribute('data-theme', resolved);
    else el.removeAttribute('data-theme');
    try {
      localStorage.setItem('riaf.theme', t);
    } catch {
      /* storage unavailable */
    }
  }, [t]);
  return [t, setT];
}

/* ───────────── toasts ───────────── */
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}><Icon name={t.kind === 'err' ? 'alert' : 'check'} size={15} /><span>{t.text}</span></div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────── primitives ───────────── */
export const Btn = ({ children, onClick, kind, sm, disabled, title, icon }: { children?: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'soft'; sm?: boolean; disabled?: boolean; title?: string; icon?: string }) => (
  <button type="button" className={`btn ${kind ?? ''} ${sm ? 'sm' : ''}`} onClick={onClick} disabled={disabled} title={title}>
    {icon && <Icon name={icon} size={sm ? 14 : 15} />}{children}
  </button>
);
export const Chip = ({ children, tone, mono, onClick, title, dot }: { children: ReactNode; tone?: string; mono?: boolean; onClick?: () => void; title?: string; dot?: string }) => (
  <span className={`chip ${tone ?? ''} ${mono ? 'mono' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick} title={title} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
    {dot && <i className="chip-dot" style={{ background: dot }} />}{children}
  </span>
);
export const Card = ({ children, title, actions, className, sub }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; className?: string; sub?: ReactNode }) => (
  <section className={`card ${className ?? ''}`}>
    {(title || actions) && <header className="card-h"><div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div><div className="row">{actions}</div></header>}
    {children}
  </section>
);
export const Empty = ({ title, children, icon }: { title: string; children?: ReactNode; icon?: string }) => (
  <div className="empty">{icon && <span className="empty-ic"><Icon name={icon} size={22} /></span>}<b>{title}</b>{children && <div>{children}</div>}</div>
);
export const Skeleton = ({ h = 120 }: { h?: number }) => <div className="skeleton" style={{ height: h }} />;
export const Stat = ({ v, l, accent }: { v: ReactNode; l: string; accent?: string }) => (
  <div className="stat"><div className="stat-v" style={accent ? { color: accent } : undefined}>{v}</div><div className="stat-l">{l}</div></div>
);

/** Animated count-up for headline numbers. */
export function Count({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v.toLocaleString()}</>;
}

/* ───────────── entropy gauge: a half dial with the router's three zones ───────────── */
export function EntropyGauge({ H, single = 0.35, blend = 0.7, size = 168 }: { H: number; single?: number; blend?: number; size?: number }) {
  const r = 64, cx = 84, cy = 78;
  const pt = (v: number, rr = r) => {
    const a = Math.PI * (1 - v);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const v = Math.max(0, Math.min(1, H));
  const [nx, ny] = pt(v, r - 14);
  const zone = v < single ? 'single' : v < blend ? 'blend' : 'probe';
  return (
    <svg className="gauge" viewBox="0 0 168 100" width={size} height={size * 100 / 168} role="img" aria-label={`entropy ${v.toFixed(2)}`}>
      <path d={arc(0, single)} className="g-zone g-single" />
      <path d={arc(single, blend)} className="g-zone g-blend" />
      <path d={arc(blend, 1)} className="g-zone g-probe" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} className="g-needle" style={{ transition: 'all .45s cubic-bezier(.2,.8,.2,1)' }} />
      <circle cx={cx} cy={cy} r="5" className="g-hub" />
      <text x={cx} y={cy + 19} textAnchor="middle" className="g-val">H {v.toFixed(2)}</text>
      <text x="14" y="96" className="g-tick">clear</text>
      <text x="154" y="96" textAnchor="end" className="g-tick">{zone === 'probe' ? 'uncertain' : 'mixed'}</text>
    </svg>
  );
}

/* ───────────── intent distribution: one stacked bar plus ranked rows ───────────── */
export function IntentBar({ w, height = 12 }: { w: Record<string, number>; height?: number }) {
  const entries = INTENTS.map((i) => [i, w[i] ?? 0] as const).filter(([, v]) => v > 0.004);
  return (
    <div className="ibar" style={{ height }}>
      {entries.map(([i, v]) => <i key={i} title={`${INTENT_LABEL[i]} ${pct(v)}`} style={{ width: `${v * 100}%`, background: intentVar(i) }} />)}
    </div>
  );
}
export function IntentRows({ w, top = 4 }: { w: Record<string, number>; top?: number }) {
  const rows = INTENTS.map((i) => [i, w[i] ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, top);
  return (
    <div className="irows">
      {rows.map(([i, v]) => (
        <div key={i} className="irow">
          <span className="irow-l"><i className="chip-dot" style={{ background: intentVar(i) }} />{INTENT_LABEL[i]}</span>
          <span className="irow-t"><span style={{ width: `${v * 100}%`, background: intentVar(i) }} /></span>
          <span className="irow-v">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────── donut ───────────── */
export function Donut({ parts, size = 132, label, sub }: { parts: { label: string; value: number; color: string }[]; size?: number; label?: ReactNode; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 46, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className="donut" role="img">
      <circle cx="60" cy="60" r={r} className="donut-track" />
      {parts.map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)"><title>{`${p.label}: ${p.value}`}</title></circle>;
        acc += len;
        return el;
      })}
      <text x="60" y="60" textAnchor="middle" className="donut-v">{label}</text>
      {sub && <text x="60" y="76" textAnchor="middle" className="donut-s">{sub}</text>}
    </svg>
  );
}

/* ───────────── radar (priors) ───────────── */
export function Radar({ values, size = 220 }: { values: Record<string, number>; size?: number }) {
  const keys = INTENTS as readonly string[];
  const cx = 110, cy = 110, R = 78;
  const max = Math.max(0.0001, ...keys.map((k) => values[k] ?? 0));
  const pt = (i: number, k: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / keys.length;
    return [cx + R * k * Math.cos(a), cy + R * k * Math.sin(a)] as const;
  };
  const poly = keys.map((k, i) => pt(i, (values[k] ?? 0) / max).join(',')).join(' ');
  return (
    <svg viewBox="-34 -6 288 232" width={size * 1.3} height={size * 1.05} className="radar" role="img">
      {[0.25, 0.5, 0.75, 1].map((g) => <polygon key={g} points={keys.map((_, i) => pt(i, g).join(',')).join(' ')} className="radar-grid" />)}
      {keys.map((k, i) => {
        const [x, y] = pt(i, 1.18);
        const [lx, ly] = pt(i, 1);
        return <g key={k}><line x1={cx} y1={cy} x2={lx} y2={ly} className="radar-grid" /><text x={x} y={y + 3} textAnchor="middle" className="radar-l">{INTENT_LABEL[k]}</text></g>;
      })}
      <polygon points={poly} className="radar-area" />
      {keys.map((k, i) => {
        const [x, y] = pt(i, (values[k] ?? 0) / max);
        return <circle key={k} cx={x} cy={y} r="3.5" style={{ fill: intentVar(k) }}><title>{`${INTENT_LABEL[k]} ${pct(values[k] ?? 0)}`}</title></circle>;
      })}
    </svg>
  );
}

/* ───────────── drawer ───────────── */
export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-label={typeof title === 'string' ? title : 'details'}>
        <header className="drawer-h"><h2>{title}</h2><Btn kind="ghost" sm onClick={onClose}>Close</Btn></header>
        {children}
      </aside>
    </>
  );
}

/* ───────────── command palette (⌘K) ───────────── */
export type PaletteItem = { id: string; label: string; hint?: string; icon?: string; run: () => void };
export function Palette({ open, onClose, items, search }: { open: boolean; onClose: () => void; items: PaletteItem[]; search?: (q: string) => Promise<PaletteItem[]> }) {
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<PaletteItem[]>([]);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setExtra([]);
      setIdx(0);
      setTimeout(() => ref.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => {
    if (!search || q.trim().length < 2) {
      setExtra([]);
      return;
    }
    const t = setTimeout(() => void search(q).then(setExtra).catch(() => setExtra([])), 180);
    return () => clearTimeout(t);
  }, [q, search]);
  const list = useMemo(() => [...extra, ...items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))].slice(0, 12), [items, extra, q]);
  if (!open) return null;
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-in"><Icon name="search" size={18} />
          <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Jump to a page, a symbol (Class.method) or a file…" aria-label="Command palette"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && list[idx]) { list[idx].run(); onClose(); }
              if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div className="palette-res">
          {list.map((it, i) => (
            <div key={it.id} className={i === idx ? 'on' : ''} onMouseEnter={() => setIdx(i)} onClick={() => { it.run(); onClose(); }}>
              <span className="row"><Icon name={it.icon ?? 'arrow'} size={15} />{it.label}</span><span className="muted small">{it.hint}</span>
            </div>
          ))}
          {!list.length && <div className="muted">Nothing matches.</div>}
        </div>
        <footer className="palette-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></footer>
      </div>
    </div>
  );
}

/* ───────────── code block with line numbers ───────────── */
export function Code({ text, start = 1, max = 400 }: { text: string; start?: number; max?: number }) {
  const lines = text.split('\n').slice(0, max);
  return (
    <pre className="code">{lines.map((l, i) => <div key={i} className="code-l"><span className="ln">{start + i}</span><span>{l || ' '}</span></div>)}</pre>
  );
}

/** Copies text, with a fallback for webviews without clipboard permissions. */
export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
