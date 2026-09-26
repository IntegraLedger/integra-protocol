---
title: "@integraledger/lcp/x402-exact-xrpl"
description: "The exports of @integraledger/lcp/x402-exact-xrpl."
---

# @integraledger/lcp/x402-exact-xrpl

## Interfaces

### XrplChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-fee"></a> `fee` | `string` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `number` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-sequence"></a> `sequence` | `number` |
| <a id="property-ticketsequence"></a> `ticketSequence?` | `number` |

***

### XrplPaymentPayload

A payment on this pairing: the wallet's signed blob, hex.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.signedTxBlob` | `string` |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### exactXrpl

> `const` **exactXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplUnsigned`](xrpl.md#xrplunsigned)\<[`XrplPaymentPayload`](#xrplpaymentpayload)\>\>; `carrier`: `"extra.invoiceId"`; `claims`: `boolean`; `id`: `"x402/exact/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/xrpl"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/xrpl"` \| `undefined`
