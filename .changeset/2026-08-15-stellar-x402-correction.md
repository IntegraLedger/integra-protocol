---
"@integraledger/lcp-binding-stellar": patch
---

Correct the Stellar manifest's account of its relationship to x402.

The docblock claimed this binding welds into a CLASSIC Stellar payment, that x402's `exact` scheme for
Stellar was "a different flow entirely", and that "a deployment settling through an x402-Stellar facilitator
does not get this carrier". Every step of that was wrong, and it contradicted the same file: `finality.note`
says "Soroban SAC transfer", the paragraph above it says the buyer signs the Soroban SAC `transfer`, and
`adapter.ts` types the field it reads as "the `to` destination of the SAC transfer". There was never a
classic payment here to mux.

Re-read against the live sources: x402's exact-Stellar scheme is Soroban SEP-41 token transfers —
`invokeHostFunction` calling `transfer(from, to, amount)`, the same operation this binding welds into. Its
only rule on the destination is that argument 1 must equal `requirements.payTo` exactly, and it places no
format constraint on `payTo` anywhere, so a seller advertising their `M…` address satisfies it by
construction. And CAP-67 exists precisely to permit this: it adds `SC_ADDRESS_TYPE_MUXED_ACCOUNT` and
allows the SAC to take that type in `transfer`.

What IS limited is narrower and different, and is now what the docblock states: CAP-67 extended the SAC, not
Soroban generally. `MuxedAddressObject` "is not implicitly compatible with `AddressObject`", so a custom
SEP-41 token contract rejects a muxed `to` and the invocation fails rather than degrading. The carrier is
therefore available through x402 when, and only when, the scheme's `asset` is the SAC.

No manifest field changed — `protocol` stays absent, but now because the carrier genuinely serves bare
Soroban and x402 alike rather than because x402 could not reach it. Two facts are explicitly left unclaimed
because they were not verified: whether a given facilitator independently rejects an `M…` `payTo`, and
CAP-67's activation status on any particular network.
