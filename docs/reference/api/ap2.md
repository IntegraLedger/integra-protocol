---
title: "@integraledger/lcp/ap2"
description: "The exports of @integraledger/lcp/ap2."
---

# @integraledger/lcp/ap2

## Interfaces

### Ap2Offer

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout"></a> `checkout` | `string` |
| <a id="property-checkoutjwt"></a> `checkoutJwt` | `string` |
| <a id="property-payload"></a> `payload` | [`Payload`](#payload) |

***

### MandateContent

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout_hash"></a> `checkout_hash` | `string` |
| <a id="property-checkout_jwt"></a> `checkout_jwt?` | `string` |

***

### Presented

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-checkout_jwt-1"></a> `checkout_jwt` | `string` | The checkout JWT presented beside the mandate. For AP2's latest-checkout check, the seller passes the one it last sent for this checkout; the buyer's copy shows only that the mandate and that JWT agree. |
| <a id="property-checkout_mandate"></a> `checkout_mandate` | `string` | The closed Checkout Mandate as presented: one SD-JWT, or AP2's chain of the open mandate's SD-JWT and the closed mandate's, joined by `~~`. |

***

### Unsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-content"></a> `content` | `object` |
| `content.checkout_hash` | `string` |
| `content.checkout_jwt` | `string` |
| `content.vct` | `"mandate.checkout.1"` |

#### Methods

##### complete()

> **complete**(`checkout_mandate`): [`Presented`](#presented)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `checkout_mandate` | `string` |

###### Returns

[`Presented`](#presented)

## Type Aliases

### CheckoutOption

> **CheckoutOption** = `object`

The checkout's own `id`, 1–256 characters.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-1"></a> `checkout` | `string` |

***

### Jws

> **Jws** = `string`

A compact JWS: three base64url segments joined by ".".

***

### Payload

> **Payload** = `object`

The `checkout_jwt` payload: the commerce object.

#### Index Signature

\[`k`: `string`\]: [`Json`](index.md#json)

## Variables

### CHECKOUT\_VCT

> `const` **CHECKOUT\_VCT**: `"mandate.checkout.1"` = `"mandate.checkout.1"`

***

### checkoutMandate

> `const` **checkoutMandate**: `Readonly`\<\{ `advertise`: (`payload`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`Payload`](#payload); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`offer`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>; `claims`: `boolean`; `id`: `"ap2/checkout-mandate"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`Ap2Offer`](#ap2offer); \}; `tie`: (`options`) => \[`"ap2"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]; `unplaced`: (`option`) => [`CheckoutOption`](#checkoutoption); \}\>

***

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

The option digest the issuer keeps: SHA-256 over the RFC 8785 form.

## Functions

### checkoutBinding()

> **checkoutBinding**(`p`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `payload`: [`Payload`](#payload); \}\>

AP2's merchant check: the mandate's `checkout_hash` is the hash of the presented `checkout_jwt`, and a disclosed
`checkout_jwt` is that JWT. Returns that JWT's payload. It checks that the mandate commits to the latest checkout
when the seller presents the `checkout_jwt` it last sent for this checkout; with the buyer's copy, it checks only
that the mandate and that JWT agree.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | `unknown` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `payload`: [`Payload`](#payload); \}\>

***

### checkoutJwtOf()

> **checkoutJwtOf**(`m`): `Promise`\<`string` \| [`Refusal`](index.md#refusal)\>

The `checkout_jwt` the mandate discloses.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `m` | `string` |

#### Returns

`Promise`\<`string` \| [`Refusal`](index.md#refusal)\>

***

### jwsPayload()

> **jwsPayload**(`j`): [`Refusal`](index.md#refusal) \| [`Payload`](#payload)

The payload of a compact JWS, decoded as one JSON object. The signature is never verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `j` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`Payload`](#payload)

***

### readMandate()

> **readMandate**(`m`): `Promise`\<[`Refusal`](index.md#refusal) \| [`MandateContent`](#mandatecontent)\>

The closed Checkout Mandate in a presentation, one SD-JWT or AP2's chain of the open and closed mandates joined by
`~~` (at most these two hops, each an SD-JWT): exactly one resolved object of the last SD-JWT whose `vct` is
`mandate.checkout.1`, its `checkout_hash`, and its `checkout_jwt` when disclosed. No signature is verified, nor the
open mandate's `cnf` delegation to the closed mandate's signer, nor the closed mandate's `sd_hash` or
`issuer_jwt_hash` link to the open one; the open mandate's constraints are not read. A hop whose payload, with each
disclosed value where its reference sits, nests more than 64 levels is `ap2/too-large`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `m` | `unknown` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`MandateContent`](#mandatecontent)\>

***

### tie()

> **tie**(`options`): \[`"ap2"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]

The binding slot: the checkouts this ATR was minted for, each by its own `id`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`CheckoutOption`](#checkoutoption)[] |

#### Returns

\[`"ap2"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]
