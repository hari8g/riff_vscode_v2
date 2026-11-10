import {
  estimateTokens, hashWith, INTENTS, shortHash,
  type ComposedPolicy, type GovernanceFile, type Intent, type Pack, type TokenSettings,
} from '@riaf/kernel';
import { renderClaude } from './render/claude.js';

/**
 * The detailed agent prompt RIAF injects after intent routing and pack compilation.
 *
 * Layout (stable sections first, so providers can cache the prefix across tasks):
 *   protocol → repository rules → reply format   (stable, cacheable)
 *   task → plan → token & tool budget → what to watch → context pack → before you finish   (volatile)
 *
 * Every number in the budget section comes from `.riaf/tokens.yaml` blended by the route's intent
 * weights, and every section is capped so the frame never crowds out the context.
 */

export type PromptHost = 'claude' | 'copilot' | 'generic';

export interface PromptInput {
  /** The task in the user's words. */
  text: string;
  policy: ComposedPolicy;
  pack: Pack;
  settings: TokenSettings;
  host: PromptHost;
  governance?: GovernanceFile;
  /** The generated run-book; commands, conventions and hard constraints are lifted from it. */
  runbook?: string;
  /** Short facts about the anchors from the graph, history and glossary (hubs, owners, meanings). */
  notes?: string[];
}

export interface PromptSection { id: string; title: string; text: string; tokens: number; cacheable: boolean }

export interface IntentShare { intent: Intent; weight: number; pack: number; output: number; planGate: boolean }

export interface TokenPlan {
  model: string;
  contextWindow: number;
  usable: number;
  reasoning: number;
  output: number;
  packBudget: number;
  packUsed: number;
  frame: number;
  prompt: number;
  cacheable: number;
  headroom: number;
  summarizeAt: number;
  planGate: boolean;
  intentMix: IntentShare[];
}

export interface AgentPrompt {
  promptId: string;
  host: PromptHost;
  text: string;
  stableHash: string;
  sections: { id: string; title: string; tokens: number; cacheable: boolean }[];
  plan: TokenPlan;
}

const LABEL: Record<Intent, string> = { bugfix: 'Bug fix', feature: 'Feature', merge: 'Merge', review: 'Review', refactor: 'Refactor', onboarding: 'Onboarding', unknown: 'Unclear' };

/** Blends per-intent token settings by the route's primitive weights (renormalised over the primitives). */
export function blendTokens(policy: Pick<ComposedPolicy, 'primitives'>, settings: TokenSettings): { pack: number; output: number; planGate: boolean; mix: IntentShare[] } {
  const prims = policy.primitives.length ? policy.primitives : [{ intent: 'unknown' as Intent, weight: 1 }];
  const total = prims.reduce((a, p) => a + p.weight, 0) || 1;
  const mix = prims.map((p) => {
    const s = settings.intents[p.intent];
    return { intent: p.intent, weight: p.weight / total, pack: s.pack, output: s.output, planGate: s.plan_gate };
  }).sort((a, b) => b.weight - a.weight);
  const round = (x: number, step: number) => Math.round(x / step) * step;
  return {
    pack: round(mix.reduce((a, m) => a + m.weight * m.pack, 0), 500),
    output: round(mix.reduce((a, m) => a + m.weight * m.output, 0), 256),
    planGate: mix.some((m) => m.planGate && m.weight >= settings.plan_gate_min_weight),
    mix,
  };
}

const TOOL_HINTS: Record<PromptHost, string> = {
  claude: 'Use the RIAF MCP tools before broad search: `riaf_jump` (definition and references), `riaf_impact` (what depends on it, tests), `riaf_history` (why it is the way it is), `riaf_wiki` (structure), `riaf_pack` (a fresh pack if the focus moves). Grep and Glob are answered from the index when cheaper.',
  copilot: 'Use the RIAF tools before broad search: `#riafJump` (definition and references), `#riafImpact` (what depends on it, tests), `#riafHistory` (why it is the way it is), `#riafWiki` (structure), `#riafPack` (a fresh pack if the focus moves).',
  generic: 'If you need code that is not in the context below, ask for it by file path or symbol name instead of guessing.',
};

