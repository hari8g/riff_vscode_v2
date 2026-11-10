# ADR-0005 — A detailed agent prompt with explicit token settings

**Status:** accepted · **Date:** 2026-11-10

## Context
Until protocol 1.4, RIAF injected the bare context pack into Claude Code on every new prompt. The pack says *what* to read, but not *how* to work: the agent did not see how RIAF read the task, which plan fits that kind of work, how much of its context window it may spend, what the governance budgets are, or what is risky about the code it is about to touch. v1 (riaf-vscode) showed that a structured instruction around the pack — stable rules first, then task, plan, budgets and context — changes agent behaviour and caches well. Token figures were scattered (pack budget in `policies.yaml`, phase budgets in `governance.yaml`, nothing for the reply or the model window).

## Decision
1. After intent routing and pack compilation, the compiler builds an **agent prompt** (`buildAgentPrompt`, `@riaf/compiler`): protocol → repository rules → reply format (stable, cacheable, hashed into `stableHash`), then task as read → plan (per-intent playbooks, per-stage for multi-part tasks, with a plan gate) → token and tool budget → what to watch → context pack → finishing checklist. Each section has a token cap.
2. **Token settings** are a new contract, `TokenSettingsSchema` in `kernel/src/schemas/tokens.ts`, stored in `.riaf/tokens.yaml` (written by `riaf init`, built-in defaults otherwise): model window and fill ratio, reasoning reserve, section caps, and per intent a pack budget, a reply reserve and a plan gate. The route's intent weights blend the per-intent values, so a "bug fix + feature" task gets a weighted budget. Settings that cannot fit the usable window are rejected.
3. "What to watch" is fed by the three knowledge layers: fan-in and missing tests from the graph (L1), hotspots, owners and bus factor from history (L2), and term meanings from the domain glossary (L3).
4. The Claude Code prompt hook injects the agent prompt (`prompt.build`), falling back to the pack on an older daemon; `riaf prompt` prints it; the console's *AI prompt* page shows it with its token plan and edits the settings.

## Consequences
- New RPC methods only (protocol 1.5, ADR-0004); existing render targets and golden packs are unchanged.
- No store migration: the settings are a file, and the new layer queries read existing tables.
- The pack budget for injected prompts now follows the task's intent mix instead of a fixed 8k, unless `RIAF_HOOK_BUDGET` pins it.
