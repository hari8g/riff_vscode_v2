import { useEffect, useState } from 'react';
import { ask, type Msg } from '../api.js';
import { Card, Chip, Empty, Icon, Skeleton } from '../kit.js';

export function Adapters() {
  const [d, setD] = useState<Msg | null>(null);
  useEffect(() => { void ask({ type: 'load', page: 'adapters' }).then(setD); }, []);
  if (!d) return <Skeleton h={300} />;
  const info = d['daemon'];
  const models = Object.entries((d['models'] ?? {}) as Record<string, Msg>);
  return (
    <div className="stack-lg">
      <div className="page-h"><div><h1>Setup</h1><p className="lead">RIAF runs as one local service on this machine. VS Code, Claude Code and the command line all connect to it. AI models are optional; RIAF works without one.</p></div></div>
      <div className="grid2">
        <Card title={<span className="row"><span className="live-dot" />Daemon</span>} sub={info['root']}>
          <div className="kv"><span>version</span><b>{info['version']}</b><span>protocol</span><b>{info['protocol']}</b><span>process</span><b>pid {info['pid']}</b><span>started</span><b>{new Date(info['startedAt']).toLocaleString()}</b></div>
          <div className="mini-h">RPC methods ({(info['methods'] as string[]).length})</div>
          <div className="row wrap">{(info['methods'] as string[]).map((m) => <Chip key={m} mono tone="quiet">{m}</Chip>)}</div>
        </Card>
        <Card title="Model adapters" sub="riaf.models · keys are read from environment variables, never stored">
          {models.length ? <div className="adapters">{models.map(([job, c]) => (
            <div key={job} className="adapter"><span className="adapter-ic"><Icon name="adapters" /></span><div><b>{job}</b><div className="muted small">{c['provider']} · <span className="mono">{c['model']}</span>{c['baseUrl'] ? ` · ${c['baseUrl']}` : ''}</div></div>{c['apiKeyEnv'] && <Chip mono>${c['apiKeyEnv']}</Chip>}</div>
          ))}</div> : <Empty icon="adapters" title="No models configured">Optional. Add <code>summarize</code> (commit summaries) or <code>classify</code> (an arbiter for uncertain requests) under <code>riaf.models</code>.</Empty>}
        </Card>
      </div>
      <Card title="Surfaces" sub="Where the same pack goes">
        <div className="surfaces">
          <div><Icon name="studio" size={20} /><b>Copilot</b><span className="muted small">#riafPack, #riafJump, #riafImpact, #riafHistory, #riafWiki · @riaf</span></div>
          <div><Icon name="send" size={20} /><b>Claude Code</b><span className="muted small">MCP server riaf_* · governance hooks · /riaf-pack</span></div>
          <div><Icon name="code" size={20} /><b>CLI</b><span className="muted small">riaf pack · jump · impact · history · eval</span></div>
          <div><Icon name="sparkle" size={20} /><b>Any model</b><span className="muted small">system-prompt fragment render</span></div>
        </div>
      </Card>
    </div>
  );
}
