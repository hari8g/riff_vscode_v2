/**
 * @riaf/eval — the harness: fixture histories, the task set, workspaces, hidden-test execution,
 * runners (scripted no-RIAF baseline, Claude Code headless, and the compiler from M3), metrics,
 * reports and golden-pack diffs.
 */
export * from './fixtureHistory.js';
export * from './tasks.js';
export * from './workspace.js';
export * from './testrun.js';
export * from './metrics.js';
export * from './report.js';
export * from './golden.js';
export * from './harness.js';
export * from './runners/types.js';
export * from './runners/scripted.js';
export * from './runners/claude.js';