const PLAYBOOK: Record<Intent, string[]> = {
  bugfix: [
    'Reproduce: find or write a test that fails for the reported behaviour.',
    'Locate the cause in the anchors under *Context*; follow the callers and callees listed there.',
    'Make the smallest fix that corrects it without changing behaviour for other callers.',
    'Run the failing test, then the tests listed under *Before you finish*.',
  ],
  feature: [
    'Find the closest existing feature (the sibling template under *Context*) and follow its structure and naming.',
    'Add the new behaviour at the existing extension points; do not restructure unrelated code.',
    'Add tests next to the sibling\'s tests, covering the new behaviour and one edge case.',
    'Run the related tests and the linter.',
  ],
  refactor: [
    'List every reference in the closure under *Context* before changing anything.',
    'Change in small, behaviour-preserving steps; update every call site and test.',
    'Run the whole test suite; behaviour must be identical.',
  ],
  review: [
    'Read the changed symbols and their co-change partners.',
    'Check the invariants, past incidents and reverts listed under *Context*.',
    'Report findings as `file:line — severity — issue — suggested fix`; do not edit unless asked.',
  ],
  merge: [
    'Read both sides\' changes and the files that usually change with them.',
    'Resolve so the intent of both branches survives; prefer the newer API when they conflict.',
    'Run the tests over the touched code.',
  ],
  onboarding: [
    'Start from the repository map and the area summaries under *Context*.',
    'Answer with `file:line` references and short explanations; do not edit.',
  ],
  unknown: [
    'Restate the task in one sentence and confirm it with the user before editing.',
    'Use the suggested lookups at the end of *Context* to find where it applies.',
  ],
};

const DONE: Record<Intent, string> = {
  bugfix: 'The test that reproduced the bug now passes, and no related test fails.',
  feature: 'The new behaviour is covered by tests that pass, and existing tests still pass.',
  refactor: 'Behaviour is unchanged: the full test suite passes with no edits to test expectations.',
  review: 'Every finding has a location, a severity and a suggested fix.',
  merge: 'Both branches\' intent is preserved and the tests over the touched code pass.',
  onboarding: 'Every claim in the answer points to a file and line.',
  unknown: 'The user confirmed what the task is before any edit was made.',
};

const fmt = (n: number) => n.toLocaleString('en-US');

/** Lines of one `## Heading` section of the run-book (bullets only). */
function runbookSection(runbook: string | undefined, heading: string): string[] {
  if (!runbook) return [];
  const m = runbook.split('\n');
  const at = m.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of m.slice(at + 1)) {
    if (l.startsWith('## ')) break;
    if (l.startsWith('- ')) out.push(l);
  }
  return out;
}

/** Trims a section to `cap` tokens by dropping whole lines from the end. */
function cap(text: string, max: number): string {
  if (estimateTokens(text) <= max) return text;
  const lines = text.split('\n');
  while (lines.length > 2 && estimateTokens(lines.join('\n')) > max - 12) lines.pop();
  return `${lines.join('\n')}\n- … (trimmed to the ${max}-token section cap)`;
}

