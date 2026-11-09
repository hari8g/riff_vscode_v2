# ADR-0003 — Intent is a distribution; policies are composed, not selected

**Status:** accepted · **Date:** 2026-11-09

## Context
v1's router mapped a request to a single intent label and a fixed routing-table row. Real requests are mixtures ("fix X and add a flag Y") or vague ("this module feels fragile"); a single label silently drops the rest of the ask or guesses.

## Decision
`@riaf/intent` splits a request into task units, scores an intent vector `w` over seven primitive intents per unit, and measures normalised entropy `H(w)`. An entropy gate chooses a branch: single policy, blended policy (weighted union with a weight floor and pre-blend caps), probe-and-rescore (ground candidate anchors against the symbol table, then re-weight), and finally clarify (one question, live) or a generic pack (unattended). The output is one `ComposedPolicy` with merged anchors, expansion rules, history scope, renormalised budget weights and stages for dependent units. Thresholds and primitives live in `.riaf/policies.yaml`.

## Consequences
- The pack header always carries `w`, `H` and the branch, so agents and telemetry can see router confidence.
- Blend weights are tunable per repository from pack utilisation (M5).
- The schema for `ComposedPolicy` is a kernel contract and versioned.
