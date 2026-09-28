---
title: "@integraledger/lcp/x402-exact-solana"
description: "The exports of @integraledger/lcp/x402-exact-solana."
---

# @integraledger/lcp/x402-exact-solana

## Interfaces

### SvmChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-computeunitlimit"></a> `computeUnitLimit?` | `number` |
| <a id="property-computeunitprice"></a> `computeUnitPrice?` | `bigint` |
| <a id="property-decimals"></a> `decimals` | `number` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-recentblockhash"></a> `recentBlockhash` | `string` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-tokenprogram"></a> `tokenProgram` | `string` |

***

### SvmPaymentPayload

A payment on this pairing: the base64 partially signed versioned transaction.

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

***

### SvmUnsigned

What the payer signs, and how its signature completes the payment.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `P` | [`SvmPaymentPayload`](#svmpaymentpayload) |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"solana-message"` |
| `request.message` | `Uint8Array` |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `P`

A 64-byte Ed25519 signature by the payer.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `P`

## Variables

### exactSvm

> `const` **exactSvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmUnsigned`](#svmunsigned)\<[`SvmPaymentPayload`](#svmpaymentpayload)\>\>; `carrier`: `"extra.memo"`; `claims`: `boolean`; `id`: `"x402/exact/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/solana"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/solana"` \| `undefined`
