import type { RpcResult } from '@riaf/kernel';

/** Markdown for the non-pack tools; compact so a model spends few tokens reading them. */

const nameOf = (id: string) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('@')) || id.slice(0, id.indexOf('#'));

export function formatJump(j: RpcResult<'graph.jump'>, limit = 30): string {
  const d = j.definition;
  if (!d) return 'No symbol matched. Try a qualified name (`Class.method`), a bare name, or `path:line`.';
  const out = [`**${nameOf(d.symbol)}** (${d.kind ?? 'symbol'}) — \`${d.path}:${d.startLine}-${d.endLine}\``, '```', d.signature, '```'];
  if (d.doc) out.push(d.doc.split('\n')[0]!);
  if (j.alternatives.length) out.push(`Also matched: ${j.alternatives.slice(0, 5).map((a) => `\`${a}\``).join(', ')}`);
  out.push('', `References (${j.references.length}):`);
  for (const r of j.references.slice(0, limit)) out.push(`- \`${r.path}:${r.line}\` ${r.kind} in ${nameOf(r.symbol) || '(file)'}`);
  if (j.references.length > limit) out.push(`- … ${j.references.length - limit} more`);
  if (j.blame.length) {
    out.push('', 'Recent commits on this symbol:');
    for (const b of j.blame) out.push(`- ${b.commit.slice(0, 10)} ${b.at.slice(0, 10)} ${b.summary ?? ''}`);
  }
  if (j.skills.length) {
    out.push('', 'Skills:');
    for (const s of j.skills) out.push(`- ${s.purpose}: ${s.playbook}`);
  }
  return out.join('\n');
}

export function formatImpact(ids: readonly string[], r: RpcResult<'graph.impact'>): string {
  const out = [`Impact of ${ids.map((i) => `\`${nameOf(i)}\``).join(', ')}:`, '', `Dependents (${r.closure.length}):`];
  for (const c of r.closure.slice(0, 40)) out.push(`${'  '.repeat(Math.max(0, c.distance - 1))}- \`${c.symbol}\` (${c.via})`);
  out.push('', `Tests to run (${r.tests.length}):`, ...r.tests.map((t) => `- \`${t}\``));
  if (r.coChange.length) out.push('', 'Usually changed together:', ...r.coChange.slice(0, 10).map((c) => `- \`${c.symbol}\` (support ${c.support})`));
  return out.join('\n');
}

export function formatWikiPage(p: RpcResult<'wiki.page'>): string {
  const out = [`## ${p.id || '/'} (${p.level})`, '', p.summary];
  if (p.children.length) out.push('', ...p.children.map((c) => `- \`${c.id}\` — ${c.summary}`));
  if (p.symbols.length) out.push('', ...p.symbols.map((s) => `- \`${s.signature}\`${s.doc ? ` — ${s.doc}` : ''}`));
  return out.join('\n');
}

export function formatWikiTree(t: RpcResult<'wiki.structure'>['tree'], depth = 0): string {
  const line = `${'  '.repeat(depth)}- \`${t.id || '/'}\`${t.summary ? ` — ${t.summary}` : ''}`;
  return [line, ...t.children.map((c) => formatWikiTree(c, depth + 1))].join('\n');
}
