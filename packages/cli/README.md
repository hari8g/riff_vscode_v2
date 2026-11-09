# riaf — command-line client

`riaf index | status | jump | impact | doctor | serve` (pack, history, wiki, eval and init arrive with later milestones). Allowed imports: `@riaf/kernel`, `@riaf/daemon` (client), `@riaf/serve-mcp`, `@riaf/eval`, compiler render types.

By default commands talk to the repository's daemon and auto-start it (`riaf serve --detached`). `--in-process` (or `RIAF_IN_PROCESS=1`) opens the index in the CLI process instead, for CI and benchmarks. `--json` gives machine-readable output on every command.
