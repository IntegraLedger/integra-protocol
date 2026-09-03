---
"@integraledger/lcp-binding-evm-common": minor
"@integraledger/lcp-authority": patch
---

An RPC outage is no longer reported as a forged signature.

`verifyAcceptanceSignature` wrapped the bound verification call in `try { … } catch { return false }`. For
`eip191` and `eip712` that closure is pure offline recovery, so a throw genuinely is the signature. For
`evm:erc1271` and `evm:erc6492` it is an on-chain call, and viem has already drawn the line inside it: a
signature the validator rejects makes the deployless call revert, viem catches its own `VerificationError`
and returns `false`, and it rethrows only for an HTTP 429, a timeout, or a node that answered garbage.
Swallowing that rethrow turned every rate-limited RPC into `acceptance/bad-signature` — "signature did not
verify" — publishing a valid buyer acceptance as a forgery, a verdict the next run reverses. The package's
own README argued the opposite doctrine three paragraphs above the code: "'not verified' and 'verified as
forged' are different facts."

The guard is now scheme-shaped: it wraps the offline recovery only, and an on-chain call's throw
propagates. **This changes published behaviour** — a caller of `verifyAcceptanceSignature` or of the
`SignatureVerifier` returned by `makeEvmAcceptanceVerifier`, on a smart-account scheme, must now handle a
rejection where it previously received `false`. That is the point of the change: the two facts were
indistinguishable and one of them was wrong. The `false` verdict for a signature the chain actually
rejected is unchanged.

`authority` gains no behaviour change, only the contract in writing: `SignatureVerifier.verify` returning
`false` means CHECKED AND INVALID, and `verifyAcceptance` deliberately does not catch a rejection from the
port, because `acceptance/bad-signature` is a claim about the record and an unreachable node has made none.

The replaced test asserted the defect outright — "an on-chain call that throws is reported as false, not
propagated (a verifier must not crash)".
