# RIAF v2 for VS Code

**Repository intelligence for AI-assisted engineering.** RIAF reads your repository on your own machine (its structure, its history and the words it is built from), turns each task into a precise, budgeted prompt for Claude Code or GitHub Copilot, starts Claude Code on it in a terminal, and shows you what Claude Code did: its reply, the code it wrote, and the commands it ran.

- **Compile a task into a prompt.** As you type, RIAF reads what kind of work the task is (bug fix, new feature, refactor, review, merge, explain). It then gathers the code, tests, history and team rules the task needs, within a token budget, and wraps them in a detailed agent prompt with a plan, a token and tool budget, and a finishing checklist.
- **Hand it to Claude Code.** One click opens a terminal in the repository with Claude Code already working on the full prompt.
- **See what happened.** Every run is keyed to its prompt: Claude Code's reply, per-file diffs of the code it wrote, the commands with OK or FAIL, and a live terminal-style feed while it works.
- **Use it from Copilot too.** The `@riaf` chat participant and five language-model tools (`#riafPack`, `#riafJump`, `#riafImpact`, `#riafHistory`, `#riafWiki`).
- **Local-first.** The index, the service and the console run on your machine. SQLite and tree-sitter run as WebAssembly, so nothing is downloaded at install time and no native modules are built.

> Built by Bosch Mobility Platform and Solutions (MPS). Version 0.4.0, for VS Code 1.95 or later.

---

## Contents

