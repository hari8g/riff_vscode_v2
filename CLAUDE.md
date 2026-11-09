@.riaf/runbook.md

# Repo-specific notes for Claude Code
- Read `docs/adr/` before changing anything in `packages/kernel` or `packages/store`.
- When adding a module, mirror it with `test/<module>.test.ts` in the same package.
- Prefer small PRs: one package, its tests, and the ADR if a contract moved.
