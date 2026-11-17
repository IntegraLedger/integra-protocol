---
title: "@integraledger/lcp/x402-exact-xrpl"
description: "The exports of @integraledger/lcp/x402-exact-xrpl."
---

# @integraledger/lcp/x402-exact-xrpl

## Variables

### exactXrpl

> `const` **exactXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplUnsigned`](xrpl.md#xrplunsigned)\<`XrplPaymentPayload`\>\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/xrpl`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
signed `Payment` blob; `status` reads it by the payer's instrument (`xrplStatus`). `recover` returns the value the
landed `Payment` carries in H's place, its `InvoiceID`, the SHA-256 of H's LCP string, as `0x` and 64 lowercase hex
digits (`xrplInvoiceOf`): a digest is not read back to H, so a holder of the ATR computes the SHA-256 of its own
H's LCP string and compares the two.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
