---
title: "@integraledger/lcp/x402-exact-stellar"
description: "The exports of @integraledger/lcp/x402-exact-stellar."
---

# @integraledger/lcp/x402-exact-stellar

## Interfaces

### StellarChoice

The buyer's inputs to `build`: the chosen option, the buyer's simulated transaction, the current ledger, and the
payer's account (`G…`), which must be the simulated transfer's `from`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-currentledger"></a> `currentLedger` | `number` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-simulatedxdr"></a> `simulatedXdr` | `string` |

***

### StellarPaymentPayload

A payment on this pairing: the base64 XDR of the transaction with the payer's entry signed.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.transaction` | `string` |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### exactStellar

> `const` **exactStellar**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarUnsigned`](stellar.md#stellarunsigned)\>; `carrier`: `"payTo"`; `claims`: `boolean`; `id`: `"x402/exact/stellar"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/stellar"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/stellar"` \| `undefined`
