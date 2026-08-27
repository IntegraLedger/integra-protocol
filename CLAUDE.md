@AGENTS.md

## This repository is public

Everything in it — this file, AGENTS.md, commit messages, code comments, and the `src/` every package
packs — is world-readable and permanent. No internal vocabulary, no internal hostnames, no references to
private repositories' contents beyond what NOTICE already states. AGENTS.md states this about commit
history; it applies identically to everything you write here.

⭐ It publishes thirty-one packages, so the blast radius is a stranger's editor: a comment in `src/` reaches
`dist/*.d.ts` and rides the tarball. Write for that reader.

## Working in this repository

Run `pnpm verify` before claiming anything done, and read its non-hermetic caveat in AGENTS.md before
treating an audit-stage failure as your own.

Take extra care with changes under `packages/binding-*/src/` and `packages/placement-*/src/`: a manifest is
a machine-readable claim a stranger relies on. Check it against the adapter rather than against the schema —
the schema cannot tell you whether a declared strategy is one the reader can actually perform. And read the
required-field list rather than assuming: `readAlso`, `carrierClass` and `write` are all optional.
