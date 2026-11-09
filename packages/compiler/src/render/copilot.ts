import type { Pack } from '@riaf/kernel';
import { fence, routeLine, where } from './common.js';

/** Copilot LM tool results have practical size limits; drop lowest-value items until the text fits. */
export const COPILOT_MAX_CHARS = 24_000;

export function renderCopilot(p: Pack, maxChars = COPILOT_MAX_CHARS): string {
  const header = `RIAF context (${routeLine(p)}).`;
  const blocks = p.items.map((i) => ({ i, text: `${where(i)} (${i.kind}, ${i.why.rule}):\n${fence(i)}` }));
  // keep orientation and code; shed history/run-book, then the lowest-scored code, until it fits
  const order = [...blocks].sort((a, b) => b.i.tier - a.i.tier || a.i.why.score - b.i.why.score);
  const kept = new Set(blocks);
  const size = () => header.length + [...kept].reduce((n, b) => n + b.text.length + 2, 0);
  for (const b of order) {
    if (size() <= maxChars) break;
    kept.delete(b);
  }
  const dropped = blocks.length - kept.size;
  const body = blocks.filter((b) => kept.has(b)).map((b) => b.text).join('\n\n');
  return `${header}\n\n${body}${dropped ? `\n\n(${dropped} lower-priority items omitted to fit; ask riaf_pack with a larger budget)` : ''}\n`;
}
