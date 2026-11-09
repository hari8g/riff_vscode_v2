import type { Rpc } from './tools.js';

/**
 * The @riaf chat participant: compiles a pack for the request and hands the task to a frontier
 * harness — Copilot agent mode or Claude Code. There is no bespoke agent loop in v2.
 */

export interface ChatStreamLike {
  markdown(text: string): void;
  progress(text: string): void;
  button(cmd: { command: string; title: string; arguments?: unknown[] }): void;
}

export interface ParticipantResult {
  packId?: string;
  branch?: string;
  question?: string;
}

/** Handles one @riaf request; returns metadata the extension records for follow-ups. */
export async function handleChat(rpc: Rpc, prompt: string, stream: ChatStreamLike, opts: { activeFile?: string; sessionId?: string; budget?: number } = {}): Promise<ParticipantResult> {
  const text = prompt.trim();
  if (!text) {
    stream.markdown('Describe the task (a bug, a feature, a refactor, a question) and RIAF compiles the context for it.');
    return {};
  }
  stream.progress('Routing the request and compiling a context pack…');
  const r = await rpc.call('pack.compile', {
    request: { text, ide: { ...(opts.activeFile ? { activeFile: opts.activeFile } : {}), interactive: true } },
    target: 'copilot', ...(opts.budget ? { budget: opts.budget } : {}), ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  });
  const p = r.pack;
  if (p.route.branch === 'clarify' && p.route.question) {
    stream.markdown(`**One question first:** ${p.route.question}`);
    return { packId: p.packId, branch: p.route.branch, question: p.route.question };
  }
  stream.markdown(`Compiled pack \`${p.packId}\` · ${p.route.branch} · ${p.items.length} items · ${p.tokensUsed}/${p.budget} tokens\n\n`);
  stream.markdown(r.rendered);
  stream.button({ command: 'riaf.handoffCopilot', title: 'Continue in Copilot agent mode', arguments: [text, p.packId] });
  stream.button({ command: 'riaf.handoffClaude', title: 'Open in Claude Code', arguments: [text, p.packId] });
  return { packId: p.packId, branch: p.route.branch };
}

/** The prompt handed to an agent harness: the task plus where to find the pack. */
export function handoffPrompt(task: string, packFile: string): string {
  return `${task}\n\nRIAF compiled the context for this task in ${packFile}. Read it first, follow its suggested lookups, then make the change and run the tests.`;
}
