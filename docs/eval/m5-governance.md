# M5 — Governance and learning: gate results

Measured 9 Nov 2026. Reproduce with `RIAF_CALIBRATE=1 pnpm vitest run packages/eval/test/learning.test.ts`.

| Gate (implementation plan) | Status |
| --- | --- |
| ≥ 40% fewer tool calls per task vs baseline | **met against the scripted baseline**: one `riaf_pack` call against 11.5 grep/read calls (M3 report). **Not measured with Claude Code**: needs the paid headless runs, with and without the hooks |
| skills reused in ≥ 3 of 30 tasks | **met (offline simulation)**: 15 of 30 tasks get a pack carrying a skill distilled from an earlier session in the same repository |
| branch distribution and utilisation visible in `riaf eval` | **met**: the eval report shows branch distribution (M3), and `telemetry.query` returns branches, per-rule utilisation, priors, tool decisions and skill counts |

## The learning loop (offline simulation)
`packages/eval/src/runners/simulated.ts` runs the tasks of each repository in id order through one daemon. Each session:
1. compiles its pack;
2. reads the pack's top files and the gold files through the governor;
3. applies the gold edits;
4. runs the real hidden tests, with their output given to the governor as a `Bash` result;
5. ends.

The governor judges success from the test output. A passing session that edited code distils skills grounded on the edited symbols: purpose, playbook of steps, APIs used. Results: 27 / 27 sessions with tests passed, 49 skills distilled, and 15 / 30 later packs carried a skill. A skill matches by symbol, or by file when no symbol matches. So "reused" means the pack showed the agent how an earlier change to the same symbol or file was made. It does not mean the agent followed it; that needs real sessions.

## Hooks, verified against a live daemon (`packages/serve-mcp/test/hooks.test.ts`)
- **UserPromptSubmit** injects a pack on the first prompt and a one-line note while the reading stays the same.
- **PreToolUse** answers `Grep`/`Glob` from the index, serves repeat reads of unchanged files, asks for reflection past soft limits, and blocks loops and hard limits. Ordinary calls get no output. The script never emits `allow`, so Claude Code's own permission prompts are untouched.
- **PostToolUse** records results; **Stop** ends the session (utilisation, priors, skills).
- The script fails open when no daemon is reachable.

Not verified: a real Claude Code session driving these hooks. That needs the user's one-time approval of the project hooks and MCP server, and paid model calls.
