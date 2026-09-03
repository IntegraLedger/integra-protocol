---
"@integraledger/lcp-binding-solana": minor
---

`parseMemoViews` reads memos emitted through CPI, not only top-level ones.

A program that calls the SPL Memo program on the payer's behalf — a router, a facilitator, any settlement
program — produces an INNER instruction. `getParsedTransaction` reports those under
`meta.innerInstructions`, and this mapper read only `transaction.message.instructions`. So a genuinely
welded settlement read as no weld at all: `recover` refused `solana/no-atr-memo` about a transaction that
carried the atrHash, and the manifest's `zeroPartyRecoverable` claim was false for every deployment that
does not emit its memo at the top level.

Order is deliberate — top-level first, then inner in RPC order. `recoverAtrHashFromMemoViews` takes the
first view that decodes, so a memo the payer signed directly still wins over one a program emitted on
their behalf.

**This changes published behaviour**: `parseMemoViews` now returns more views for the same transaction,
and `recover`/`observe` succeed on transactions they previously refused.
