---
title: "@integraledger/lcp/ack"
description: "ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body."
---

# @integraledger/lcp/ack

ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the
seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body.

ACK defines no payer signature, so `build` and `bound` always refuse. The token is read under the name ACK's SDKs
write from 0.10.0, `paymentRequestToken`, and under `paymentToken`, the name they wrote before it, in the 402 body
and in a receipt's credential subject alike. Pure; no I/O. No token or receipt signature is verified here.

## Interfaces

### AckBody

The 402 body. The seller-signed token is `paymentRequestToken`, as ACK's SDKs write it from 0.10.0, or
`paymentToken`, as they wrote it before; a body that carries both carries one token under both names.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-legalcontext"></a> `legalContext` | [`Json`](index.md#json) |
| <a id="property-paymentrequest"></a> `paymentRequest?` | [`Json`](index.md#json) |
| <a id="property-paymentrequesttoken"></a> `paymentRequestToken?` | `string` |
| <a id="property-paymenttoken"></a> `paymentToken?` | `string` |

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

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

The option digest the issuer keeps: SHA-256 over the RFC 8785 form.

***

### paymentRequest

> `const` **paymentRequest**: `Readonly`\<\{ `advertise`: (`_doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`AckValues`](#ackvalues); `bound`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`_doc`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"ack/payment-request"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `options`: readonly [`Json`](index.md#json)[]; \}; \}; `tie`: (`options`) => \[`"ack"`, \{ `paymentOptions`: readonly [`AckPaymentOption`](#ackpaymentoption)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`AckPaymentOption`](#ackpaymentoption); \}\>

`ack/payment-request`. The payer broadcasts (`broadcaster` answers `"payer"`): it pays the Payment Request through
its payment service before presenting the receipt. Settlement is the seller's report: the seller verifies the
receipt, and `fromReceipt` reads the hash from it; no `fetchPresented`, `status` or `recover` reads it.

## Functions

### fromReceipt()

> **fromReceipt**(`credentialSubject`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The hash in a receipt: the `id` of the Payment Request token embedded in its `credentialSubject`, under either of the
token's two names. Verifies nothing; a party calls it on a receipt it has verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `credentialSubject` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