1. [Why RIAF](#1-why-riaf)
2. [Quick start](#2-quick-start)
3. [The RIAF Console](#3-the-riaf-console)
4. [From prompt to Claude Code, in detail](#4-from-prompt-to-claude-code-in-detail)
5. [Using RIAF with GitHub Copilot](#5-using-riaf-with-github-copilot)
6. [Using RIAF with Claude Code directly](#6-using-riaf-with-claude-code-directly)
7. [Commands](#7-commands)
8. [Settings and environment variables](#8-settings-and-environment-variables)
9. [Files RIAF writes in your repository](#9-files-riaf-writes-in-your-repository)
10. [How it works](#10-how-it-works)
11. [Privacy and security](#11-privacy-and-security)
12. [Requirements](#12-requirements)
13. [Troubleshooting](#13-troubleshooting)
14. [Developing the extension](#14-developing-the-extension)
15. [Release notes](#15-release-notes)
16. [License](#16-license)

---

## 1. Why RIAF

An AI coding assistant spends most of its effort rediscovering your repository: where the code is, what calls what, which test to copy, why a line looks the way it does, which team rules apply. That costs tool calls, tokens and money, and it still misses things.

RIAF does that discovery once, locally, and keeps it current as the code changes. For each task it delivers the smallest context that is still sufficient, plus explicit instructions on how to work. On the 30-task evaluation set in this repository, a RIAF context pack reaches **97.1 %** of the files a task needs. The baseline (an assistant searching and reading files without RIAF) reaches 86.8 %, so RIAF uses **49 % less context** and **one step instead of 11.5**. The full numbers and how they are measured are in the repository's main `README.md` and `docs/eval/`.

---

## 2. Quick start

1. **Install** the `.vsix` (built with `pnpm package:vsix` from the repository root):

   ```bash
   code --install-extension dist-bundle/riaf-vscode-v2-0.4.0.vsix --force
   ```

2. **Open your repository folder.** RIAF starts its local service and indexes the folder. The status bar shows **RIAF *n* files** when it is ready. A first index takes seconds for most repositories; after that only changed files are re-read.
3. **Open the console:** click **RIAF** in the status bar, or run **RIAF: Open console** from the command palette.
4. **Describe a task** on *Home* or *Prompt*, for example *"Build a new feature that shows the next ISS pass over my city"*. Watch RIAF read the kind of work, then press **Compile**.
5. **Press Export to Claude Code.** A terminal opens in the repository and Claude Code starts working on the full prompt. Approve its steps there, and follow along on the console's **Claude Code** page.

For Claude Code's own integration (MCP tools, hooks, slash commands), run **RIAF: Initialise repository** once. See [§6](#6-using-riaf-with-claude-code-directly).

---

## 3. The RIAF Console

The console is a full-page webview in the Bosch MPS design language: the Bosch supergraphic band across the top, Bosch blue for actions, red only for warnings, and light and dark themes that follow VS Code. It has six pages, in the order of the work:

| Page | What it is for |
| --- | --- |
| **Home** | Start a task and see where things stand |
| **Repository** | Read the code: Browse, Ask, Health |
| **Prompt** | Compile a task into the agent prompt and export it |
| **Claude Code** | Runs keyed to prompts, and the live console |
| **Savings** | What RIAF saves, measured and estimated |
| **Governance** | AI activity, Rules, Setup |

Search with <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd>. Jump to a page with <kbd>g</kbd> followed by <kbd>h</kbd>, <kbd>r</kbd>, <kbd>p</kbd>, <kbd>c</kbd>, <kbd>s</kbd> or <kbd>g</kbd> (Home, Repository, Prompt, Claude Code, Savings, Governance). Press <kbd>/</kbd> to start a new prompt.

### Home

The repository name and whether RIAF is up to date, one box (*"What should Claude Code do?"*) that compiles straight away, and the four steps with live numbers:

1. **Read the repository:** files and parts indexed.
2. **Compile a prompt:** prompts compiled.
3. **Run in Claude Code:** runs done or running.
4. **Measure the savings.**

The latest runs are listed underneath, each with its status.

### Repository

The folder RIAF reads (switch with **Open another repository**), with three tabs:

- **Browse:** the product area by area, with a short summary of each. Pick any part to see:
  - what depends on it, as a radial graph of direct and indirect dependants,
  - the automated checks that reach it,
  - what usually changes with it,
  - where it is used,
  - how it changed over time.
- **Ask:** questions in plain language, for people who do not read code (*How does dispute handling work? What would break if we change pricing? Who knows the ledger best? How big is this request?*). Each answer shows how RIAF arrived at it, offers views per kind of answer (impact rings, risk gauge, timeline, owners, a T-shirt size with a ticket brief), and lists its sources.
- **Health:**
  - load-bearing parts (most depended on) and whether a test reaches them,
  - important parts with no test,
  - files that import each other in a circle,
  - files changing fast, with their share of fixes, owners and bus factor,
  - the busiest areas,
  - the domain words the code is built from.

### Prompt

1. **Describe the task** and pick the target: Claude Code, Copilot or any model.
2. **See the kind of prompt, live.** As you type, a panel shows what the task will compile to: *New feature*, *Bug fix + New feature*, *Refactor* and so on. It shows how clear the reading is (*clear reading*, *two kinds of work*, *needs a question*). It also shows what RIAF will gather (for a bug fix, the failing code, its callers and callees, the test that exercises it, the commits that last touched it) and what Claude Code will be told to do (reproduce with a test, make the smallest fix, rerun the tests). A multi-part task is split into its parts. Buttons with live weights let you choose a different kind with one click.
3. **Compile.** Four steps fill in with real values:
   1. *Read the task:* the intent mix.
   2. *Gather the context:* pieces and tokens against the budget.
   3. *Build the prompt:* sections, tokens, and whether Claude Code must show its plan first.
   4. *Run in Claude Code.*
4. **Inspect the result** in three tabs:
   - **Prompt:** a table of contents with token counts (cached sections marked) and the full text.
   - **Context:** the gathered code, history and rules by group, each openable.
   - **Token budget:** a context-window bar (cached instructions, task instructions, code and history, reply reserve, reasoning, room to work, safety margin), the budget by kind of work, the plan gate, and the editable token settings with *Economy / Balanced / Thorough* presets.
5. **Export to Claude Code.** See [§4](#4-from-prompt-to-claude-code-in-detail).

### Claude Code

- **Runs.** Every prompt, newest first, with its status:
  - *Compiled*: not handed over yet.
  - *Sent*: exported, waiting for the session to start.
  - *Running.*
  - *Done.*
  - *Needs a look*: steps failed and nothing changed.

  Select a run to see:
  - summary numbers (files changed, commands, steps, failed steps, time),
  - a live terminal-style feed of Claude Code's activity for that prompt,
  - Claude Code's reply,
  - **the code it wrote** as diffs per file (every Edit, MultiEdit and Write),
  - the commands it ran with OK or FAIL,
  - the prompt that was sent, on request.

  A run that has not started shows how to start it.
- **Live console.** Every Claude Code session in the repository as it happens: turns, stages (context, explore, plan, edit, verify, run, delegate), files read and changed, commands, failures, and the raw activity stream. Sessions started from a RIAF prompt carry a *RIAF prompt* badge.

### Savings

- **Measured** on 30 test tasks:
  - less text sent to the AI,
  - fewer steps,
  - more of the right files found,
  - the measured cost of Claude Code on its own.
- **Estimate:** a calculator for your team (search steps saved, developers, tasks per day, working days). It is labelled as an estimate until a measured run replaces it.
- **Live counts** from this repository: tasks prepared, AI searches answered instantly by RIAF, loops stopped.

### Governance

- **AI activity:** the decision RIAF's hooks made for each tool call in governed Claude Code sessions (allowed, answered from the index, answered from cache, checkpoint, blocked), the intent priors RIAF has learned for this repository, and pack utilisation by rule.
- **Rules:** a validated editor for `.riaf/policies.yaml` (how requests are read and served) and `.riaf/governance.yaml` (budgets and guards for AI sessions).
- **Setup:** the local RIAF service, optional AI models, and the surfaces that consume the same pack.

---

## 4. From prompt to Claude Code, in detail

### What Claude Code receives

Compiling stores the prompt in `.riaf/prompts/<promptId>.md`. **Export to Claude Code** writes `.riaf/prompts/<promptId>.launch.md`, which becomes Claude Code's first message:

```
[RIAF pr_1179906f8497] Implement a new feature which improves the tracking of the ISS

# RIAF agent prompt · pack pk-b18bda806afb · claude-sonnet
## How to work in this repository (RIAF protocol)   ← cached across tasks
## Repository rules                                   ← cached
## Reply format                                       ← cached
## Task          (the request, how RIAF read it, its parts, a question to ask first if unclear)
## Plan          (per-intent steps; "plan gate" for features and refactors)
## Token and tool budget   (window, prompt, pack, reply reserve, headroom, phase budgets)
## What to watch (load-bearing parts, missing tests, hotspots, owners, domain terms)
## Context pack  (code, tests, history, conventions by tier)
## Before you finish   (definition of done, tests to run, constraints)
```

The first line is the **marker**, `[RIAF pr_…]`, which keys the Claude Code session to the prompt.

### How Claude Code is started

Nothing is ever typed into a terminal. Typing (VS Code's `sendText`, or pasting) lands in whatever is running there: an open Claude Code session would get the shell command as its task, and a shell that is still starting can discard it. Instead:

| Where | How |
| --- | --- |
| **VS Code** | A new terminal named *Claude Code · pr_…* whose own process is Claude Code, started in the repository with `claude "$(cat .riaf/prompts/<id>.launch.md)"`. When RIAF finds the `claude` CLI it runs straight from `/bin/sh` with Claude Code's folder first on `PATH`, so it does not wait for your shell profile. Otherwise it uses your login shell to find it. When Claude Code exits, a normal shell stays open. |
| **Browser console on macOS** | A new Terminal window opens. RIAF waits until its shell has finished starting, then runs a generated launcher (`.riaf/prompts/<id>.command`) in it. With `RIAF_TERMINAL=iTerm`, iTerm runs the launcher as the window's own command. The first time, macOS asks to let the console control Terminal: allow it once. A new window can take up to a minute if your shell start-up is slow. |
| **Linux / Windows** | A launcher run by `x-terminal-emulator` (override with `RIAF_TERMINAL`), or PowerShell via `cmd start`. |

The prompt is read from the file with `$(cat …)`, so it never passes through shell quoting. Apostrophes, `$`, backticks, quotes and Unicode arrive byte for byte; the test suite checks exactly that.

When no terminal can be opened (for example, the `claude` CLI is not installed), the console says why and offers two copies:

- **Copy shell command:** `cd '<repo>' && claude "$(cat '.riaf/prompts/<id>.launch.md')"`, for pasting into a **shell**.
- **Copy the prompt:** the full launch message, for pasting into a Claude Code session that is **already open**.

### How a run is keyed to its prompt

- **Exported from the console:** the session's first message starts with `[RIAF pr_…]`. The console reads Claude Code's own session logs (`~/.claude/projects/<repository>/*.jsonl`) and links the session through that marker.
- **Typed straight into Claude Code** with RIAF's hook installed: the hook injects the agent prompt and records the session it went into.
- **A message that already carries a marker:** the hook only records the link, and never compiles a second prompt on top.

The run view then takes the session's turns from the marked prompt up to the next RIAF prompt. It builds the diffs from the Edit, MultiEdit and Write calls in those turns, and updates live while Claude Code works.

---

## 5. Using RIAF with GitHub Copilot

### The `@riaf` participant

Type `@riaf <task>` in Copilot Chat. RIAF reads the task, compiles a context pack, explains how it read the request, and offers two buttons:

- **Continue in Copilot agent mode:** opens agent mode with the task and a pointer to the compiled pack.
- **Open in Claude Code:** hands the same task and pack to Claude Code.

### Language-model tools

Available to Copilot in agent mode, and referenceable in chat:

| Tool | Reference | What it returns |
| --- | --- | --- |
| `riaf_pack` | `#riafPack` | The compiled context for a coding request: relevant code bodies, the test to mimic, callers, conventions and history |
| `riaf_jump` | `#riafJump` | Definition, signature and every reference of a symbol (`Class.method`, a bare name, or `path:line`) |
| `riaf_impact` | `#riafImpact` | What depends on the given symbols and which tests exercise them; call before changing a public symbol |
| `riaf_history` | `#riafHistory` | Commits, reverts, incidents and decisions behind a symbol: why the code is the way it is |
| `riaf_wiki` | `#riafWiki` | Summaries of the repository, a directory or a file |

---

## 6. Using RIAF with Claude Code directly

Run **RIAF: Initialise repository** (equivalent to `riaf init --host both`). It writes:

| File | Purpose |
| --- | --- |
| `.riaf/policies.yaml` | How requests are read and which context each kind of work needs |
| `.riaf/governance.yaml` | Phase budgets (calls, tokens, minutes), loop guard, repeat-read cache, compaction advice |
| `.riaf/tokens.yaml` | Token settings for the agent prompt: model window, per-intent pack budget, reply reserve, plan gate |
| `.riaf/constraints.md` | Your hard rules and definition of done, merged into the run-book |
| `.riaf/runbook.md` | Generated run-book (commands, layout, conventions), imported from `CLAUDE.md` / `AGENTS.md` |
| `.mcp.json`, `.vscode/mcp.json` | The `riaf` MCP server for Claude Code and VS Code |
| `.claude/settings.json` | The governance hooks |
| `.claude/commands/` | `/riaf-pack`, `/riaf-jump`, `/riaf-impact`, `/riaf-history` |

**MCP tools** for Claude Code: `riaf_pack`, `riaf_jump`, `riaf_impact`, `riaf_history`, `riaf_wiki`.

**Hooks.** They fail open: when RIAF is unavailable, Claude Code works as normal. They never grant a permission you have not given.

| Hook | What RIAF does |
| --- | --- |
| `SessionStart` | Opens a governed session |
| `UserPromptSubmit` | Routes the prompt, compiles the pack and injects the **detailed agent prompt**; keeps the earlier one while the task is unchanged; only links the session when the message carries a `[RIAF pr_…]` marker |
| `PreToolUse` | Applies phase budgets; answers grep and glob from the index and repeated reads from the cache; asks for a checkpoint at a soft limit; blocks a loop |
| `PostToolUse` | Records which delivered context was actually used |
| `Stop` | Ends the session: utilisation, intent priors, learned skills |

> If a repository still has hooks from RIAF v1 (`.claude/hooks/riaf-govern.mjs`), they also run on every prompt. Re-run **RIAF: Initialise repository** to use v2's hooks only.

---

## 7. Commands

| Command | What it does |
| --- | --- |
| **RIAF: Open console** | Opens the RIAF Console (also the status-bar item). Each open starts a clean console and a fresh local service. |
| **RIAF: Open repository…** | Pick another folder for RIAF to read; it is remembered in the recent list |
| **RIAF: Compile context pack** | Compiles a pack for a task you type |
| **RIAF: Jump to symbol** | Jumps to a definition from the index |
| **RIAF: Re-index repository** | Re-reads the code now (normally incremental and automatic) |
| **RIAF: Initialise repository (policies, run-book, MCP, hooks)** | Sets the repository up for Claude Code and Copilot (§6) |
| **RIAF: Continue in Copilot agent mode** | Hands the task and pack to Copilot agent mode |
| **RIAF: Open in Claude Code** | Hands the task and pack to Claude Code |
| **RIAF: Run a compiled prompt in Claude Code** | Starts Claude Code on a compiled prompt (used by the console's export) |

---

## 8. Settings and environment variables

| Setting | Default | Meaning |
| --- | --- | --- |
| `riaf.budget` | `16000` | Token ceiling for packs compiled from the editor |
| `riaf.models` | `{}` | Optional model adapters per job (`summarize`, `classify`, `embed`, `chat`): `{ provider: anthropic \| openai \| ollama, model, baseUrl?, apiKeyEnv? }`. API keys are read from the named environment variable, never stored in settings. |

| Environment variable | Effect |
| --- | --- |
| `RIAF_TERMINAL` | Terminal app for exported prompts: `iTerm` on macOS, or a terminal emulator command on Linux |
| `RIAF_HOOK_BUDGET` | Pins the pack budget for the Claude Code prompt hook (default: per intent from `tokens.yaml`) |
| `HTTPS_PROXY` / `NO_PROXY` | Honoured by optional model adapters |

The per-intent token settings (pack budget, reply reserve, plan gate, model window, reasoning reserve, section caps, cache ordering, summarise point) live in `.riaf/tokens.yaml`. Edit them in the console under **Prompt → Token budget**, where they are validated before saving.

---

## 9. Files RIAF writes in your repository

| Path | Kept in git? | What it is |
| --- | --- | --- |
| `.riaf/policies.yaml`, `governance.yaml`, `tokens.yaml`, `constraints.md`, `runbook.md` | **Yes**: versioned with the code | Configuration and the generated run-book |
| `.riaf/index.sqlite` | No | The index (runtime state) |
| `.riaf/prompts/` | No | Compiled prompts, launch messages and launchers; the prompt-run registry (`index.jsonl`) |
| `.riaf/hooks-state/`, `.riaf/handoff/`, `.riaf/daemon.json`, `.riaf/governor.json` | No | Runtime state of hooks, hand-offs and the local service |

Add the runtime paths to your `.gitignore` (RIAF's own repository shows the pattern).

---

## 10. How it works

```
 VS Code ─────────────────────────────────────────────────────────────────────────
   RIAF extension (thin)                     RIAF Console (webview, React)
   status bar · @riaf · LM tools · commands  Home · Repository · Prompt · Claude Code · …
        │  JSON-RPC (protocol 1.5)                │ postMessage
        ▼                                         ▼
   RIAF service (one per repository, started from the bundled CLI on VS Code's own Node)
     L0 store    SQLite (wasm): blobs, Merkle table, full-text and trigram search
     L1 parse    tree-sitter tags · L1 graph: symbols, edges, repo map, impact, insights
     L2 history  blame per symbol, co-change, reverts, incidents, ADRs, hotspots, owners
     L3 semantic summaries, architecture, conventions, run-book, domain glossary
     L4 intent   intent vector over 7 kinds, entropy gate (single / blended / probe → clarify)
     L5 compiler policies, sufficiency expansion, knapsack, tiers, stages, agent prompt
     L6 govern   tool-call budgets, cache, loop guard, utilisation, skills
        │
   .riaf/index.sqlite                         ~/.claude/projects/<repo>/*.jsonl (read only)
```

- **One service per repository.** The extension starts it from the bundled CLI (`dist/riaf/riaf.mjs`) using VS Code's own runtime (`ELECTRON_RUN_AS_NODE`), so no separate Node.js install is needed. VS Code, Claude Code (through MCP and hooks), the CLI and the console all talk to the same service.
- **Incremental indexing.** Files are content-hashed. Each stage (scan, parse, graph, history, summaries, optional language servers) redoes only what changed.
- **Reading intent.** Every request becomes a probability over *bug fix, feature, refactor, review, merge, onboarding* and *unclear*, from an intent lexicon plus IDE signals (stack traces, failing tests, diffs). Low entropy means one clear policy; two strong kinds are blended. An unclear reading probes the code, then asks one question or builds a generic pack.
- **Compiling.** Each kind of work has its own retrieval policy: where to start, how to expand (callers, callees, tests, sibling templates, co-change partners and more), which history to include, and how to split the budget. The compiler stops as soon as the pack is sufficient.
- **The agent prompt.** The pack is wrapped in the sectioned prompt from [§4](#4-from-prompt-to-claude-code-in-detail). Its token plan blends the per-intent settings by the route's weights:
  - usable window = context window × use ratio,
  - headroom = usable − prompt − reply − reasoning.
- **Following Claude Code.** The console tails Claude Code's own session logs, read-only. Nothing is written to Claude Code's files, and no hook is needed to see a session live.

---

## 11. Privacy and security

- **Local by default.** The index, the service and the console run on your machine. Code leaves it only if you configure a model adapter, and then only to the endpoint you configured.
- **No downloads, no native code.** Everything ships in the extension: WebAssembly runtimes and grammars.
- **Secrets stay in the environment.** API keys are referenced by environment variable name only.
- **Hooks fail open and never escalate.** They can serve, checkpoint or block a tool call, but never grant a permission.
- **Read-only on Claude Code.** The console only reads Claude Code's session logs.
- **Explicit hand-offs.** Claude Code is started only when you press *Export to Claude Code*. You approve its steps in the terminal as usual.

---

## 12. Requirements

- **VS Code** 1.95 or later. No separate Node.js is needed for the extension.
- **Claude Code CLI** (`claude`) on your machine, for *Export to Claude Code*. RIAF finds it on your `PATH` or through your login shell (nvm and Homebrew installs work).
- **GitHub Copilot Chat**, for the `@riaf` participant and the `#riaf*` tools.
- **Languages indexed out of the box:** TypeScript and JavaScript, Python, Java, Go, C, C++, C#.
- **Git history** is used when the folder is a git repository. Without it, history-based features are empty.

---

## 13. Troubleshooting

| Symptom | What to do |
| --- | --- |
| Status bar shows **⚠ RIAF** | Hover for the error. Run **RIAF: Re-index repository**, or **RIAF: Open console**, which restarts the service. |
| The console says *Starting RIAF…* for long | The first index of a large repository is running; the status bar shows files left |
| A prompt reads as *Not clear yet* | Name the part of the code or say what should change, or click the right kind of prompt under *Not right? Compile it as* |
| **Export** says the `claude` command was not found | Install Claude Code, or make sure `claude` works in a new terminal. Then use **Copy shell command** meanwhile. |
| Nothing happens in Terminal on macOS | Allow the console to control Terminal when macOS asks (System Settings → Privacy & Security → Automation). A slow shell start-up can take up to a minute. |
| A run stays *Sent* | Claude Code has not started a session in this repository with that prompt yet. If you started it by hand, make sure it was in the repository folder and began with the launch message. |
| Two RIAF prompts appear in one Claude Code session | The repository still has v1 hooks; re-run **RIAF: Initialise repository** |
| Wrong repository in the console | **RIAF: Open repository…** or the repository pill at the top of the console's menu |

---

## 14. Developing the extension

### Package layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | Activation: status bar, LM tools, `@riaf` participant, commands, console panel, Claude Code launch (VS Code terminal process) |
| `src/client.ts` | Connects to (or starts) the repository's service from the bundled CLI |
| `src/tools.ts` | The five language-model tools (definitions shared with `package.json`) |
| `src/participant.ts` | The `@riaf` chat participant and hand-off prompts |
| `src/consoleHost.ts` | Every console request, answered from the service; pure and tested |
| `src/ask.ts`, `src/askHost.ts` | Plain-language question layer: lens parsing, evidence gathering, answer composition |
| `src/runs.ts` | Prompt-run registry, launch messages, keying sessions to prompts, run results (reply, diffs, commands, activity) |
| `src/terminal.ts` | Starting Claude Code without typing: launch scripts, VS Code terminal options, Terminal/iTerm/Linux/Windows launchers |
| `src/claudeLive.ts` | Tails Claude Code session logs; captures code edits |
| `src/workflow.ts` | Turns a session into turns and stages |
| `src/savings.ts`, `src/suggest.ts` | Savings model; suggested tasks |
| `webview/main.tsx`, `kit.tsx`, `api.ts`, `console.css` | Console shell, components, message bridge, Bosch design tokens |
| `webview/pages/*.tsx` | Pages: `overview` (Home), `hubs` (Repository and Governance tabs), `prompt`, `claude`, `live`, `savings`, `repository`, `ask`, `health`, `governance`, `policies`, `adapters`, `repos` |
| `test/*.test.ts` | Unit and integration tests (console host, runs, launcher, ask, savings, live, workflow, extension activation with a mocked VS Code API) |

### Build, test, package

From the repository root:

| Command | Does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm build` | Build every package (TypeScript project references) |
| `node tooling/esbuild/build.mjs webview` | Bundle the console webview |
| `pnpm typecheck:webview` | Type-check the console |
| `pnpm verify` | Build, type-check, lint, all tests, schema check (must be green before a commit) |
| `pnpm package:vsix` | Produce `dist-bundle/riaf-vscode-v2-0.4.0.vsix` |

### Run the console in a browser

```bash
pnpm build && pnpm console:dev
```

This serves the console at http://127.0.0.1:5199 against a real service on a seeded copy of the `toll-ts` example repository.

| Option | Effect |
| --- | --- |
| `--port N` | Use another port |
| `<path>` | Use your own repository instead of the seeded example |
| `--no-seed` | Skip seeded sessions and packs |
| `RIAF_DRY_LAUNCH=1` | *Export to Claude Code* logs the launch instead of opening a terminal (demos, tests) |
| `RIAF_CLAUDE_DIR=<dir>` | Read Claude Code session logs from another folder (to replay recorded sessions) |

After changing host code (`src/*.ts`), rebuild and restart `console:dev`. For webview-only changes, re-bundle the webview and reload the page.

### Conventions

- The extension stays thin: logic lives in the service packages, and the extension wires it in.
- Every console request is handled in `consoleHost.ts` and covered by a test.
- Write everyday words in the UI. Engineering detail (scores, entropy, rule ids) belongs in secondary views.
- Never type into a terminal to start a process. Start the process (see `terminal.ts`).

---

## 15. Release notes

### 0.4.0

- **Six-page console:** Home, Repository (Browse / Ask / Health), Prompt, Claude Code (Runs / Live console), Savings, Governance, with the Bosch MPS supergraphic.
- **Live prompt type** while you type, with a one-click override.
- **Detailed agent prompt** after intent routing and compilation, with explicit, editable token settings (`.riaf/tokens.yaml`).
- **Export to Claude Code:** Claude Code starts in a terminal in the repository with the full prompt, without typing into any terminal.
- **Prompt runs keyed to Claude Code sessions:** reply, per-file diffs, commands, live activity.
- **Code health:** load-bearing parts, untested hubs, import cycles, hotspots, owners and bus factor, domain glossary.
- **Plain-language Ask** for product owners.
- **Savings:** measured results and a team estimate.
- **Better intent reading** for everyday wording ("build a new feature", "enhance", "refactor", "not updating", "is broken").

---

## 16. License

MIT. Copyright © 2026 Bosch Mobility Platform and Solutions.
