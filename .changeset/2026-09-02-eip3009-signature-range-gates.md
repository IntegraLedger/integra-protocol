---
"@integraledger/lcp-binding-evm-common": patch
---

`verifyEip3009Signature` threw on an attacker-chosen signature instead of answering `false`. Its docblock
promises the opposite — it "Answers `false` rather than throwing for the two UNTRUSTED inputs" — and a
seller pre-flighting an inbound x402 `PaymentPayload` was crashed by a hand-built 65-byte string that costs
no key, no chain and no funds to produce.

`isCanonicalSignature` checked shape, low-s and `v ∈ {27, 28}`, and not that `r` and `s` are in range.
Measured: `r=0x11…, s=0` threw, `r=0, s=0x11…` threw, and `r` at or above `n` threw. `"not-a-signature"`
was the only malformed shape the suite drove, and the regex already refused that — so every gate past the
regex was untested against a hostile value.

The range rules are the token's, on the same footing low-s is: `ecrecover` answers the ZERO ADDRESS rather
than reverting for `r = 0`, `s = 0` or a component at or above `n`, and OpenZeppelin's `ECRecover.recover`
— which `FiatTokenV2` routes through — reverts on the zero signer. `1 <= r < n` and `s !== 0` are now part
of the predicate. Low-s already caps `s` below `n/2`, so on the `s` side the only value the rule adds is
zero.

The gates went into the predicate rather than a `try` in the caller deliberately: a `try` would also swallow
an unencodable `typedData`, which is this deployment's own domain being wrong, and would tell an operator
with a mis-copied `tokenName` that every honest payer is a forger. That case still throws, as the head note
reserves.
