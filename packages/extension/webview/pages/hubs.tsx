import { useEffect, useState, type ReactNode } from 'react';
import { repoName, repoRoot, save, saved } from '../api.js';
import { Btn, Icon } from '../kit.js';
import { Adapters } from './adapters.js';
import { Ask } from './ask.js';
import { Governance } from './governance.js';
import { Health } from './health.js';
import { PoliciesPage } from './policies.js';
import { Repository } from './repository.js';

/** A page made of a few related views behind one tab bar; the views keep their own content but not their headings. */
function Hub<T extends string>({ id, title, lead, tabs, initial, actions, render }: {
  id: string; title: string; lead: ReactNode; tabs: { id: T; label: string; icon: string }[]; initial?: T; actions?: ReactNode; render: (t: T) => ReactNode;
}) {
  const [tab, setTab] = useState<T>(() => initial ?? saved<T>(`${id}.tab`, tabs[0]!.id));
  useEffect(() => { if (initial) setTab(initial); }, [initial]);
  useEffect(() => save(`${id}.tab`, tab), [tab]);
  return (
    <div className="stack-lg hub">
      <div className="page-h">
        <div><h1>{title}</h1><p className="lead">{lead}</p></div>
        <div className="row">{actions}</div>
      </div>
      <nav className="tabs pill" aria-label={`${title} views`}>
        {tabs.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} />{t.label}</button>)}
      </nav>
      <div className="hub-body" key={tab}>{render(tab)}</div>
    </div>
  );
}

/** Repository: browse the code, ask about it in plain words, and see its health. */
export function RepositoryHub({ focus, go, onOpenRepo }: { focus?: string; go: (p: string, a?: string) => void; onOpenRepo: () => void }) {
  return (
    <Hub id="repo" title={repoName} lead={<><code className="path">{repoRoot}</code> · read and indexed on this machine</>}
      tabs={[{ id: 'browse', label: 'Browse', icon: 'repository' }, { id: 'ask', label: 'Ask', icon: 'ask' }, { id: 'health', label: 'Health', icon: 'health' }] as const}
      {...(focus ? { initial: 'browse' as const } : {})}
      actions={<Btn sm kind="soft" icon="folder" onClick={onOpenRepo}>Open another repository</Btn>}
      render={(t) => t === 'browse' ? <Repository {...(focus ? { focus } : {})} /> : t === 'ask' ? <Ask go={go} /> : <Health go={go} />} />
  );
}

/** Governance: what AI sessions did and were stopped from doing, the rules RIAF follows, and its setup. */
export function GovernanceHub() {
  return (
    <Hub id="gov" title="Governance" lead="How AI sessions in this repository are checked, the rules RIAF follows when it chooses context, and how it is set up."
      tabs={[{ id: 'activity', label: 'AI activity', icon: 'governance' }, { id: 'rules', label: 'Rules', icon: 'policies' }, { id: 'setup', label: 'Setup', icon: 'adapters' }] as const}
      render={(t) => t === 'activity' ? <Governance /> : t === 'rules' ? <PoliciesPage /> : <Adapters />} />
  );
}
