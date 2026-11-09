import type { Pack } from '@riaf/kernel';
import { fence, routeLine, TIER_TITLE, where } from './common.js';

/** Markdown for Claude Code (MCP tool result / riaf://pack/current): grouped by tier and stage. */
export function renderClaude(p: Pack): string {
  const out: string[] = [`# RIAF context pack ${p.packId}`, '', `${routeLine(p)} · ${p.tokensUsed}/${p.budget} tokens · ${p.policyVersion}`];
  if (p.route.question) out.push('', `> **Clarify first:** ${p.route.question}`);
  for (const tier of [1, 2, 3, 4]) {
    const items = p.items.filter((i) => i.tier === tier);
    if (!items.length) continue;
    out.push('', `## ${TIER_TITLE[tier]}`);
    let stage = -1;
    for (const i of items) {
      if (tier === 2 && p.route.stages.length > 1 && i.stage !== stage) {
        stage = i.stage;
        out.push('', `### Stage ${stage + 1}: ${p.route.stages[stage]?.join(', ') ?? ''}`);
      }
      const head = i.kind === 'summary' && !where(i).includes('/') && i.why.rule === 'repo_map' ? 'Repo map (signatures, ranked)' : `${where(i)} — ${i.kind}, ${i.why.rule}`;
      out.push('', `**${head}**`, fence(i));
    }
  }
  if (p.openLookups.length) {
    out.push('', '## Suggested next lookups');
    for (const l of p.openLookups) out.push(`- \`${l.tool}\` ${JSON.stringify(l.args)} — ${l.reason}`);
  }
  return out.join('\n') + '\n';
}
