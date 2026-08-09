@AGENTS.md

## Working in this repository

Run `pnpm verify` before claiming anything done, and read its non-hermetic caveat in AGENTS.md before
treating an audit-stage failure as your own.

Take extra care with changes under `packages/binding-*/src/` and `packages/placement-*/src/`: a manifest is
a machine-readable claim a stranger relies on. Check it against the adapter rather than against the schema —
the schema cannot tell you whether a declared strategy is one the reader can actually perform. And read the
required-field list rather than assuming: `readAlso`, `carrierClass` and `write` are all optional.
