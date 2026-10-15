---
title: "@integraledger/lcp/lightning"
description: "The exports of @integraledger/lcp/lightning."
---

# @integraledger/lcp/lightning

## Interfaces

### Bolt11

A decoded BOLT11 invoice. `B` is what its bytes are backed by: `decodeBolt11` gives `Bolt11<ArrayBuffer>`, each byte
field in its own fresh `ArrayBuffer`, and a function that reads one takes any backing.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amountmsat"></a> `amountMsat` | `bigint` \| `null` | - |
| <a id="property-currency"></a> `currency` | `"bc"` \| `"tb"` \| `"tbs"` \| `"bcrt"` | - |
| <a id="property-description"></a> `description` | `string` \| `null` | The `d` field as strict UTF-8, a leading byte-order mark kept as a character; null when the invoice has none. |
| <a id="property-descriptionhash"></a> `descriptionHash` | `Uint8Array`\<`B`\> \| `null` | - |
| <a id="property-expiry"></a> `expiry` | `number` | - |
| <a id="property-metadata"></a> `metadata` | `Uint8Array`\<`B`\> \| `null` | - |
| <a id="property-paymenthash"></a> `paymentHash` | `Uint8Array`\<`B`\> | - |
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

The credential for the paid invoice's preimage. A credential over the credential size bound, 64 KiB, its echoed
challenge included, is `mpp/credential-malformed`, as `bound` refuses it, and is read first; a preimage that is not
64 lowercase hex digits is `ln/preimage-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `preimage` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](mpp.md#mppcredential)

***

### LnRef

The read keys `reference` returns: the invoice's payment hash as lowercase hex, and when the payment can land.

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

### LnNetwork

> **LnNetwork** = `"lnbtc:000000000019d6689c085ae165831e93"` \| `"lnbtc:000000000933ea01ad0ee984209779ba"`

x402's `lnbtc` network ids, in CAIP-2 form: `lnbtc:` and the first 32 hex digits of the genesis block hash of
Bitcoin mainnet or testnet3. `lnbtc` is x402's own namespace.

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

> `const` **chargeLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge); \}\>

`mpp/charge/lightning`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice before the
preimage is presented. The seller's node, which received the payment, confirms it; `reference` names the invoice,
and no `status` reads it.

***

### exactLnbtc

> `const` **exactLnbtc**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnUnsigned`](#lnunsigned)\>; `carrier`: `"extra.invoice#m"`; `claims`: `boolean`; `id`: `"x402/exact/lnbtc"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/lnbtc`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice before the
preimage is presented. The seller's node, which received the payment, confirms it; `reference` names the invoice,
and no `status` reads it.

***

### exactLnbtcNamed

> `const` **exactLnbtcNamed**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnUnsigned`](#lnunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/lnbtc/invoice-named"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/lnbtc/invoice-named`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice
before the preimage is presented. The seller's node, which received the payment, confirms it; `reference` names the
invoice, and no `status` reads it.

***

### sessionLightning

> `const` **sessionLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge); \}\>

`mpp/session/lightning`. `broadcaster` answers by the payment's action (`sessionBroadcaster`). `"payer"`: the opening
and a top-up, whose deposits the payer's node paid, and a bearer proof, which draws on them; the seller's node, which
received each deposit, confirms it, and no `status` reads it. `"payee"`: the close, whose refund the seller's node
pays. Any other payment gets `bound`'s refusal.

## Functions

### atrNamesInvoice()

> **atrNamesInvoice**(`atr`, `invoice`): `boolean`

True when the ATR's bytes are one JSON object in the core's layout whose `x402` slot's `accepts` holds, among its
first 32 entries, an option whose `extra.invoice` is exactly `invoice`. The object's first members are `atrVersion`,
`id` and `x402`, in that order, and no member name appears twice, so every JSON reader finds the same `x402` slot.
Only that slot is read; inside it, a repeated member name reads as `JSON.parse` reads it, the last one counting.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `atr` | `Uint8Array` |
| `invoice` | `string` |

#### Returns

`boolean`

***

### decodeBolt11()

> **decodeBolt11**(`invoice`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Bolt11`](#bolt11)\<`ArrayBuffer`\>\>

Decodes a BOLT11 invoice of up to 8,192 characters, past Bech32's 90-character limit, which BOLT 11 lets an invoice
exceed. The signature is not verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `invoice` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Bolt11`](#bolt11)\<`ArrayBuffer`\>\>

***

### invoiceH()

> **invoiceH**(`b`, `field`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The one 32-byte `h` or `m` field of an invoice, as the hash it carries.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | [`Bolt11`](#bolt11) |
| `field` | `"h"` \| `"m"` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
