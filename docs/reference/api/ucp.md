---
title: "@integraledger/lcp/ucp"
description: "The exports of @integraledger/lcp/ucp."
---

# @integraledger/lcp/ucp

## Interfaces

### UcpBinding

#### Type Parameters

| Type Parameter |
| ------ |
| `Id` *extends* `string` |
| `O` *extends* `Option` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-id"></a> `id` | `Id` |
| <a id="property-pattern"></a> `pattern` | [`LcpPattern`](x402.md#lcppattern) |

#### Methods

##### advertise()

> **advertise**(`doc`, `h`, `link`, `offer`, `agreementUrl?`): [`Refusal`](index.md#refusal) \| [`Checkout`](#checkout)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | [`Checkout`](#checkout) |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `offer` | `O` |
| `agreementUrl?` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`Checkout`](#checkout)

##### bound()

> **bound**(`presented`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

##### build()

> **build**(`offer`, `h`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `offer` | [`UcpOffer`](#ucpoffer) |
| `h` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>

##### read()

> **read**(`doc`): [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`UcpOffer`](#ucpoffer); \}

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | [`Checkout`](#checkout) |

###### Returns

[`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`UcpOffer`](#ucpoffer); \}

##### tie()

> **tie**(`options`): \[`"ucp"`, \{ `options`: readonly `O`[]; \}\]

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly `O`[] |

###### Returns

\[`"ucp"`, \{ `options`: readonly `O`[]; \}\]

##### unplaced()

> **unplaced**(`option`): `O`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `O` |

###### Returns

`O`

***

### UcpOffer

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout"></a> `checkout` | [`Checkout`](#checkout) |

***

### Unsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-1"></a> `checkout` | [`Checkout`](#checkout) |

#### Methods

##### complete()

> **complete**(`checkout_mandate`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Presented`](ap2.md#presented)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `checkout_mandate` | `string` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Presented`](ap2.md#presented)\>

## Type Aliases

### BookingOption

> **BookingOption** = `object`

A booking session's own `id`, 1–256 characters.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-booking"></a> `booking` | `string` |

***

### Checkout

> **Checkout** = `object` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `ap2?` | `object` & `object` |
| `id` | `string` |
| `links?` | [`Link`](#link)[] |

***

### CheckoutOption

> **CheckoutOption** = `object`

A checkout's own `id`, 1–256 characters.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-2"></a> `checkout` | `string` |

***

### Link

> **Link** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-title"></a> `title?` | `string` |
| <a id="property-type"></a> `type` | `string` |
| <a id="property-url"></a> `url` | `string` |

## Variables

### AGREEMENT\_LINK\_TYPE

> `const` **AGREEMENT\_LINK\_TYPE**: `"legal_context_agreement"` = `"legal_context_agreement"`

***

### ap2Mandate

> `const` **ap2Mandate**: [`UcpBinding`](#ucpbinding)\<`"ucp/checkout/ap2-mandate"`, [`CheckoutOption`](#checkoutoption)\>

***

### bookingAp2Mandate

> `const` **bookingAp2Mandate**: [`UcpBinding`](#ucpbinding)\<`"ucp/booking/ap2-mandate"`, [`BookingOption`](#bookingoption)\>

***

### bookingUnsigned

> `const` **bookingUnsigned**: [`UcpBinding`](#ucpbinding)\<`"ucp/booking/unsigned"`, [`BookingOption`](#bookingoption)\>

***

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

The option digest the issuer keeps: SHA-256 over the RFC 8785 form.

***

### LINK\_TYPE

> `const` **LINK\_TYPE**: `"legal_context"` = `"legal_context"`

***

### unsigned

> `const` **unsigned**: [`UcpBinding`](#ucpbinding)\<`"ucp/checkout/unsigned"`, [`CheckoutOption`](#checkoutoption)\>

## Functions

### legalContextLink()

> **legalContextLink**(`c`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `link`: `string`; \}

The hash and link of the checkout's one `legal_context` link. Nothing else of the checkout is read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`Checkout`](#checkout) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `link`: `string`; \}

***

### tie()

> **tie**\<`O`\>(`options`): \[`"ucp"`, \{ `options`: readonly `O`[]; \}\]

The binding slot: the checkouts or bookings this ATR was minted for, each by its own `id`.

#### Type Parameters

| Type Parameter |
| ------ |
| `O` *extends* `Option` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly `O`[] |

#### Returns

\[`"ucp"`, \{ `options`: readonly `O`[]; \}\]
