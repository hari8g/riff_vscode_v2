# Agent instructions

Read `.riaf/runbook.md` first: it holds the commands, hard constraints and definition of done for this repository.

- Architecture: `docs/architecture.md`. Decisions: `docs/adr/`. Build plan: `docs/implementation-plan.md`.
- Dependency direction is enforced by `pnpm lint`; a failing boundaries rule means the design is wrong, not the lint.
- Do not add native Node modules to shipped packages.
