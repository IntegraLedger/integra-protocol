---
title: "@integraledger/lcp/x402-upto-solana"
description: "The exports of @integraledger/lcp/x402-upto-solana."
---

# @integraledger/lcp/x402-upto-solana

## Interfaces

### UptoSvmChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-computeunitlimit"></a> `computeUnitLimit?` | `number` |
| <a id="property-computeunitprice"></a> `computeUnitPrice?` | `bigint` |
| <a id="property-nonce"></a> `nonce` | `bigint` |
| <a id="property-now"></a> `now` | `number` |
| <a id="property-openslot"></a> `openSlot` | `bigint` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-recentblockhash"></a> `recentBlockhash` | `string` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-tokenprogram"></a> `tokenProgram` | `string` |

***

### UptoSvmPayload

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner` | `string` | - |
| <a id="property-channelid"></a> `channelId` | `string` | - |
| <a id="property-deposit"></a> `deposit` | `string` | - |
| <a id="property-expiresat"></a> `expiresAt` | `number` | - |
| <a id="property-from"></a> `from` | `string` | - |
| <a id="property-maxamount"></a> `maxAmount` | `string` | - |
| <a id="property-nonce-1"></a> `nonce` | `string` | - |
| <a id="property-openslot-1"></a> `openSlot` | `number` | - |
| <a id="property-opentransaction"></a> `openTransaction` | `string` | Base64 of the partially signed `open` transaction. |
| <a id="property-validafter"></a> `validAfter` | `number` | - |

***

### UptoSvmPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | [`UptoSvmPayload`](#uptosvmpayload) |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### uptoSvm

> `const` **uptoSvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmUnsigned`](x402-exact-solana.md#svmunsigned)\<[`UptoSvmPaymentPayload`](#uptosvmpaymentpayload)\>\>; `carrier`: `"extra.memo"`; `claims`: `true`; `id`: `"x402/upto/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`ChannelStatus`](svm.md#channelstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### pairingOf()

> **pairingOf**(`option`): `"x402/upto/solana"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/upto/solana"` \| `undefined`