/** Builds the detailed agent prompt and its token plan. */
export function buildAgentPrompt(input: PromptInput): AgentPrompt {
  const { pack, policy, settings, host } = input;
  const blend = blendTokens(policy, settings);
  const top = blend.mix[0]!.intent;
  const certainty = 1 - policy.H;

  // ── stable sections ──
  const protocol = cap([
    '## How to work in this repository (RIAF protocol)',
    TOOL_HINTS[host],
    '1. The context pack below is current for this commit. Do not re-read files it already contains unless you are about to edit them.',
    '2. Prefer the suggested lookups at the end of the pack over broad searching.',
    '3. Keep changes minimal and consistent with the conventions and constraints below.',
    '4. After an edit, do not re-read the file to check it; run the relevant test instead.',
    '5. When the plan is clear, stop exploring and act. Respect the token and tool budget.',
  ].join('\n'), settings.sections.protocol);

  const commands = runbookSection(input.runbook, 'Commands');
  const conventions = runbookSection(input.runbook, 'Conventions');
  const constraints = runbookSection(input.runbook, 'Hard constraints');
  const done = runbookSection(input.runbook, 'Definition of done');
  const repository = cap([
    '## Repository rules',
    ...(commands.length ? ['Commands:', ...commands] : []),
    ...(constraints.length ? ['Hard constraints (never break these):', ...constraints] : []),
    ...(conventions.length ? ['Conventions:', ...conventions] : []),
    ...(done.length ? ['Definition of done:', ...done] : []),
    ...(!commands.length && !constraints.length && !conventions.length ? ['No run-book yet; run `riaf init` to generate `.riaf/runbook.md`.'] : []),
  ].join('\n'), settings.sections.protocol);

  const reply = [
    '## Reply format',
    'End with: **Summary** (one or two sentences) · **Files changed** (`path` — what and why) · **Tests run** (command and result) · **Risks or open questions**.',
  ].join('\n');

  // ── volatile sections ──
  const mixLine = blend.mix.filter((m) => m.weight >= 0.05).map((m) => `${LABEL[m.intent]} ${Math.round(m.weight * 100)}%`).join(' · ');
  const task = [
    '## Task',
    ...input.text.trim().split('\n').map((l) => `> ${l}`),
    '',
    `How RIAF read it: **${mixLine}** (${policy.branch} reading, certainty ${Math.round(certainty * 100)}%).`,
    ...(policy.units.length > 1 ? ['Parts of the task:', ...policy.units.map((u, i) => `${i + 1}. ${u.text}`)] : []),
    ...(policy.question ? ['', `**Ask before acting:** ${policy.question.question}`] : []),
  ].join('\n');

  const steps: string[] = [];
  if (policy.units.length > 1) {
    const unitById = new Map(policy.units.map((u) => [u.id, u] as const));
    policy.stages.forEach((stage, s) => {
      for (const id of stage) {
        const u = unitById.get(id);
        if (!u) continue;
        const ui = INTENTS.filter((i) => i !== 'unknown').sort((a, b) => (u.w[b] ?? 0) - (u.w[a] ?? 0))[0] ?? 'unknown';
        steps.push(`**Stage ${s + 1} — ${u.text}** (${LABEL[ui].toLowerCase()})`, ...PLAYBOOK[ui].slice(0, 3).map((p) => `   - ${p}`));
      }
    });
  } else {
    steps.push(...PLAYBOOK[top]);
    for (const m of blend.mix.slice(1)) if (m.weight >= 0.2 && m.intent !== 'unknown') steps.push(`For the ${LABEL[m.intent].toLowerCase()} part: ${PLAYBOOK[m.intent][0]}`);
  }
  const plan = cap([
    '## Plan',
    ...(blend.planGate ? ['**Plan gate:** present this plan (adapted to what you find) and wait for approval before the first edit.'] : []),
    ...steps.map((s, i) => (s.startsWith('**') || s.startsWith('   ') ? s : `${i + 1}. ${s}`)),
  ].join('\n'), settings.sections.plan);

  const notes = input.notes?.length ? cap(['## What to watch', ...input.notes.map((n) => `- ${n}`)].join('\n'), settings.sections.notes) : '';

  const body = renderClaude(pack);
  const context = [`## Context pack ${pack.packId}`, body.slice(body.indexOf('\n## ') + 1).replace(/^## /gm, '### ').replace(/^### Stage/gm, '#### Stage')].join('\n');

  const tests = [...new Set(pack.items.filter((i) => i.kind === 'test' && (i.source as { path?: string }).path).map((i) => (i.source as { path: string }).path))];
  const testCmd = commands.find((c) => /^- test:/.test(c))?.replace(/^- test:\s*/, '');
  const finish = [
    '## Before you finish',
    `- [ ] ${DONE[top]}`,
    ...(testCmd ? [`- [ ] Run the tests: ${testCmd}${tests.length ? ` (at least ${tests.slice(0, 4).map((t) => `\`${t}\``).join(', ')})` : ''}`] : tests.length ? [`- [ ] Run ${tests.slice(0, 4).map((t) => `\`${t}\``).join(', ')}`] : []),
    ...(constraints.length ? ['- [ ] No hard constraint above is broken.'] : []),
    '- [ ] Reply in the format above.',
  ].join('\n');

  // ── token plan (needs the frame size, so the budget section is measured with a placeholder first) ──
  const usable = Math.round(settings.model.context_window * settings.model.use_ratio);
  const stable = settings.cache.stable_prefix ? [protocol, repository, reply] : [];
  const volatileNoBudget = [task, plan, notes, context, finish].filter(Boolean);
  const budgetSection = (prompt: number, frame: number, ctx: number) => {
    const headroom = usable - prompt - blend.output - settings.reasoning;
    const phases = input.governance?.phases;
    return [
      '## Token and tool budget',
      `Model **${settings.model.name}** · context window ${fmt(settings.model.context_window)} · RIAF plans to use ${Math.round(settings.model.use_ratio * 100)}% (${fmt(usable)}).`,
      '',
      '| Part | Tokens |',
      '| --- | ---: |',
      `| This prompt: instructions ${fmt(frame)} + context ${fmt(ctx)} | ${fmt(prompt)} |`,
      `| Context pack content used / budget | ${fmt(pack.tokensUsed)} / ${fmt(pack.budget)} |`,
      `| Reserved for your reply and edits | ${fmt(blend.output)} |`,
      ...(settings.reasoning ? [`| Reserved for reasoning | ${fmt(settings.reasoning)} |`] : []),
      `| Left for your own reading and tool results | ${fmt(Math.max(0, headroom))} |`,
      '',
      `Budget mix by intent: ${blend.mix.filter((m) => m.weight >= 0.05).map((m) => `${LABEL[m.intent]} ${Math.round(m.weight * 100)}% → pack ${fmt(m.pack)}, reply ${fmt(m.output)}`).join('; ')}.`,
      `Summarise your progress (task, done, learned, open) once the conversation passes ~${fmt(Math.round((usable - blend.output - settings.reasoning) * settings.summarize_at))} tokens.`,
      ...(phases ? [
        '',
        '| Phase | Tool calls (soft / max) | Tokens (soft / max) | Minutes |',
        '| --- | ---: | ---: | ---: |',
        ...(['explore', 'plan', 'implement', 'verify'] as const).map((ph) => {
          const l = phases[ph];
          return l ? `| ${ph} | ${l.soft_calls} / ${l.max_calls} | ${fmt(l.soft_tokens)} / ${fmt(l.max_tokens)} | ${l.max_minutes} |` : '';
        }).filter(Boolean),
        'At a soft limit, write down the plan and what you learned, then continue. At a hard limit, stop exploring and act on what you have.',
      ] : []),
    ].join('\n');
  };
  const order = (budget: string) => settings.cache.stable_prefix
    ? [...stable, task, plan, budget, notes, context, finish]
    : [task, plan, budget, notes, context, finish, protocol, repository, reply];
  const header = (plan: TokenPlan) => `# RIAF agent prompt · pack ${pack.packId} · ${settings.model.name}\n_Injected by RIAF after intent routing and context compilation. Prompt ${fmt(plan.prompt)} tokens · reply reserve ${fmt(plan.output)} · headroom ${fmt(plan.headroom)} of ${fmt(plan.usable)} usable._`;

  // two passes: measure, then render the budget with real numbers
  const ctxTokens = estimateTokens(context);
  const draftFrame = [...stable, ...volatileNoBudget.filter((s) => s !== context)].reduce((a, s) => a + estimateTokens(s), 0) + estimateTokens(budgetSection(0, 0, 0)) + 60;
  const promptTokens = draftFrame + ctxTokens;
  const budget = budgetSection(promptTokens, draftFrame, ctxTokens);
  const cacheable = stable.reduce((a, s) => a + estimateTokens(s), 0);
  const tokenPlan: TokenPlan = {
    model: settings.model.name, contextWindow: settings.model.context_window, usable, reasoning: settings.reasoning, output: blend.output,
    packBudget: pack.budget, packUsed: pack.tokensUsed, frame: draftFrame, prompt: promptTokens, cacheable,
    headroom: Math.max(0, usable - promptTokens - blend.output - settings.reasoning),
    summarizeAt: Math.round((usable - blend.output - settings.reasoning) * settings.summarize_at),
    planGate: blend.planGate, intentMix: blend.mix,
  };
  const parts = order(budget).filter(Boolean);
  const text = `${header(tokenPlan)}\n\n${parts.join('\n\n')}\n`;
  const titleOf = (s: string) => s.slice(3, s.indexOf('\n') > 0 ? s.indexOf('\n') : undefined).trim();
  const idOf: [string, string][] = [[protocol, 'protocol'], [repository, 'repository'], [reply, 'reply'], [task, 'task'], [plan, 'plan'], [budget, 'budget'], [notes, 'notes'], [context, 'context'], [finish, 'finish']];
  const sections = parts.map((s) => ({ id: idOf.find(([t]) => t === s)![1], title: titleOf(s), tokens: estimateTokens(s), cacheable: stable.includes(s) }));
  const stableHash = shortHash(hashWith('riaf.prompt.stable', ...stable), 16);
  return { promptId: `pr_${shortHash(hashWith('riaf.prompt', pack.packId, text), 12)}`, host, text, stableHash, sections, plan: tokenPlan };
}
