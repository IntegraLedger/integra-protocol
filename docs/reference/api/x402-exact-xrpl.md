---
title: "@integraledger/lcp/x402-exact-xrpl"
description: "The exports of @integraledger/lcp/x402-exact-xrpl."
---

# @integraledger/lcp/x402-exact-xrpl

## Variables

### exactXrpl

> `const` **exactXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplUnsigned`](xrpl.md#xrplunsigned)\<`XrplPaymentPayload`\>\>; `carrier`: `"extra.invoiceId"`; `claims`: `boolean`; `id`: `"x402/exact/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/xrpl`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
signed `Payment` blob; `status` reads it by the blob's hash.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
