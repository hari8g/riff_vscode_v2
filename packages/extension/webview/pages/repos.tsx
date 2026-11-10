import { useEffect, useState } from 'react';
import { ask, type Msg } from '../api.js';
import { Btn, Icon, useToast } from '../kit.js';

/** Choosing the repository the console works on: browse (VS Code), a recent one, or a typed path. */
export function RepoPicker({ onOpened }: { onOpened?: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<Msg | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => void ask({ type: 'repos' }).then(setInfo).catch((e: Error) => toast(e.message, 'err')), []);
  const open = async (req: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await ask({ type: 'openRepo', ...req });
      if (r['cancelled']) return;
      toast(`Opened ${String(r['root']).split(/[\\/]/).pop()}; RIAF is indexing it`);
      onOpened?.();
      if (r['reload']) location.reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const recent = ((info?.['recent'] as string[] | undefined) ?? []).filter((r) => r !== info?.['current']);
  return (
    <div className="repopick stack">
      {info?.['current'] ? <div className="repopick-cur"><div><b>{String(info['current']).split(/[\\/]/).pop()}</b><code className="muted">{String(info['current'])}</code></div></div> : null}
      {info?.['canBrowse'] ? <Btn kind="primary" icon="folder" disabled={busy} onClick={() => void open({ browse: true })}>Choose a folder…</Btn> : null}
      <form className="repopick-path" onSubmit={(e) => { e.preventDefault(); if (path.trim()) void open({ path }); }}>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/repository or ~/code/project" aria-label="Repository path" spellCheck={false} />
        <Btn kind="soft" icon="arrow" disabled={busy || !path.trim()} onClick={() => void open({ path })}>{busy ? 'Opening…' : 'Open'}</Btn>
      </form>
      {recent.length ? <>
        <div className="mini-h">Recent</div>
        <div className="repopick-list">{recent.map((r) => (
          <button key={r} disabled={busy} onClick={() => void open({ path: r })}><span><b>{r.split(/[\\/]/).pop()}</b><small className="muted">{r}</small></span></button>
        ))}</div>
      </> : null}
      <p className="muted small">RIAF starts a fresh index process for the folder you pick. Nothing is uploaded; the index lives in the folder’s <code>.riaf/</code>.</p>
    </div>
  );
}
