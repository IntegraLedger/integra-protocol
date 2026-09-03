---
"@integraledger/lcp-binding-aptos": patch
---

`makeAptosReader` returns `null` for a transaction the fullnode does not have, as its port promises.

`AptosReader.txView` is documented "or `null` if the fullnode has no such transaction", and the shipped
implementation could not produce that value: `getTransactionByHash` raises `AptosApiError` with status 404,
which propagated straight through `recover` and `observe`. A caller auditing a hash the node has never seen
got an exception where every sibling rail returns a Refusal — and a hash nobody has heard of is an answer,
not an error.

Only 404 is treated as absence. A 429, a 500 or a dropped connection is "we could not look", a different
fact from "there is no such transaction", and it stays loud.
