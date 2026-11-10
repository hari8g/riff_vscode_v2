import { useEffect, useState } from 'react';
import { ask, type Msg } from '../api.js';
import { Card, Chip, Count, Detail, Empty, fmtK, Icon, pct, shortPath, Skeleton, Stat, useDetailed } from '../kit.js';
import { humanize, kindWord } from '../../src/ask.js';

/**
 * Code health from the three knowledge layers: the structural graph (L1: load-bearing parts, tangled
 * code, untested hubs, import cycles, unused definitions), the change history (L2: hotspots, owners,
 * bus factor) and the domain glossary (L3: the business words the code is built from).
 */

interface Metric { symbol: string; path: string; kind: string; fanIn: number; fanOut: number; tests: number }
interface Owner { author: string; commits: number; share: number; lastAt: string }
interface Hot { path: string; commits: number; churn: number; heat: number; fixShare: number; authors: number; busFactor: number; owners: Owner[]; lastAt: string }
interface Term { term: string; symbols: number; files: number; areas: string[]; defines: string[]; meaning?: string; score: number }

const TONES = ['var(--teal)', 'var(--i-refactor)', 'var(--moss)', 'var(--i-merge)', 'var(--i-review)', 'var(--slate)'];
const tone = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]!;
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function Health({ go }: { go: (page: string, arg?: string) => void }) {
  const { detailed } = useDetailed();
  const [d, setD] = useState<Msg | null>(null);
  useEffect(() => void ask({ type: 'load', page: 'health' }).then(setD), []);
  if (!d) return <div className="stack-lg"><Skeleton h={120} /><Skeleton h={300} /></div>;
  const ins = d['insights'];
  const hubs = ins.hubs as Metric[], untested = ins.untestedHubs as Metric[], tangled = ins.tangled as Metric[], unused = ins.unreferenced as Metric[];
  const cycles = ins.cycles as string[][];
  const hot = d['hotspots'] as Hot[], areas = d['areas'] as Hot[], glossary = d['glossary'] as Term[];
  const tot = ins.totals;
  const name = (m: Metric) => (detailed ? m.symbol.slice(m.symbol.indexOf('#') + 1, m.symbol.lastIndexOf('@')) : humanize(m.symbol));
  const maxIn = Math.max(1, ...hubs.map((h) => h.fanIn));
  const maxHeat = Math.max(1, ...hot.map((h) => h.heat));
  const solo = hot.filter((h) => h.busFactor === 1 && h.commits >= 3).length;

  return (
    <div className="stack-lg">
      <div className="page-h"><div>
        <h1>Code health</h1>
        <p className="lead">Where the code is load-bearing, where it lacks tests, where it changes most, and who knows it. RIAF also uses these facts to warn the AI assistant in every prompt.</p>
      </div></div>

      <section className="stats4 cardish">
        <Stat v={<Count to={tot.definitions} />} l={detailed ? 'definitions' : 'parts of the code'} />
        <Stat v={pct(tot.definitions ? tot.testedDefinitions / tot.definitions : 0)} l={detailed ? 'reached directly by a test' : 'checked directly by a test'} accent="var(--moss)" />
        <Stat v={<Count to={untested.length} />} l="important parts with no test" accent="var(--ember)" />
        <Stat v={<Count to={solo} />} l="busy files only one person knows" accent="var(--i-merge)" />
      </section>

      <div className="grid2">
        <Card title="Load-bearing parts" sub="Most other parts depend on these. Changes here ripple furthest.">
          {hubs.length ? <div className="hrows">{hubs.map((h) => (
            <button key={h.symbol} className="hrow" onClick={() => go('repository', h.symbol)}>
              <span className="hrow-l"><b>{name(h)}</b><span className="muted small">{kindWord(h.kind)} · {shortPath(h.path, 2)}</span></span>
              <span className="hbar"><span style={{ width: pct(h.fanIn / maxIn) }} /></span>
              <span className="num">{h.fanIn}</span>
              {h.tests ? <span className="okb" title={`${h.tests} tests reach it`}><Icon name="check" size={12} /></span> : <span className="nob" title="No test reaches it directly">no test</span>}
            </button>))}</div> : <Empty title="Nothing depends on anything yet">Index a repository first.</Empty>}
        </Card>
        <Card title="Needs a test" sub="Important parts (used by two or more others) that no automated check reaches directly.">
          {untested.length ? <div className="hrows">{untested.map((h) => (
            <button key={h.symbol} className="hrow" onClick={() => go('repository', h.symbol)}>
              <span className="hrow-l"><b>{name(h)}</b><span className="muted small">used by {h.fanIn} · {shortPath(h.path, 2)}</span></span>
              <span className="nob">add a test</span>
            </button>))}</div> : <Empty icon="check" title="Every important part is tested" />}
          {cycles.length ? <div className="cycles"><div className="mini-h">Files that import each other in a circle</div>{cycles.slice(0, 4).map((c) => <div key={c.join()} className="cycle"><Icon name="refresh" size={13} />{c.map((p) => shortPath(p, 2)).join(' → ')} → …</div>)}</div> : null}
        </Card>
      </div>

      <Card title="Changing fast" sub="Files changed most often recently, how many of those changes were fixes, and who made them. A bus factor of 1 means one person made most of the changes.">
        {hot.length ? <div className="hot">{hot.map((h) => (
          <div key={h.path} className="hotrow">
            <span className="hot-l"><b>{shortPath(h.path, 3)}</b><span className="muted small">{h.commits} changes · last {h.lastAt.slice(0, 10)}{detailed ? ` · churn ${fmtK(h.churn)} lines` : ''}</span></span>
            <span className="hbar heat"><span style={{ width: pct(h.heat / maxHeat) }} /></span>
            <span className={`fix ${h.fixShare >= 0.3 ? 'high' : ''}`} title="Share of changes that were fixes">{pct(h.fixShare)} fixes</span>
            <span className="owners">{h.owners.slice(0, 3).map((o) => <span key={o.author} className="av" style={{ background: tone(o.author) }} title={`${o.author}: ${pct(o.share)} of changes`}>{initials(o.author)}</span>)}</span>
            {h.busFactor === 1 && h.commits >= 3 ? <Chip tone="ember">only {h.owners[0]?.author.split(' ')[0]}</Chip> : <span className="muted small">{h.authors} people</span>}
          </div>))}</div> : <Empty icon="history" title="No history">This folder is not a git repository, or it has no commits yet.</Empty>}
      </Card>

      <div className="grid2">
        <Card title="Busiest areas" sub="Product areas ranked by recent change activity.">
          {areas.length ? <div className="hrows">{areas.map((a) => (
            <div key={a.path} className="hrow static">
              <span className="hrow-l"><b>{a.path.replace(/\/$/, '').split('/').pop()}</b><span className="muted small">{a.commits} changes · {a.authors} people</span></span>
              <span className="hbar heat"><span style={{ width: pct(a.heat / Math.max(1, ...areas.map((x) => x.heat))) }} /></span>
              <span className="muted small">{a.owners[0] ? `mostly ${a.owners[0].author.split(' ')[0]}` : ''}</span>
            </div>))}</div> : <Empty title="No history yet" />}
        </Card>
        <Card title="Domain words" sub="The business words this code is built from. RIAF maps plain-language questions onto them.">
          <div className="terms">{glossary.map((t) => (
            <button key={t.term} className="term" style={{ ['--c' as string]: tone(t.term), fontSize: `${12 + Math.min(6, Math.log2(1 + t.score))}px` }} title={t.meaning ?? `${t.symbols} parts in ${t.files} files`} onClick={() => t.defines[0] && go('repository', t.defines[0])}>{t.term}</button>
          ))}</div>
          <div className="meanings">{glossary.filter((t) => t.meaning).slice(0, 5).map((t) => <div key={t.term}><b>{t.term}</b> <span className="muted small">{t.meaning}</span></div>)}</div>
        </Card>
      </div>

      <Detail>
        <div className="grid2">
          <Card title="Tangled code" sub="Definitions with the most outgoing dependencies: hardest to read and test in isolation.">
            <div className="hrows">{tangled.map((h) => <button key={h.symbol} className="hrow" onClick={() => go('repository', h.symbol)}><span className="hrow-l"><b>{name(h)}</b><span className="muted small">{shortPath(h.path, 2)}</span></span><span className="num">{h.fanOut} deps</span></button>)}</div>
          </Card>
          <Card title="Possibly unused" sub="Nothing depends on these and no test reaches them: dead code, or entry points called from outside.">
            <div className="row wrap">{unused.slice(0, 24).map((h) => <Chip key={h.symbol} mono onClick={() => go('repository', h.symbol)}>{name(h)}</Chip>)}</div>
          </Card>
        </div>
      </Detail>
    </div>
  );
}
