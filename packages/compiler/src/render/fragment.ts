import type { Pack } from '@riaf/kernel';
import { where } from './common.js';

/** A compact system-prompt fragment for any model: plain text, no markdown headings. */
export function renderFragment(p: Pack): string {
  const lines = [`<riaf-context pack="${p.packId}" branch="${p.route.branch}" tokens="${p.tokensUsed}">`];
  for (const i of p.items) lines.push(`--- ${where(i)} [${i.kind}; ${i.why.intent}/${i.why.rule}]`, i.content);
  if (p.openLookups.length) lines.push('--- suggested lookups', ...p.openLookups.map((l) => `${l.tool} ${JSON.stringify(l.args)}: ${l.reason}`));
  lines.push('</riaf-context>');
  return lines.join('\n') + '\n';
}
