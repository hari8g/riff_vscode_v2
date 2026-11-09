# M3 — Compiler and MCP: gate results

Measured 9 Nov 2026 on the frozen task set (30 tasks, see `baseline.md`). Reproduce with `pnpm build && node packages/cli/dist/main.js eval --runner scripted,compiler`.

| Runner | File recall | Full recall | Precision | Mean tokens | Tool calls |
| --- | --- | --- | --- | --- | --- |
| scripted-baseline (no RIAF) | 86.8% | 24/30 | 25.4% | 2.9k | 11.5 |
| riaf-compiler (one `riaf_pack`) | **97.1%** | **27/30** | 28.1% | **1.5k** | **1.0** |

Against the scripted baseline: +10.3 points recall, **49.4% fewer tokens**, 91.3% fewer tool calls. Branches: 23 single, 6 blended, 1 generic, 0 clarify (unattended runs never ask).

| Gate (implementation plan) | Status |
| --- | --- |
| file recall ≥ 85% on the harness | **met**: 97.1% |
| ≥ 30% fewer tokens per task vs baseline | **met against the scripted baseline**: 49.4%. Not yet measured against Claude Code headless, see below |
| no pass-rate loss | **half measured**: the Claude Code headless baseline passes 27/27 (100%; see `baseline.md`). The RIAF condition has not been run yet, so the comparison is still open |
| golden packs stable | **met**: 12 packs pinned in `fixtures/golden-packs/`, byte-stable across runs, checked in CI (`packages/eval/test/golden.test.ts`) |
| `riaf_pack` live in Claude Code | **partly verified**: `riaf init --host claude` writes `.mcp.json`; `claude mcp list` (Claude Code 2.1.318) discovers the `riaf` server and shows it as pending the one-time project approval. The stdio server is exercised end to end with the MCP SDK client in `packages/cli/test/m3.test.ts`, the same command Claude Code launches. A model-driven session has not been run |

Router calibration (`packages/intent/test/route.test.ts`): 29/30 intents correct, 29/30 tasks with a gold file among the anchors. The miss, `tel-005`, is genuinely ambiguous ("should reject … instead of failing later") and routes as a feature/bugfix blend.

## What remains for the pass-rate gate
Run both conditions through Claude Code headless and compare pass rate, tokens and tool calls:

```bash
node packages/cli/dist/main.js eval --runner claude --out reports/eval-claude-baseline
```

The RIAF condition needs the runner to start Claude Code with the RIAF MCP server attached (`--mcp-config`). That wiring is in `ClaudeHeadlessRunner.extraArgs`, and the CLI flag is added together with M5's hooks so the governed run is measured in one pass.
