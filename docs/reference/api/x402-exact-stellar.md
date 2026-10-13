---
title: "@integraledger/lcp/x402-exact-stellar"
description: "The exports of @integraledger/lcp/x402-exact-stellar."
---

# @integraledger/lcp/x402-exact-stellar

## Variables

### exactStellar

> `const` **exactStellar**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarUnsigned`](stellar.md#stellarunsigned)\>; `carrier`: `"payTo"`; `claims`: `boolean`; `id`: `"x402/exact/stellar"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>
