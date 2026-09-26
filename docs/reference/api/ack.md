---
title: "@integraledger/lcp/ack"
description: "The exports of @integraledger/lcp/ack."
---

# @integraledger/lcp/ack

## Interfaces

### AckBody

The 402 body.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-legalcontext"></a> `legalContext` | [`Json`](index.md#json) |
| <a id="property-paymentrequest"></a> `paymentRequest?` | [`Json`](index.md#json) |
| <a id="property-paymentrequesttoken"></a> `paymentRequestToken` | `string` |

***

### AckPaymentOption

An ACK payment option as the seller wrote it.

#### Indexable

> \[`k`: `string`\]: [`Json`](index.md#json)

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-id"></a> `id` | `string` |

***

### AckValues

What the seller's stack places: the Payment Request's `id`, and the legal context beside the request, with the
agreement URL after the link when one is given.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-legalcontext-1"></a> `legalContext` | `object` |
| `legalContext.legalContextAgreementUrl?` | `string` |
| `legalContext.legalContextUrl` | `string` |
| `legalContext.type` | `"sha256"` |
| `legalContext.value` | `` `0x${string}` `` |
| <a id="property-paymentrequestid"></a> `paymentRequestId` | `string` |

## Variables

### paymentRequest

> `const` **paymentRequest**: `Readonly`\<\{ `advertise`: (`_doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`AckValues`](#ackvalues); `bound`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `build`: (`_doc`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `id`: `"ack/payment-request"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `options`: readonly [`Json`](index.md#json)[]; \}; \}; `tie`: (`options`) => \[`"ack"`, \{ `paymentOptions`: readonly [`AckPaymentOption`](#ackpaymentoption)[]; \}\]; `unplaced`: (`option`) => [`AckPaymentOption`](#ackpaymentoption); \}\>

## Functions

### fromReceipt()

> **fromReceipt**(`credentialSubject`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

The hash in a receipt: the `id` of the Payment Request token embedded in its `credentialSubject`. Verifies nothing;
a party calls it on a receipt it has verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `credentialSubject` | `unknown` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### tie()

> **tie**(`options`): \[`"ack"`, \{ `paymentOptions`: readonly [`AckPaymentOption`](#ackpaymentoption)[]; \}\]

The binding slot: the Payment Request's options exactly as issued.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`AckPaymentOption`](#ackpaymentoption)[] |

#### Returns

\[`"ack"`, \{ `paymentOptions`: readonly [`AckPaymentOption`](#ackpaymentoption)[]; \}\]
