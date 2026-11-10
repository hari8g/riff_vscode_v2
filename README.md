# RIAF v2 — Repository Intelligence for AI-assisted Engineering

**RIAF gives every person and every AI assistant working on a code base the right context at the right moment, and nothing more.**

RIAF indexes a repository on your own machine: its structure, its change history and what each part means. It then answers two kinds of need:

- **People** (developers, product owners, analysts, engineering managers) ask questions in plain language in the **RIAF Console** and get answers grounded in the real code. Examples: *How does dispute handling work? What would break if we change pricing? Who knows the ledger best?*
- **AI assistants** (Claude Code, GitHub Copilot, or any model) receive a small, budgeted **context pack** that lists the exact code, history and team rules a task needs, plus a short list of what they may still need to look up. The assistant starts in the right place instead of spending most of its budget searching.

Everything runs locally. Nothing is sent anywhere unless you connect an AI model yourself.

> Built for Bosch Mobility Platform and Solutions (MPS), first applied to **MLFF — Multi-Lane Free Flow tolling**. The example repository used throughout this document (`toll-ts`) is a small tolling service included in `fixtures/`.

---

## Contents

1. [Why RIAF exists](#1-why-riaf-exists)
2. [Who it is for](#2-who-it-is-for)
3. [Results so far](#3-results-so-far)
4. [Quick start](#4-quick-start)
5. [The RIAF Console](#5-the-riaf-console)
6. [Ask a question: the plain-language layer](#6-ask-a-question-the-plain-language-layer)
7. [Using RIAF with Claude Code](#7-using-riaf-with-claude-code)
8. [Using RIAF in VS Code with GitHub Copilot](#8-using-riaf-in-vs-code-with-github-copilot)
9. [Command-line reference](#9-command-line-reference)
10. [How RIAF works](#10-how-riaf-works)
11. [Configuration](#11-configuration)
12. [Architecture and packages](#12-architecture-and-packages)
13. [Privacy and security](#13-privacy-and-security)
14. [Evaluation: how the numbers are measured](#14-evaluation-how-the-numbers-are-measured)
15. [Developing RIAF](#15-developing-riaf)
16. [Troubleshooting and FAQ](#16-troubleshooting-and-faq)
17. [Limitations and roadmap](#17-limitations-and-roadmap)
18. [Glossary](#18-glossary)
19. [License](#19-license)

---

## 1. Why RIAF exists

Enterprise teams adopting AI coding assistants keep running into the same problem: **the assistant spends most of its effort rediscovering the repository.** Before it can fix a bug or add a feature, it has to work out:

- where the relevant code lives,
- what calls what, and what would break,
- why a line looks the way it does (a past incident, a reverted fix, an architecture decision),
- which test to copy and how the project is built,
- which team conventions apply.

Each of those discoveries costs tool calls, tokens, money and time, and the assistant still misses things. Across a team the waste multiplies, and the people who are not developers (product owners, analysts, managers) have no practical way into the code at all.

RIAF solves this once, locally, for everyone:

| Principle | What it means in practice |
| --- | --- |
| **Index once, reuse everywhere** | One local service per repository holds the index. VS Code, Claude Code, the command line and the console all ask the same service. |
| **Intent is a distribution, not a label** | "Fix the null check and add a config flag" is part bug fix and part feature. RIAF reads every request as a mix of intents and blends the retrieval rules to match (see [§10.3](#103-reading-intent)). |
| **Smallest sufficient context** | The compiler stops adding context as soon as the pack is sufficient. The budget is a ceiling, not a target. |
| **Provenance on everything** | Every item in a pack says where it came from and why it was included. Every console answer lists its sources. |
| **Local-first and proxy-friendly** | No native modules and no downloads at install or run time. SQLite and tree-sitter run as WebAssembly, so RIAF installs behind a corporate proxy. |
| **Measured, not claimed** | Every milestone closed on numbers from a frozen evaluation set. Estimates are labelled as estimates. |

---

## 2. Who it is for

| Role | What they use | What they get |
| --- | --- | --- |
| **Developer** | VS Code with Copilot, Claude Code, the CLI | A context pack before starting a task, jump-to-definition across the index, impact analysis, "why is this line like this?" |
| **Product owner / analyst** | Console → *Repository* → *Ask* | Plain-language answers about how features work, what a change would affect, who knows an area, and a first-cut size for a new request with a ticket brief |
| **Engineering manager** | Console → *Savings*, *Home* | Measured savings against working without RIAF, a team cost calculator, live usage counts |
| **Platform / tooling team** | `.riaf/policies.yaml`, `.riaf/governance.yaml`, `.riaf/tokens.yaml`, Console → *Governance* | Versioned retrieval rules, tool-call budgets and loop guards for AI sessions, utilisation data for tuning |
| **AI assistant** | MCP tools, Copilot language-model tools, hooks | The right files, history and conventions in one call; answers to searches straight from the index; a nudge when it starts going in circles |

---

## 3. Results so far

All results come from the evaluation harness described in [§14](#14-evaluation-how-the-numbers-are-measured). It uses **30 frozen tasks across 4 fixture repositories** (TypeScript, Java, Python and embedded C). Full reports are in `docs/eval/`.

### Context quality and cost

| How the assistant gets its context | Right files found (recall) | Context per task | Steps (tool calls) per task |
| --- | --- | --- | --- |
| Search and read, without RIAF (scripted baseline) | 86.8 % | 2.9k tokens | 11.5 |
| **RIAF context pack** | **97.1 %** | **1.5k tokens (−49 %)** | **1** |

### Claude Code without RIAF (measured, paid run)

| Measure | Value |
| --- | --- |
| Tasks passed | 27 / 27 counted (100 %) |
| Mean tokens per task (whole session) | 246k |
| Mean tool calls per task | 8.2 |
| Cost per task | $0.23 (total $6.99 for 30 tasks) |
| Recall | 96.7 % |

Claude Code alone already passes every counted task. **RIAF's value therefore shows up in effort and cost rather than pass rate.** The same Claude Code run *with RIAF attached* has **not been measured yet**. The Savings page of the console shows its effect as a clearly labelled, adjustable **estimate** (for example: 10 developers × 6 AI tasks a day × 21 days ≈ $294 → $165 a month if RIAF removes half of the search steps).

### Milestone gates

| Milestone | Result |
| --- | --- |
| M0 bootstrap | Store round-trips 10k blobs; full-text query warm < 20 ms |
| M1 structural core | 100k lines of code indexed cold in 8 s (gate 60 s); a warm run touches 0 blobs; reference resolution ≥ 95 % on all fixtures |
| M2 harness | 30 verified tasks over 4 fixture repos; frozen scripted baseline |
| M3 compiler + MCP | 97.1 % file recall, 49 % fewer tokens, 1 tool call; 12 golden packs stable |
| M4 history | History adds 0.7 % to an incremental edit; the culprit commit reaches 12 of 14 bug-fix packs |
| M5 governance | Hooks verified against a live daemon; learned skills reused in 15 of 30 tasks (offline simulation) |
| M6 extension | 2.7–2.8 MB `.vsix` with 0 native files; the bundled CLI runs from an empty directory |

---

## 4. Quick start

RIAF needs **Node.js 20+** for the CLI. The VS Code extension uses VS Code's own runtime, so it needs no separate Node.js install. Supported languages out of the box: **TypeScript/JavaScript, Python, Java, Go, C, C++ and C#**.

### 4.1 VS Code (with or without Copilot)

1. Build or download the extension: `pnpm package:vsix` produces `dist-bundle/riaf-vscode-v2-<version>.vsix`.
2. Install it: **Extensions → … → Install from VSIX…**, or

   ```bash
   code --install-extension dist-bundle/riaf-vscode-v2-0.4.0.vsix
   ```

3. Open your repository folder. The status bar shows **RIAF n files** once the first index has finished (seconds for most repositories).
4. Run **RIAF: Open console** from the command palette. Describe a task on *Home*, or open *Repository* to read the code.

### 4.2 Claude Code

From the repository root:

```bash
riaf init --host claude
```

Then start `claude` in the repository and approve the project's MCP server and hooks once. Details are in [§7](#7-using-riaf-with-claude-code).

### 4.3 Command line only

```bash
pnpm bundle
node dist-bundle/riaf-cli/riaf.mjs doctor
```

Then try:

```bash
node dist-bundle/riaf-cli/riaf.mjs pack "fix the off-by-one in Gantry.lane"
```

### 4.4 Try the console in a browser, no install

```bash
pnpm install && pnpm build && pnpm console:dev
```

This opens the console at <http://127.0.0.1:5199> against a real RIAF service. The service runs on a copy of the `toll-ts` example repository, with sample history and AI sessions already loaded.

---

## 5. The RIAF Console

The console is the visual home of RIAF. Open it with **RIAF: Open console** in VS Code, or in a browser with `pnpm console:dev`. It follows the Bosch design language: the supergraphic band, Bosch blue for actions, red only for warnings, square 4 px corners, and light and dark themes that follow VS Code.

### 5.1 Six pages, one flow

The menu follows the path from code to change:

| Page | What it is for |
| --- | --- |
| **Home** | Starting point: the repository and its status, one box to describe a task, the four steps (read → compile → run → measure) with live numbers, and the latest runs |
| **Repository** | Read the code: **Browse** (areas, summaries, any part's dependants, tests and history), **Ask** (plain-language questions, [§6](#6-ask-a-question-the-plain-language-layer)) and **Health** (load-bearing parts, missing tests, hotspots, owners, domain words). *Open another repository* switches the folder RIAF reads. |
| **Prompt** | Compile a task into the agent prompt and export it to Claude Code |
| **Claude Code** | What Claude Code did for each prompt, plus the live console |
| **Savings** | Measured savings and an adjustable estimate ([§3](#3-results-so-far)) |
| **Governance** | **AI activity** (tool-call decisions, priors, utilisation), **Rules** (`policies.yaml`, `governance.yaml`) and **Setup** (service, models) |

### 5.2 Compile a prompt and export it to Claude Code

On **Prompt** (or straight from the box on Home), describe the change and press **Compile**. Four steps light up with real values:

1. **Read the task:** the kind of work and its mix (*Bug fix 51 % · Feature 49 %*).
2. **Gather the context:** pieces of code and history, and tokens used against the budget.
3. **Build the prompt:** sections, total tokens, and whether Claude Code must show its plan first.
4. **Run in Claude Code:** **Export to Claude Code**. In VS Code this opens a terminal running `claude` with the prompt. In a browser the console shows the exact command to copy.

The compiled prompt has three tabs:

- **Prompt:** a table of contents with token counts per section (cached sections marked) and the full text.
- **Context:** the gathered pieces by group, each openable.
- **Token budget:** the context-window bar, the budget by kind of work, the plan gate and the token-settings editor ([§11.5](#115-riaftokensyaml-the-agent-prompts-token-settings)).

Every compiled prompt is stored in `.riaf/prompts/<promptId>.md`, which is runtime state and not committed. The text Claude Code receives starts with a marker, `[RIAF pr_…]`, followed by the task and a pointer to that file.

### 5.3 Claude Code: runs keyed to prompts, and the live console

**Runs** lists every prompt, newest first, with its status: *Compiled*, *Sent*, *Running*, *Done* or *Needs a look*. RIAF links a Claude Code session to its prompt in two ways:

- **Exported from the console:** the session's first message carries the `[RIAF pr_…]` marker.
- **Typed straight into Claude Code:** the RIAF prompt hook injects the agent prompt and records the session it went into.

Selecting a run shows:

- **Summary numbers:** files changed, commands, steps, failed steps and time.
- **Claude Code's reply.**
- **The code it wrote:** every Edit, MultiEdit and Write as a diff per file, with removed lines red and added lines green.
- **The commands it ran,** with OK or FAIL.
- **The prompt that was sent,** on request.

A run that hasn't started yet shows the command to start it. The view updates live while Claude Code works.

**Live console** follows every Claude Code session in the repository as it happens: turns, stages (context, explore, plan, edit, verify, run, delegate), files, commands, failures and the raw activity stream. Sessions started from a RIAF prompt carry a *RIAF prompt* badge. The console only reads Claude Code's own session logs and never writes to them.

### 5.4 Keyboard

| Keys | Action |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> | Search: jump to a page or to any part of the code |
| <kbd>g</kbd> then <kbd>h</kbd> / <kbd>r</kbd> / <kbd>p</kbd> / <kbd>c</kbd> / <kbd>s</kbd> / <kbd>g</kbd> | Home / Repository / Prompt / Claude Code / Savings / Governance |
| <kbd>/</kbd> | Start a new prompt |
| <kbd>Enter</kbd> on Home, <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>↵</kbd> on *Prompt* | Compile |

---

## 6. Ask a question: the plain-language layer

*Ask a question* is built for people who do not read code. You type a question in your own words. RIAF works out what kind of answer you want, finds the parts of the product involved, gathers evidence from the index, and writes an answer with pictures and sources. It shows every step of how it got there.

### 6.1 Seven kinds of answer

RIAF reads each question as a mix of seven **lenses**:

| Lens | Typical questions | What the answer shows |
| --- | --- | --- |
| **How it works** | *How does a dispute get resolved?* · *What happens when a reading is rejected?* | The parts involved and what each does, how they fit together, and where they live |
| **What a change affects** | *What would be affected if we change TollSession?* · *What breaks if we turn off the flags?* | Rings of the parts that depend on it, the areas they belong to, the automated checks that would catch a break, and a change-risk gauge with its reasons |
| **What changed and why** | *What changed in pricing recently and why?* | A timeline of changes with type, author and date. Rollbacks and incidents are flagged, and recorded decisions (ADRs) are shown. |
| **Who knows it** | *Who knows the most about the ledger?* | The people with the most changes, their share of the history and when they last worked on it |
| **Plan a request** | *We want to add a monthly pass discount for frequent drivers. How big is that?* | A rough size (S/M/L/XL), what drives it, concepts that do not exist in the code yet, questions to settle first, and a ready-to-paste ticket brief |
| **Risk and testing** | *How well tested is plate validation?* | The automated checks that cover it, coverage across dependent parts, and the risk gauge |
| **Map of the product** | *What are the main areas of this product?* | Product areas sized by number of files, with a summary of each |

### 6.2 While you type

The *Understood as* strip updates live:

- The words that signal each kind of answer are **highlighted** in the colour of their lens.
- The reading is either a single lens (*"Who knows it"*), two lenses together (*"What a change affects, and what changed and why"*), or *"Not sure yet. Pick what you want below"*.
- Seven buttons show the kinds of answer, most likely first. **Click one to steer the reading**; click it again to release it.
- **About** lists the subjects RIAF spotted: names from the code (`TollSession`), product areas (*Pricing*), plain phrases (*frequent drivers*) and time ranges (*last month*, *recently*).

### 6.3 How a question is answered

Each answer shows a strip titled **How RIAF answered**, with the steps it took:

1. **Understand the question.** Pick the kind of answer and any time range. In parallel, the RIAF router reads the developer intent.
2. **Find what it is about.** Look up every candidate part. Rank them by named code, word overlap (for example *"plate validation"* matches `validatePlate`), the kind of part, the area the question named, and the router's own grounding. Keep the best.
3. **Gather the evidence.** Fetch only what the chosen lenses need: impact and automated checks, change history and decisions, and area summaries.
4. **Prepare context for a developer.** Only for *How it works* and *Plan a request*: build a context pack, so the same question can be handed to a developer or AI assistant.
5. **Write the answer.** Compose a headline, short paragraphs and the visual views, and list the sources.

Click a step to see the exact lookups and timings, and open **Behind the scenes** for the lens scores, entropy, developer intent and pack size.

### 6.4 What you can do with an answer

- **Ask next.** Follow-up questions about the same subject through the other lenses, one click each.
- **Not what you meant? Show me…** Re-ask the same question through a different lens.
- **Sources.** Each source opens in *Repository → Browse*.
- **Copy answer.** Copies the whole answer as Markdown for a ticket, wiki page or chat.
- **Copy ticket brief** *(Plan a request)*. Copies the request, likely areas, parts involved, rough size, open questions and an acceptance-criteria section.
- **Hand to Claude Code / Copilot.** Sends the question with its prepared context to a developer's AI assistant.
- **Confidence.** *High* when the question named things RIAF found exactly. *Medium* when it matched by words or the question mixed two kinds of answer. *Low* when little matched.

### 6.5 Good to know

- Answers are **assembled from the index, not generated by a language model.** Every statement traces back to code, history or a recorded decision, and nothing is invented. The trade-off is that the wording is more template-like than a chatbot's.
- **Sizes and risk levels are rough guides** computed from simple, visible factors (parts involved, areas, dependents, automated checks, new concepts, rollbacks). They are a starting point for refinement, not an estimate.
- If a name does not exist in the code, RIAF says so, and for a request treats it as a **new concept**.

---

## 7. Using RIAF with Claude Code

### 7.1 Set up a repository

```bash
riaf init --host claude        # or: --host copilot | both
```

This writes:

| File | Purpose |
| --- | --- |
| `.riaf/policies.yaml` | Retrieval rules: how requests are read and which context each intent needs |
| `.riaf/governance.yaml` | Tool-call budgets, loop guard, cache and compaction advice for AI sessions |
| `.riaf/tokens.yaml` | Token settings for the agent prompt: model window, per-intent pack and reply budgets, plan gate ([§11.5](#115-riaftokensyaml-the-agent-prompts-token-settings)) |
| `.riaf/constraints.md` | Team rules and the definition of done, written by people |
| `.riaf/runbook.md` | Generated run-book (commands, layout, conventions), imported from `CLAUDE.md` |
| `.mcp.json` | Registers the `riaf` MCP server |
| `.claude/settings.json` | Governance hooks (skip with `--no-hooks`) |
| Slash commands | `/riaf-pack`, `/riaf-jump`, `/riaf-impact`, `/riaf-history` |

Start `claude` in the repository and approve the project's MCP server and hooks once. To install as a plugin instead:

```bash
riaf plugin --out ~/riaf-plugin
```

Then add it with `/plugin` in Claude Code.

### 7.2 MCP tools

| Tool | What the assistant gets |
| --- | --- |
| `riaf_pack` | A compiled context pack for a task, rendered for Claude |
| `riaf_jump` | Definition, references, blame and learned skills for a name or `path:line` |
| `riaf_impact` | Dependents, covering tests and co-change partners of one or more parts |
| `riaf_history` | The commits that own a part's lines, or *why* it is the way it is (reverts, incidents, ADRs) |
| `riaf_wiki` | The repository structure, or the page for one directory or file |

### 7.3 Hooks: governing an AI session

The hooks **fail open**: if RIAF is unavailable, Claude Code carries on as normal. They never grant extra permissions.

| Hook | What RIAF does |
| --- | --- |
| `SessionStart` | Opens a governed session |
| `UserPromptSubmit` | Routes the prompt, compiles the pack and injects the **detailed agent prompt** ([§10.6](#106-the-agent-prompt-and-its-token-plan)). If the prompt continues the same task, it keeps the earlier one. |
| `PreToolUse` | Checks the call against the phase budget. Answers `grep`/`glob` from the index when that is cheaper, and repeated reads of unchanged files from the cache. Asks the assistant to checkpoint at a soft limit, and blocks a loop of identical calls. |
| `PostToolUse` | Records the result: which delivered items were actually read or edited |
| `Stop` | Ends the session. Records utilisation, updates the intent priors and distils reusable skills from what worked. |

---

## 8. Using RIAF in VS Code with GitHub Copilot

- **Chat participant:** type `@riaf <task>` in Copilot Chat. RIAF compiles the context, explains how it read the task, and offers to continue in **Copilot agent mode** or **open in Claude Code**.
- **Language-model tools** for agent mode: `#riafPack`, `#riafJump`, `#riafImpact`, `#riafHistory`, `#riafWiki`.
- **Commands** (command palette):

| Command | Does |
| --- | --- |
| RIAF: Open console | Opens the console described in [§5](#5-the-riaf-console) |
| RIAF: Compile context pack | Compiles a pack for a task you type |
| RIAF: Jump to symbol | Jumps to a definition from the index |
| RIAF: Re-index repository | Rebuilds the index now |
| RIAF: Initialise repository | Same as `riaf init` |
| RIAF: Continue in Copilot agent mode | Hands the current pack to Copilot |
| RIAF: Open in Claude Code | Hands the current pack to Claude Code |

- **Settings:**

| Setting | Default | Meaning |
| --- | --- | --- |
| `riaf.budget` | `16000` | Token ceiling for compiled packs |
| `riaf.models` | `{}` | Optional model adapters per job (`summarize`, `classify`, `embed`, `chat`); see [§11.4](#114-ai-models-optional) |

---

## 9. Command-line reference

```
riaf <command> [options]          global: --root <dir>  --in-process  --json
```

| Command | Purpose | Example |
| --- | --- | --- |
| `index [--full] [--stages a,b]` | Index the repository; incremental by default | `riaf index` |
| `status` | Index health and stage progress | `riaf status --json` |
| `jump <name\|Name.member\|path:line>` | Definition and references | `riaf jump TollSession.close` |
| `impact <name>… [--hops N]` | Dependents, tests, co-change partners | `riaf impact validatePlate --hops 2` |
| `pack "<request>" [--budget N] [--render …] [--intent X]` | Compile a context pack (`claude`, `copilot`, `fragment`, `json`, `agentsmd`) | `riaf pack "add GET /disputes/next" --render copilot` |
| `wiki [node]` | Repository structure, or one directory or file page | `riaf wiki src/pricing/` |
| `history <name\|path> [--why]` | Commits owning a part's lines, or why it is the way it is | `riaf history Ledger.post --why` |
| `prompt "<request>" [--host claude\|copilot\|generic] [--budget N] [--plan\|--json]` | The detailed agent prompt RIAF injects, or its token plan (`--plan`) | `riaf prompt "fix Gantry.lane" --plan` |
| `runbook [--write]` | Print or regenerate `.riaf/runbook.md` | `riaf runbook --write` |
| `init [--host claude\|copilot\|both]` | Set up a repository ([§7.1](#71-set-up-a-repository)) | `riaf init --host both` |
| `mcp [--http PORT]` | Serve the MCP tools (stdio for Claude Code) | `riaf mcp` |
| `plugin --out DIR` | Write an installable Claude Code plugin | `riaf plugin --out ~/riaf-plugin` |
| `doctor` | Check runtime, grammars, index, policies, language servers | `riaf doctor` |
| `serve [--detached] [--lsp]` | Run the repository service in the foreground | `riaf serve --lsp` |
| `eval [--runner …] [--golden\|--approve-golden]` | Run the evaluation set or check golden packs | `riaf eval --runner scripted,compiler` |

By default the CLI talks to the running RIAF service for the repository and starts one if needed. `--in-process` opens the index directly in the CLI process.

---

## 10. How RIAF works

### 10.1 The layers

```
 L0  store      SQLite (wasm): content-addressed blobs, Merkle table, full-text and trigram search, a vector table reserved for embeddings
 L1  parse      tree-sitter tags, chunks, import resolution, optional language-server enrichment
 L1  graph      structural graph of symbols and edges, personalised-PageRank repo map, closure, impact,
                insights: load-bearing hubs, tangled code, untested hubs, unused definitions, import cycles
 L2  history    git mining: blame per symbol, co-change, reverts, incidents, ADRs, commit summaries,
                hotspots (recency-weighted churn, fix share) and ownership with a bus factor
 L3  semantic   bottom-up summaries, architecture map, conventions, run-book, domain glossary
 L4  intent     decomposer, intent vector, entropy gate, probe, policy composer
 L5  compiler   primitive policies, sufficiency expansion, knapsack, tiers, stages, renders, the agent prompt
 L6  govern     tool-call budgets, cache, loop guard, telemetry, skill distillation
```

### 10.2 Indexing is incremental

Files are content-hashed. Each stage (scan → parse → graph → history → summaries → language servers) keeps its own *done* marker per blob and redoes only what changed. A warm run on an unchanged repository touches no blobs; an edit re-processes only the affected files and their summaries. The index lives in one file, `.riaf/index.sqlite`. It is runtime state and is never committed.

### 10.3 Reading intent

Every request is decomposed into task units. Each unit gets an **intent vector**: a probability over *bug fix, feature, refactor, review, merge, onboarding* and *unclear*. The normalised **entropy** H of that vector decides how the request is served:

| Entropy | Branch | What happens |
| --- | --- | --- |
| H < 0.35 and top intent ≥ 0.70 | **single** | Use that intent's retrieval policy |
| H < 0.70 | **blended** | Combine the policies of the leading intents, weighted by probability |
| H ≥ 0.70 | **probe** → **clarify** or **generic** | Look at the grounded code and rescore. If still unclear, ask one question (interactive) or build a generic pack (unattended). |

Intent priors learned from past sessions in the repository are blended half-and-half with a uniform prior, so routing adapts without drifting. The design is in `docs/adr/0003-intent-as-distribution.md`.

### 10.4 Compiling a pack

Each intent has a **primitive policy** in `.riaf/policies.yaml`:

- **anchors:** where to start, such as a stack trace, a failing test or a sibling feature,
- **expansion rules:** callers, callees, exercising tests, co-change partners, sibling templates, inheritance and more,
- **history scope:** blame on the anchors, reverts, incidents, ADRs,
- **budget weights:** how the budget is shared between the above.

The compiler expands from the anchors and scores every candidate. It packs them with a knapsack under the token budget and **stops at sufficiency**. Items are placed in four tiers:

1. **Orientation:** repository map and summaries
2. **Code:** in dependency-ordered stages
3. **History and conventions**
4. **Run-book:** how to build and test

Every item records its source, hash, rule, intent, weight and score. The pack also lists **open lookups**: what the model may still need to fetch. Renders exist for Claude, Copilot, any model (a system-prompt fragment), JSON and `AGENTS.md`.

### 10.5 What the knowledge layers add

- **L1 graph insights** (`graph.insights`):
  - **Fan-in and fan-out** per definition, ignoring a member's use of its own class.
  - **Load-bearing hubs.**
  - **Tangled code:** high fan-out.
  - **Untested hubs:** classes, functions and methods with fan-in of 2 or more that no test reaches directly or through their class.
  - **Unreferenced definitions:** constructors, members of used classes and entry files excluded.
  - **Import cycles:** Tarjan's strongly connected components over file imports.
- **L2 hotspots and ownership** (`history.hotspots`):
  - Files or areas ranked by churn, weighted by recency with a 90-day half-life from the newest commit.
  - The share of commits that were fixes, the owners by share of commits, and the **bus factor**: the fewest people who made more than half of the changes.
  - Documentation and lock files are skipped by default.
- **L3 domain glossary** (`semantic.glossary`):
  - Business words mined from symbol names, doc comments and directory names, with generic programming words removed.
  - Each word lists where it is defined, the areas it spans, and a one-line meaning from the best doc comment.
  - Plain phrases map onto it: *"plate validation"* finds `plate` and `validate`.

These facts feed the console's *Code health* page and the **What to watch** section of every agent prompt.

### 10.6 The agent prompt and its token plan

After the intent router and the context compiler have run, RIAF wraps the pack in a **detailed agent prompt**. The design is ADR-0005, inspired by the v1 console's prompt instruction. Sections, in order:

| # | Section | Contents | Cached |
| --- | --- | --- | --- |
| 1 | How to work in this repository | Tool hints for the host (`riaf_jump`… for Claude Code, `#riafJump`… for Copilot) and five working rules | yes |
| 2 | Repository rules | Commands, hard constraints, conventions and definition of done from the run-book | yes |
| 3 | Reply format | Summary · files changed · tests run · risks | yes |
| 4 | Task | The request verbatim; how RIAF read it (intent mix, reading, certainty); its parts; a question to ask first if unclear | |
| 5 | Plan | Per-intent playbook steps, or stage-by-stage steps for multi-part tasks; a **plan gate** when a plan-first intent weighs ≥ 30 % | |
| 6 | Token and tool budget | Model window and planned use; prompt, pack, reply reserve, reasoning and headroom; budget mix by intent; when to summarise; the four phase budgets from `governance.yaml` | |
| 7 | What to watch | Load-bearing anchors, missing tests, hotspots, owners and bus factor, import cycles, and domain-term meanings | |
| 8 | Context pack | The compiled pack by tier and stage, with suggested lookups | |
| 9 | Before you finish | Per-intent definition of done, the test command and tests to run, constraints check | |

The stable sections come first, and their hash (`stableHash`) stays the same across tasks, so providers can cache that prefix. Each frame section is capped (`sections` in `tokens.yaml`).

The **token plan** is computed as follows:

- **Pack budget and reply reserve:** the per-intent settings, blended by the route's intent weights.
- **Usable window:** `context_window × use_ratio`.
- **Headroom:** `usable − prompt − reply − reasoning`.
- **Summarise at:** `(usable − reply − reasoning) × summarize_at`.

The Claude Code hook injects this prompt, `riaf prompt` prints it, and the console's *AI prompt* page shows and tunes it.

### 10.7 Governance and learning

During a Claude Code session the hooks ([§7.3](#73-hooks-governing-an-ai-session)) enforce the phase budgets in `.riaf/governance.yaml`. They serve repeated reads and searches from the index or cache, and stop loops. When the session ends, RIAF measures **utilisation**: which delivered items were really used. It feeds that into the intent priors and distils **skills** (short playbooks of what worked), which later packs can include.

---

## 11. Configuration

All configuration lives in `.riaf/` and is versioned with the code. RIAF validates every file against schemas in `packages/kernel/src/schemas` and refuses invalid edits.

### 11.1 `.riaf/policies.yaml`: how requests are read and served

```yaml
version: 1
router:
  entropy: { single_below: 0.35, blend_below: 0.70 }
  top_intent_min: 0.70
  blend_floor: 0.15            # intents below this weight do not join a blend
  clarify_max_questions: 1
budget:
  default_total: 16000
  fixed: { map: 2000, runbook: 1500 }
primitives:
  bugfix:
    anchors: [stack_trace, issue_terms, failing_test, selection]
    expansion:
      - { rule: callers, hops: 2 }
      - { rule: callees, hops: 2 }
      - { rule: exercising_test }
    history: [blame_on_anchors, reverts_touching_anchors]
    weights: { ingredients: 0.6, history: 0.4 }
  # feature, merge, review, refactor, onboarding, unknown …
```

Edits apply to the next request. Use **Governance → Rules** in the console for a visual editor with validation.

### 11.2 `.riaf/governance.yaml`: limits for AI sessions

```yaml
version: 1
phases:
  explore:   { soft_calls: 40, max_calls: 80,  soft_tokens: 120000, max_tokens: 250000, max_minutes: 30 }
  implement: { soft_calls: 80, max_calls: 200, soft_tokens: 250000, max_tokens: 500000, max_minutes: 90 }
guard:
  serve_repeat_reads: true      # identical re-reads of unchanged files come from the cache
  rewrite_grep_to_index: true   # answer grep/glob from the index when cheaper
  loop_threshold: 3             # identical calls in a row before blocking
compaction:
  advise_at_ratio: 0.7          # of the model's context window
```

A *soft* limit asks the assistant to checkpoint (reflect). A *max* limit blocks further calls in that phase.

### 11.3 `.riaf/constraints.md` and the run-book

`constraints.md` is written by people: hard rules and the definition of done. RIAF merges it into the generated `.riaf/runbook.md`, which records commands, layout, languages, frameworks, clusters and conventions detected from the code. Do not edit the run-book by hand. Regenerate it with `riaf runbook --write`.

### 11.4 AI models (optional)

RIAF indexes, reads intent, compiles packs and answers console questions **without any model**. Optional models improve commit summaries (`summarize`) and settle uncertain requests (`classify`). Configure them in `.riaf/models.json` for the service, or in `riaf.models` in VS Code:

```json
{
  "summarize": { "provider": "ollama", "model": "qwen2.5:7b" },
  "classify":  { "provider": "openai", "model": "gpt-4o-mini",
                 "baseUrl": "https://gateway.internal/v1", "apiKeyEnv": "GATEWAY_TOKEN" }
}
```

Providers: `anthropic`, `openai` (any OpenAI-compatible gateway, including corporate SSO gateways), `ollama`, and the Copilot language model inside VS Code. API keys are read from the named environment variable and never stored. Requests honour `HTTPS_PROXY` / `NO_PROXY`.

---

### 11.5 `.riaf/tokens.yaml`: the agent prompt's token settings

```yaml
version: 1
model: { name: claude-sonnet, context_window: 200000, use_ratio: 0.85 }
reasoning: 0                    # extended-thinking reserve (0 = off)
sections: { protocol: 800, plan: 900, notes: 700 }   # caps for the prompt frame
intents:                        # blended by the route's intent weights
  bugfix:     { pack: 16000, output: 8192,  plan_gate: false }
  feature:    { pack: 16000, output: 16384, plan_gate: true }
  merge:      { pack: 16000, output: 8192,  plan_gate: false }
  review:     { pack: 12000, output: 4096,  plan_gate: false }
  refactor:   { pack: 20000, output: 16384, plan_gate: true }
  onboarding: { pack: 8000,  output: 4096,  plan_gate: false }
  unknown:    { pack: 8000,  output: 4096,  plan_gate: false }
plan_gate_min_weight: 0.3
cache: { stable_prefix: true, ttl: 5m }
summarize_at: 0.6
```

`riaf init` writes this file. Without it RIAF uses these defaults. A setting where pack + reply + reasoning would not fit the usable window is rejected. The console's *AI prompt* page edits the file with presets: *Economy* halves the budgets and *Thorough* raises them by 50–75 %. `RIAF_HOOK_BUDGET` still pins the pack budget for the Claude Code hook.


## 12. Architecture and packages

```
packages/
  kernel      shared vocabulary: ids, hashing, tokens, events, ports, zod schemas (the contracts)
  store       L0  SQLite (wasm), migrations, Merkle table, FTS5, trigram, vector table (reserved)
  parse       L1  tree-sitter tags, chunker, import resolver, optional LSP enrichment
  graph       L1  structural graph, personalised PageRank repo map, closure, impact
  history     L2  git mining: blame per symbol, co-change, reverts, ADRs, commit summaries
  semantic    L3  bottom-up summaries, architecture map, conventions, run-book
  intent      L4  decomposer, intent vector, entropy gate, probe, policy composer
  compiler    L5  primitive policies, sufficiency expansion, knapsack, tiers, stages, renders
  govern      L6  tool-call budgets, tool cache, loop guard, telemetry, skill distillation
  models      adapters: Copilot LM, Anthropic, OpenAI-compatible gateway (SSO), Ollama
  daemon      the per-repository service: scheduler, watcher, JSON-RPC server, client SDK
  serve-mcp   MCP server, Claude Code hooks, plugin bundle
  cli         riaf index | pack | jump | impact | history | eval | doctor | serve | init | …
  extension   VS Code: language-model tools, @riaf participant, the RIAF Console
  eval        harness: tasks, runners, metrics, golden packs
```

**Dependency direction** is one way and enforced by lint:

```
kernel → store → {parse, graph, history, semantic} → intent → compiler → govern → daemon → {serve-mcp, cli, extension, eval}
```

Nothing imports upward or sideways. Cross-layer needs go through ports in `kernel/src/ports`.

**The service (daemon).** One process per repository owns the index (ADR-0001). VS Code, Claude Code (through MCP and the hooks), the CLI and the console are all clients over a local JSON-RPC protocol. The protocol is currently version 1.5 and evolves additively within a major version (ADR-0004). Every request and response is validated against zod schemas.

**The console.** The console is a React 18 app bundled with esbuild into a VS Code webview. It talks to the extension host via message passing, and the extension forwards requests to the service. The request handling (`packages/extension/src/consoleHost.ts`) is pure and tested. The plain-language layer lives in `src/ask.ts` (question parsing and answer composition, shared with the webview) and `src/askHost.ts` (the lookup plan). The savings model is in `src/savings.ts`.

**Architecture decisions** are in `docs/adr/`:

| ADR | Decision |
| --- | --- |
| 0001 | One service per repository owns the index |
| 0002 | sqlite-wasm by default; a native driver is optional |
| 0003 | Intent is a distribution; policies are composed, not selected |
| 0004 | The service RPC evolves additively within a protocol major |
| 0005 | A detailed agent prompt with explicit token settings |

More detail: `docs/architecture.md`, `docs/contracts/`, `docs/implementation-plan.md`.

---

## 13. Privacy and security

- **Local by default.** The index, the service and the console run on your machine. The console footer says so: *"Bosch internal · runs locally, nothing leaves this machine."*
- **No downloads, no native code.** Everything ships in the package: SQLite and tree-sitter as WebAssembly, plus the grammars. Nothing is fetched at install or run time.
- **Models are opt-in.** Code leaves the machine only if you configure a model adapter, and then only to the endpoint you configured.
- **Secrets stay in the environment.** API keys are read from environment variables you name, never from settings files.
- **Hooks fail open and never escalate.** If RIAF is unavailable, Claude Code works as normal. RIAF can serve, checkpoint or block a tool call, but never grants a permission the user has not given.
- **Runtime state is not committed.** `.riaf/index.sqlite` is excluded from version control.

---

## 14. Evaluation: how the numbers are measured

The harness in `packages/eval` measures every claim in this document.

- **Task set:** 30 verified tasks over four fixture repositories in `fixtures/repos/`: `toll-ts` (TypeScript), `fleet-java` (Java), `telemetry-py` (Python) and `embedded-c` (C). Each task has a request, an intent and gold files.
- **Runners:**
  - `scripted`: a deterministic search-and-read explorer without RIAF (the frozen baseline)
  - `compiler`: one RIAF pack
  - `claude`: headless Claude Code per task (paid; runs only when explicitly requested)
- **Metrics:** file-level recall and precision, tokens per task, tool calls per task, pass rate, cost and pack utilisation.
- **Golden packs:** 12 packs are frozen in `fixtures/golden-packs/`. `riaf eval --golden` fails if compilation changes them. `--approve-golden` re-approves them, and the change needs a reason in the commit.

Reproduce the free runs:

```bash
riaf eval --runner scripted,compiler          # writes reports/eval/report.{md,json}
riaf eval --golden                            # check golden packs
```

Reference results are in `docs/eval/reference.json`, `baseline.json` and `claude-baseline.json`. Milestone write-ups are in `docs/eval/*.md`.

> **Paid runs.** `riaf eval --runner claude` calls the Claude API and costs money (about $7 for the 30 tasks). It is never part of `pnpm verify` and is run only on request.

---

## 15. Developing RIAF

### 15.1 Prerequisites and setup

Node.js ≥ 20 and pnpm ≥ 9:

```bash
corepack enable
pnpm install
pnpm verify
```

### 15.2 Scripts

| Script | Does |
| --- | --- |
| `pnpm build` | TypeScript project build (`tsc -b`) of all packages |
| `pnpm typecheck:webview` | Type-checks the console webview |
| `pnpm lint` | ESLint, including the layer-boundary rules |
| `pnpm test` / `pnpm test:watch` | Vitest: unit, fixture and golden-pack tests |
| `pnpm schemas` / `pnpm schemas:check` | Generate / check JSON schemas from the zod contracts |
| `pnpm verify` | Build + webview typecheck + lint + tests + schema check; must be green before every commit |
| `pnpm bundle` | Self-contained CLI in `dist-bundle/` with the wasm runtimes and grammars beside it |
| `pnpm package:vsix` | `dist-bundle/riaf-vscode-v2-<version>.vsix` |
| `pnpm bench:index` | 100k-LOC indexing benchmark |
| `pnpm console:dev` | The console in a browser at <http://127.0.0.1:5199> against a real service on a seeded `toll-ts` copy (`--port`, `--no-seed`, or pass a repository path) |

### 15.3 Conventions and definition of done

- Read `docs/adr/` before changing `packages/kernel` or `packages/store`.
- Every contract is a zod schema in `packages/kernel/src/schemas`. Changing one needs a migration and an ADR.
- No native Node modules in anything that ships in the `.vsix`.
- New module → mirror it with `test/<module>.test.ts` in the same package. New public function → a one-line doc comment and a test.
- Conventional commit messages. Prefer small PRs: one package, its tests, and the ADR if a contract moved.
- Done means `pnpm verify` is green, and the golden packs are unchanged or re-approved with a reason.
- The repository dogfoods RIAF: `.riaf/policies.yaml` and `.riaf/governance.yaml` are live, and `CLAUDE.md` imports the generated run-book.

### 15.4 Working on the console

```bash
pnpm build && pnpm console:dev
```

- Source: `packages/extension/webview/` (`main.tsx` shell, `kit.tsx` components, `pages/*.tsx`, `console.css` Bosch tokens).
- Pages: `overview.tsx` (Home), `hubs.tsx` (Repository and Governance tabs), `prompt.tsx` (compile and export), `claude.tsx` (runs and live console), `savings.tsx`. Prompt runs live in `src/runs.ts`; Claude Code transcripts are tailed by `src/claudeLive.ts`.
- Keep wording in everyday language. `<Detail>` (from `useDetailed()`) still marks engineering-only detail.
- After changing host code (`packages/extension/src/*`), rebuild and restart `console:dev`. For webview-only changes, rebuild with `node tooling/esbuild/build.mjs webview` and reload.

---

## 16. Troubleshooting and FAQ

**The status bar or console says *Connecting…*.** The RIAF service has not started. Run `riaf doctor`. In VS Code, run **RIAF: Re-index repository**.

**Answers or packs miss recent code.** Press *Refresh* on Home (or run `riaf index`). Indexing is incremental and usually takes seconds.

**"Nothing found" on Explore or Ask.** Try the name used in the code, or describe it in other words. In *Ask a question*, RIAF tells you when a name does not exist in the code yet.

**History is empty.** The folder is not a git repository, or no commits own those lines yet.

**Claude Code does not use RIAF.** Check that `.mcp.json` and `.claude/settings.json` exist (`riaf init --host claude`) and that you approved the MCP server and hooks when Claude Code asked.

**Do I need an AI model or API key?** No. Models are optional ([§11.4](#114-ai-models-optional)).

**Does RIAF send my code anywhere?** No, unless you configure a model adapter ([§13](#13-privacy-and-security)).

**Where do I see what Claude Code changed?** On **Claude Code → Runs**: pick the prompt to see Claude Code's reply, the code it wrote as diffs and the commands it ran.

**Can I change how context is chosen?** Yes. Edit `.riaf/policies.yaml` directly or in **Governance → Rules**. Changes apply to the next request.

---

## 17. Limitations and roadmap

**Known limitations**

- The **Claude Code run with RIAF attached** has not been measured. Savings for that setup are an estimate.
- **No Bosch production repository** has been measured yet, and the planned **two-week pilot** has not run.
- In *Ask a question*, **size and risk** are heuristics. Answers are composed from templates, not written by a language model.
- **Embeddings** (semantic vectors) are not implemented yet; retrieval is structural, lexical and historical.
- **Organisation manifest indexers** are planned. **Single-executable binaries** were replaced by a portable CLI tarball.
- The console has been verified in a browser against the service. Verification inside every supported VS Code version is ongoing.

**Next steps**

1. Run the RIAF-attached Claude Code evaluation and replace the estimate with a measurement.
2. Measure a Bosch MLFF repository and run the two-week pilot with product owners and developers.
3. Tune *Ask* sizing and risk against real refinement outcomes. Optionally let a configured model rewrite answers in prose, keeping the sources.
4. Add optional embeddings, behind a flag, for repositories where names and wording differ a lot.

---

## 18. Glossary

| Term | Meaning |
| --- | --- |
| **Context pack** | The budgeted bundle of code, history, conventions and run-book that RIAF hands a developer or AI assistant for one task. |
| **Prompt run** | One compiled agent prompt and the Claude Code session that ran it, keyed by the `[RIAF pr_…]` marker or the prompt hook |
| **Intent / intent vector** | What kind of work a request is (bug fix, feature, …), held as a probability for each kind |
| **Entropy (H)** | How spread out the intent vector is. Low means clear, high means unclear. |
| **Branch** | How a request is served: single, blended, probe, clarify or generic |
| **Primitive policy** | The retrieval rules for one intent: anchors, expansion, history, weights |
| **Anchor** | Where the compiler starts: a named part, a failing test, a selection |
| **Tier** | Pack section: orientation, code, history and conventions, run-book |
| **Sufficiency** | The point at which the compiler stops adding context, below the budget |
| **Open lookup** | Something the model may still need to fetch, listed in the pack |
| **Lens** | In *Ask a question*, the kind of answer wanted (how it works, impact, history, people, plan, risk, map) |
| **Utilisation** | The share of delivered context an AI assistant actually read or edited |
| **Skill** | A short playbook distilled from a successful AI session and reused later |
| **Golden pack** | A frozen pack the test suite compares against to catch unintended changes |
| **Service / daemon** | The local per-repository process that owns the index |
| **MLFF** | Multi-Lane Free Flow tolling, the first Bosch MPS product domain for RIAF |

---

## 19. License

MIT. Copyright © Bosch Mobility Platform and Solutions. See `LICENSE`.
