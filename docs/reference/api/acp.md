---
title: "@integraledger/lcp/acp"
description: "The exports of @integraledger/lcp/acp."
---

# @integraledger/lcp/acp

## Interfaces

### AcpBinding

#### Type Parameters

| Type Parameter |
| ------ |
| `Id` *extends* `string` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-id"></a> `id` | `Id` |
| <a id="property-pattern"></a> `pattern` | [`LcpPattern`](x402.md#lcppattern) |
| <a id="property-tie"></a> `tie` | (`options`) => \[`"acp"`, \{ `options`: readonly [`HandlerOption`](#handleroption)[]; \}\] |

#### Methods

##### advertise()

> **advertise**(`doc`, `h`, `link`, `offer`, `agreementUrl?`): [`Refusal`](index.md#refusal) \| [`Session`](#session)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | [`Session`](#session) |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `offer` | [`HandlerOption`](#handleroption) |
| `agreementUrl?` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`Session`](#session)

##### bound()

> **bound**(`presented`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

##### build()

> **build**(`choice`, `h`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `choice` | [`AcpChoice`](#acpchoice) |
| `h` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>

##### read()

> **read**(`doc`): [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `session`: [`Session`](#session); \}; \}

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | [`Session`](#session) |

###### Returns

[`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `session`: [`Session`](#session); \}; \}

##### unplaced()

> **unplaced**(`option`): [`HandlerOption`](#handleroption)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`HandlerOption`](#handleroption) |

###### Returns

[`HandlerOption`](#handleroption)

***

### AcpChoice

The buyer's own values for the allowance, and the session it pays.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-currency"></a> `currency` | `string` |
| <a id="property-expires_at"></a> `expires_at` | `string` |
| <a id="property-max_amount"></a> `max_amount` | `number` |
| <a id="property-merchant_id"></a> `merchant_id` | `string` |
| <a id="property-session"></a> `session` | [`Session`](#session) |

***

### Unsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-allowance"></a> `allowance` | [`Allowance`](#allowance) |

#### Methods

##### complete()

> **complete**(`request`): [`Refusal`](index.md#refusal) \| [`Presented`](#presented)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`Presented`](#presented) |

###### Returns

[`Refusal`](index.md#refusal) \| [`Presented`](#presented)

## Type Aliases

### Allowance

> **Allowance** = `object`

ACP's Allowance: six members, closed.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout_session_id"></a> `checkout_session_id` | `string` |
| <a id="property-currency-1"></a> `currency` | `string` |
| <a id="property-expires_at-1"></a> `expires_at` | `string` |
| <a id="property-max_amount-1"></a> `max_amount` | `number` |
| <a id="property-merchant_id-1"></a> `merchant_id` | `string` |
| <a id="property-reason"></a> `reason` | `"one_time"` |

***

### HandlerOption

> **HandlerOption** = `object`

The kind of payment handler a session offers: ACP's own `requires_delegate_payment` flag.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-requires_delegate_payment"></a> `requires_delegate_payment` | `boolean` |

***

### Presented

> **Presented** = `object` & `object`

The `delegate_payment` request as the agent signs it.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `allowance` | [`Allowance`](#allowance) |

***

### Session

> **Session** = `object` & `object`

A CheckoutSession. Every member other than `id` and `metadata.legal_context` is carried untouched.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `id?` | `string` |
| `metadata?` | `object` |

## Variables

### delegated

> `const` **delegated**: [`AcpBinding`](#acpbinding)\<`"acp/checkout/delegated"`\>

***

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

SHA-256 over the RFC 8785 form of an issued handler option.

***

### METADATA\_KEY

> `const` **METADATA\_KEY**: `"legal_context"` = `"legal_context"`

***

### undelegated

> `const` **undelegated**: [`AcpBinding`](#acpbinding)\<`"acp/checkout/undelegated"`\>

## Functions

### tie()

> **tie**(`options`): \[`"acp"`, \{ `options`: readonly [`HandlerOption`](#handleroption)[]; \}\]

The binding slot: one option per kind of payment handler the session offers, and nothing from the checkout.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`HandlerOption`](#handleroption)[] |

#### Returns

\[`"acp"`, \{ `options`: readonly [`HandlerOption`](#handleroption)[]; \}\]
