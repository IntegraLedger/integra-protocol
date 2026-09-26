---
title: "@integraledger/lcp/lightning"
description: "The exports of @integraledger/lcp/lightning."
---

# @integraledger/lcp/lightning

## Interfaces

### Bolt11

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amountmsat"></a> `amountMsat` | `bigint` \| `null` | - |
| <a id="property-currency"></a> `currency` | `"bc"` \| `"tb"` \| `"tbs"` \| `"bcrt"` | - |
| <a id="property-description"></a> `description` | `string` \| `null` | - |
| <a id="property-descriptionhash"></a> `descriptionHash` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-expiry"></a> `expiry` | `number` | - |
| <a id="property-metadata"></a> `metadata` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-paymenthash"></a> `paymentHash` | `Uint8Array` | - |
| <a id="property-tags"></a> `tags` | readonly `number`[] | Every tagged field's type, in invoice order. |
| <a id="property-timestamp"></a> `timestamp` | `number` | - |

***

### LnMppChoice

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-challenge"></a> `challenge` | [`MppChallenge`](mpp.md#mppchallenge) & `object` | - |
| <a id="property-returninvoice"></a> `returnInvoice?` | `string` | session only: the payer's return invoice, a BOLT11 invoice with no amount, which the open action registers. |

***

### LnMppUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.invoice` | `string` |
| `request.kind` | `"bolt11-pay"` |

#### Methods

##### complete()

> **complete**(`preimage`): [`Refusal`](index.md#refusal) \| [`MppCredential`](mpp.md#mppcredential)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `preimage` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](mpp.md#mppcredential)

***

### LnRef

The read keys recorded at claim: the invoice's payment hash as lowercase hex, and when the payment can land.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-network"></a> `network` | `string` |
| <a id="property-paymenthash-1"></a> `paymentHash` | `string` |
| <a id="property-settleby"></a> `settleBy` | `number` |

***

### LnUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request-1"></a> `request` | `object` | The payer's node pays exactly this invoice. |
| `request.invoice` | `string` | - |
| `request.kind` | `"bolt11-pay"` | - |

#### Methods

##### complete()

> **complete**(`preimage`): [`Refusal`](index.md#refusal) \| [`LnPaymentPayload`](#lnpaymentpayload)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `preimage` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`LnPaymentPayload`](#lnpaymentpayload)

## Type Aliases

### LnMppPairing

> **LnMppPairing** = *typeof* `LN_CHARGE` \| *typeof* `LN_SESSION`

***

### LnNetwork

> **LnNetwork** = `"lnbtc:000000000019d6689c085ae165831e93"` \| `"lnbtc:000000000933ea01ad0ee984209779ba"`

CAIP-2 for Lightning: `lnbtc:` and the first 32 hex digits of the Bitcoin network's genesis block hash.

***

### LnPaymentPayload

> **LnPaymentPayload** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.preimage` | `string` |
| <a id="property-resource"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### chargeLightning

> `const` **chargeLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`MppChallenge`](mpp.md#mppchallenge); \}\>

***

### exactLnbtc

> `const` **exactLnbtc**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnUnsigned`](#lnunsigned)\>; `carrier`: `"extra.invoice#m"`; `claims`: `boolean`; `id`: `"x402/exact/lnbtc"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### exactLnbtcNamed

> `const` **exactLnbtcNamed**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnUnsigned`](#lnunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/lnbtc/invoice-named"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### sessionLightning

> `const` **sessionLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`MppChallenge`](mpp.md#mppchallenge); \}\>

## Functions

### atrNamesInvoice()

> **atrNamesInvoice**(`atr`, `invoice`): `boolean`

True when the ATR's bytes are one JSON object whose `x402` slot's `accepts` holds an option whose
`extra.invoice` is exactly `invoice`. Only that slot is read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `atr` | `Uint8Array` |
| `invoice` | `string` |

#### Returns

`boolean`

***

### decodeBolt11()

> **decodeBolt11**(`invoice`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Bolt11`](#bolt11)\>

Decodes a BOLT11 invoice without its length limit, up to 8 KiB. The signature is not verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `invoice` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Bolt11`](#bolt11)\>

***

### invoiceH()

> **invoiceH**(`b`, `field`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

The one 32-byte `h` or `m` field of an invoice, as the hash it carries.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | [`Bolt11`](#bolt11) |
| `field` | `"h"` \| `"m"` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### lnbtcPairingOf()

> **lnbtcPairingOf**(`option`): `"x402/exact/lnbtc"` \| `"x402/exact/lnbtc/invoice-named"` \| `undefined`

Which of the two x402 Lightning pairings an option belongs to: by whether its invoice has an `m` field. An option
whose `extra` has no `invoice` is the offer the seller sends before its node writes the invoice, so it is
`x402/exact/lnbtc`; an `invoice-named` option carries its invoice at issue.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `unknown` |

#### Returns

`"x402/exact/lnbtc"` \| `"x402/exact/lnbtc/invoice-named"` \| `undefined`
