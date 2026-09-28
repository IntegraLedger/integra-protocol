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
| <a id="property-checkout_jwt-1"></a> `checkout_jwt` | `string` | The checkout JWT the presenter names as the latest. |
| <a id="property-checkout_mandate"></a> `checkout_mandate` | `string` | The closed Checkout Mandate, an SD-JWT as presented. |

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

AP2's merchant check: the mandate's `checkout_hash` is the hash of the presenter's latest `checkout_jwt`, and a
disclosed `checkout_jwt` is that JWT. Returns that JWT's payload.

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

The closed Checkout Mandate inside an SD-JWT: exactly one resolved object whose `vct` is `mandate.checkout.1`, its
`checkout_hash`, and its `checkout_jwt` when disclosed.

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
