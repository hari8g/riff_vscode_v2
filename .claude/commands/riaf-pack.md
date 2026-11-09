Compile a RIAF context pack for the task below before touching code (available once M3 lands; until then, read `.riaf/runbook.md` and `docs/architecture.md`).

Task: $ARGUMENTS

Steps: call `riaf_pack` with the task text and the current selection; read the pack header (intent vector, entropy, branch, open lookups); perform the open lookups first; then plan.
