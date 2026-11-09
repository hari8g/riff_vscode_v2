import type { Pack, RenderTarget } from '@riaf/kernel';
import { renderClaude } from './claude.js';
import { renderCopilot } from './copilot.js';
import { renderFragment } from './fragment.js';

/** AGENTS.md / CLAUDE.md content: the run-book item when present, else a pointer. */
export function renderAgentsMd(p: Pack): string {
  const rb = p.items.find((i) => i.kind === 'runbook');
  return rb ? rb.content : '# Run-book\n\nRun `riaf init` to generate `.riaf/runbook.md`.\n';
}

/** Renders a pack for a target surface. JSON is the canonical record. */
export function render(p: Pack, target: RenderTarget): string {
  switch (target) {
    case 'claude': return renderClaude(p);
    case 'copilot': return renderCopilot(p);
    case 'fragment': return renderFragment(p);
    case 'agentsmd': return renderAgentsMd(p);
    case 'json': return JSON.stringify(p, null, 2);
  }
}

export { renderClaude, renderCopilot, renderFragment };
