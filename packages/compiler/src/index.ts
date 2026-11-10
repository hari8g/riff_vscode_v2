/**
 * @riaf/compiler — L5 context pack compiler: sufficiency expansion over the graph, scoring with
 * personalized PageRank, a bucketed knapsack with a sufficiency stop, tiers and stages, and renders
 * for Claude, Copilot, any model's system prompt, JSON and AGENTS.md.
 */
export * from './view.js';
export * from './candidates.js';
export * from './expand.js';
export * from './knapsack.js';
export * from './compile.js';
export * from './render/index.js';
export { where, routeLine } from './render/common.js';
export * from './prompt.js';
