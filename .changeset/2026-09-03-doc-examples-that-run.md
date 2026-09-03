---
"@integraledger/lcp-binding-evm-x402": patch
"@integraledger/lcp-discovery": patch
"@integraledger/lcp-placement-ucp": patch
"@integraledger/lcp-placement-ack": patch
"@integraledger/lcp-binding-canton": patch
---

Five README examples that failed on their first line, and a gate that runs the examples.

Each was the first thing a stranger runs, on the npmjs landing page:

- `binding-evm-x402` opened with `getX402Deployment("base-sepolia-usdc")`; the keys are `base`,
  `base-sepolia`, `avalanche`, `monad`. It threw.
- `discovery` told the reader to read `hashesAgree`; the field is `hashesMatch`, so the documented read is
  `undefined` — falsy — and records a MISMATCH for a hash that matched, the exact defect the two-field
  design exists to prevent.
- `placement-ucp`'s only usage example refused `ucp/terms-url-missing`: this protocol declares a terms-URL
  slot, so an integrity-bearing reference needs one, and every sibling README passes it.
- `placement-ack` claimed a `url` carrier in the canonical slot "passes `requireIntegrity`". It did when
  written; `requireIntegrity` now checks the value's type as well as the slot's declared class and returns
  `undefined`. The narrower point that survives is stated instead.
- `binding-canton` documented a DAR filename, `lcp-anchor-0.9.0.dar`, that no build produces —
  `daml.yaml` carries the package version, gated by a test. Both the README and `daml.yaml`'s own comment
  now write the version as a glob, because a pinned number inside a copyable command goes stale at the
  next bump and had already done so twice.

The mechanism behind all five is that `check:docs` COMPILES fences and never runs them. `check:doc-calls`
runs the subset that can be run — a call of a workspace export whose every argument is a literal — and
refuses a throw or a returned `Refusal`. It also reads the inversion: a line the document annotates
`// throws` or `// refuses` must fail, so a demonstration that quietly starts succeeding is caught too.
Elided arguments (`"0x…"`) and calls inside a `try` are skipped as structurally not assertions. It refuses
an empty subject set, and it runs 30 calls across 74 fences today.
