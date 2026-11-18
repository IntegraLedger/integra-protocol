---
title: "@integraledger/lcp/ucp"
description: "UCP checkouts and bookings, and five pairings, each of which carries the ATR hash and link as one `links[]` entry of type `legal_context` in the checkout response."
---

# @integraledger/lcp/ucp

UCP checkouts and bookings, and five pairings, each of which carries the ATR hash and link as one `links[]` entry of
type `legal_context` in the checkout response.

The `ap2-mandate` pairings read the hash from the checkout JWT presented beside the buyer's checkout mandate, after
AP2's `checkout_hash` check, the mandate presented alone or last in AP2's chain after the open mandate;
`ucp/checkout/agent-signed` reads it from the `legal_context` member of the platform's signed request, once the
request's `Content-Digest` matches its body; the `unsigned` pairings have nothing signed to read. Nothing here takes
a key, signs, or verifies a signature, a `cnf` delegation or a link between chained mandates.

## Interfaces

### AgentSignedPresented

The platform's signed request as the business received it: its body, as text, and its `Content-Digest` value.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | `string` |
| <a id="property-contentdigest"></a> `contentDigest` | `string` |

***

### AgentSignedUnsigned

The member the platform writes into the request that completes the checkout, before it signs the request.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-legal_context"></a> `legal_context` | `object` |
| `legal_context.type` | `"sha256"` |
| `legal_context.value` | `` `0x${string}` `` |

***

### UcpBinding

The shape of a UCP pairing: its id, data, binding record and codec, over the checkout or booking option `O`.

#### Type Parameters

| Type Parameter |
| ------ |
| `Id` *extends* `string` |
| `O` *extends* `Option` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-data"></a> `data` | [`PairingData`](index.md#pairingdata) |
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

##### broadcaster()

> **broadcaster**(`presented`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>

Who broadcasts what the payer presents: the seller, which completes the payment (`"payee"`).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>

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

> **unplaced**(`option`): [`Refusal`](index.md#refusal) \| `O`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `O` |

###### Returns

[`Refusal`](index.md#refusal) \| `O`

***

### UcpOffer

The offer a UCP pairing's `read` gives, and the buyer's input to its `build`: the checkout the business returned,
carrying the `legal_context` link.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout"></a> `checkout` | [`Checkout`](#checkout) |

***

### Unsigned

The checkout as the business signed it, and the claims the buyer's checkout mandate carries for it: the checkout JWT
(`checkoutJwt`) and its hash. `complete` takes the signed mandate and returns it beside that JWT.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-1"></a> `checkout` | [`Checkout`](#checkout) |
| <a id="property-content"></a> `content` | `object` |
| `content.checkout_hash` | `string` |
| `content.checkout_jwt` | `string` |
| `content.vct` | `"mandate.checkout.1"` |

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

### agentSigned

> `const` **agentSigned**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`Checkout`](#checkout); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`offer`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AgentSignedUnsigned`](#agentsignedunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"ucp/checkout/agent-signed"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`UcpOffer`](#ucpoffer); \}; `tie`: (`options`) => \[`"ucp"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`CheckoutOption`](#checkoutoption); \}\>

`ucp/checkout/agent-signed`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
executes the payment the signed request completes; nothing here reads it. A value that is not an object gets
`ucp/request-malformed`, as `bound` refuses it.

***

### ap2Mandate

> `const` **ap2Mandate**: [`UcpBinding`](#ucpbinding)\<`"ucp/checkout/ap2-mandate"`, [`CheckoutOption`](#checkoutoption)\>

`ucp/checkout/ap2-mandate`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
executes the payment the buyer's checkout mandate authorizes; nothing here reads it. A value that is not a JSON
object gets `ap2/mandate-malformed`, as `bound` refuses it.

***

### bookingAp2Mandate

> `const` **bookingAp2Mandate**: [`UcpBinding`](#ucpbinding)\<`"ucp/booking/ap2-mandate"`, [`BookingOption`](#bookingoption)\>

`ucp/booking/ap2-mandate`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
executes the payment the buyer's checkout mandate authorizes; nothing here reads it. A value that is not a JSON
object gets `ap2/mandate-malformed`, as `bound` refuses it.

***

### bookingUnsigned

> `const` **bookingUnsigned**: [`UcpBinding`](#ucpbinding)\<`"ucp/booking/unsigned"`, [`BookingOption`](#bookingoption)\>

`ucp/booking/unsigned`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
executes the payment the booking completed; nothing here reads it.

***

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

The option digest the issuer keeps: SHA-256 over the RFC 8785 form.

***

### LINK\_TYPE

> `const` **LINK\_TYPE**: `"legal_context"` = `"legal_context"`

***

### unsigned

> `const` **unsigned**: [`UcpBinding`](#ucpbinding)\<`"ucp/checkout/unsigned"`, [`CheckoutOption`](#checkoutoption)\> & `object`

`ucp/checkout/unsigned`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
executes the payment the checkout completed; nothing here reads it. `reference` names the charge by the seller's own
reference for it.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `reference()` | (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ChargeRef`](acp.md#chargeref)\> |

## Functions

### checkoutJwt()

> **checkoutJwt**(`c`): `string` \| [`Refusal`](index.md#refusal)

The checkout JWT a buyer's checkout mandate commits to, for a checkout the business signed: its detached
`ap2.merchant_authorization` with the payload reinserted, `header.payload.signature`, the payload being the base64url
of the RFC 8785 form of the checkout without its `ap2` member, the bytes that signature covers (UCP 2026-08-25, the
AP2 Mandates extension, *Business Authorization*). UCP does not say which bytes are the checkout JWT; this is the
second of the two readings its open issue 905 sets out, and the profile states it as provisional. A checkout with no
`ap2.merchant_authorization` of the form `header..signature` is `ucp/ap2-not-active`; one with no RFC 8785 form is
`ucp/checkout-malformed`. No signature is verified.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`Checkout`](#checkout) |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### ChargePresented

Re-exports [ChargePresented](acp.md#chargepresented)

***

### ChargeRef

Re-exports [ChargeRef](acp.md#chargeref)
