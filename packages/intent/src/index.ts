/**
 * @riaf/intent — L4 router and policy composer (ADR-0003: intent as a distribution). Decomposes a
 * request into task units, grounds anchors, classifies each unit into an intent vector, gates on its
 * entropy (single / blended / probe → clarify | generic) and composes the primitive policies.
 */
export * from './lexicon.js';
export * from './classify.js';
export * from './entropy.js';
export * from './decompose.js';
export * from './anchors.js';
export * from './probe.js';
export * from './clarify.js';
export * from './compose.js';
export * from './defaults.js';
export * from './route.js';
