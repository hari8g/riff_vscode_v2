# @riaf/kernel

The shared vocabulary of RIAF v2. No repository logic lives here — only what every other package must agree on.

- `ids` — stable symbol ids (`path#qualifiedName@kind`), blob/tree hash types.
- `hash` — SHA-256 content hashing and Merkle node combination.
- `tokens` — fast token estimator with a per-model calibration table.
- `events` — typed event bus for pipeline progress and telemetry.
- `errors` — `Result<T, E>` and the error taxonomy.
- `log` — minimal structured logger with levels.
- `ports/` — interfaces implemented elsewhere: `ModelPort`, `LspPort`, `TelemetrySink`, `Clock`, `Fs`.
- `schemas/` — the zod contracts: `pack`, `policy`, `intent`, `rpc`, `governance`. `pnpm schemas` exports them to `docs/contracts/`.

Depends on: `zod` only. Nothing in the repo may be imported by kernel.
