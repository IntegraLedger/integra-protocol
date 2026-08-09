# @integraledger/lcp-binding-canton-x402

## 0.9.0

First release. Welds an ATR hash into a Canton Coin settlement over x402's `exact` scheme for Canton:
the seller advertises `PaymentRequirements.extra.memo`, the payer echoes it into the transfer metadata
under `x402.memo`, and the facilitator rejects `invalid_exact_canton_memo_mismatch` on a mismatch
(scheme safety check 12). A §8.3.1 Native Field binding, conforms to LCP v1.38.

Split out of `@integraledger/lcp-binding-canton` rather than replacing it: x402's exact-Canton scheme
settles Canton Coin only, so the `LcpAnchor` overlay remains the carrier for every other Canton
deployment. One chain, two carriers, two rails — `canton` and `canton:x402`.
