---
title: "@integraledger/lcp/acp"
description: "ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`."
---

# @integraledger/lcp/acp

ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and
`acp/checkout/undelegated`: the ATR hash as the checkout session's `id`.

The link rides beside it in the session's `metadata.legal_context`, and, where the handler requires
`delegate_payment`, the hash is also the allowance's `checkout_session_id`. Pure; no I/O. Nothing here signs or
verifies a signature.

## Interfaces

### AcpBinding

The shape of an ACP pairing: its id, data, binding record and codec.

#### Type Parameters

| Type Parameter |
| ------ |
| `Id` *extends* `string` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-data"></a> `data` | [`PairingData`](index.md#pairingdata) |
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

> **unplaced**(`option`): [`Refusal`](index.md#refusal) \| [`HandlerOption`](#handleroption)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`HandlerOption`](#handleroption) |

###### Returns

[`Refusal`](index.md#refusal) \| [`HandlerOption`](#handleroption)

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

### ChargePresented

What the seller presents of a charge: its own reference for it, the processor's identifier of the payment.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-charge"></a> `charge` | `string` | 1 to 255 visible ASCII characters: a Stripe PaymentIntent's `id`, an Adyen `pspReference`. |

***

### ChargeRef

The reference of a charge: the checkout of the option it answers, where the option names one, and the charge.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-charge-1"></a> `charge` | `string` |
| <a id="property-checkout"></a> `checkout?` | `string` |

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

`acp/checkout/delegated`. The payee broadcasts (`broadcaster` answers `"payee"` for a payment within `bound`'s shape
gate, `allowanceShape`): the seller's PSP charges the vault token the buyer's agent obtained; nothing here reads it.
Any other value gets `acp/allowance-malformed`, as `bound` refuses it.

***

### issuedDigest

> `const` **issuedDigest**: *typeof* [`digestJson`](index.md#digestjson) = `digestJson`

SHA-256 over the RFC 8785 form of an issued handler option.

***

### METADATA\_KEY

> `const` **METADATA\_KEY**: `"legal_context"` = `"legal_context"`

The member of a CheckoutSession's `metadata` that carries the ATR hash and link.

***

### undelegated

> `const` **undelegated**: [`AcpBinding`](#acpbinding)\<`"acp/checkout/undelegated"`\> & `object`

`acp/checkout/undelegated`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's payment handler
charges the payment the checkout completed; nothing here reads it. `reference` names the charge by the seller's own
reference for it.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `reference()` | (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ChargeRef`](#chargeref)\> |

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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
