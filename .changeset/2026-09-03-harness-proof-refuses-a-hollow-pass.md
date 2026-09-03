---
"@integraledger/lcp-binding-xrpl": patch
---

The XRPL live harness refuses an incomplete install instead of returning, and a gate refuses the shape
anywhere.

`test/integration.onchain.test.ts` probed for its dev-only signing SDK and, when the import failed,
`console.warn`ed and `return`ed — under a comment calling that a "skip LOUD". Vitest has no such outcome:
a returning body is recorded as **passed**. `scripts/live-proof-gate.mjs` adjudicates a live run on
`failed === 0 && pending === 0 && passed > 0`, precisely because an exit code certifies nothing over an
all-skipped run, so this path would have printed "Rail proven live" over a run that signed, submitted and
read nothing. It was latent only because `--frozen-lockfile` happens to install both dependencies.

The loader now throws, naming the rail as not proven. Counts close the empty run and cannot close the
hollow one, so the second half is decided in the source: the new `check:harness-proof` stage refuses a
`return` in any live-rail test body, and a body containing no `expect`. Its subject set is
`scripts/live-rails.mjs --matrix` — the inventory `check:live-rails` already refuses a short version of —
so the two gates cannot disagree about what a harness is, and a rail added or renamed is covered the day
the inventory sees it. Measured across all eleven harnesses: XRPL was the only one with the shape.
