---
title: "@integraledger/lcp/card"
description: "The exports of @integraledger/lcp/card."
---

# @integraledger/lcp/card

## Interfaces

### CardOption

One card option offered at a checkout. `checkout` is the seller's own id: 1–128 visible ASCII characters.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout"></a> `checkout` | `string` |
| <a id="property-scheme"></a> `scheme` | [`CardScheme`](#cardscheme) |

***

### CardPairing

#### Type Parameters

| Type Parameter |
| ------ |
| `PairingId` *extends* [`CardPairingId`](#cardpairingid) |
| `U` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-data"></a> `data` | [`PairingData`](index.md#pairingdata) |
| <a id="property-id"></a> `id` | `PairingId` |
| <a id="property-pattern"></a> `pattern` | [`LcpPattern`](x402.md#lcppattern) |
| <a id="property-tie"></a> `tie` | (`options`) => \[`"card"`, \{ `options`: readonly [`CardOption`](#cardoption)[]; \}\] |

#### Methods

##### advertise()

> **advertise**(`doc`, `h`, `link`, `offer`, `agreementUrl?`): [`Refusal`](index.md#refusal) \| [`CardValues`](#cardvalues)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | `Record`\<`string`, `never`\> |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `offer` | [`CardOption`](#cardoption) |
| `agreementUrl?` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`CardValues`](#cardvalues)

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

> **build**(`doc`, `h`): `Promise`\<[`Refusal`](index.md#refusal) \| `U`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | `unknown` |
| `h` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `U`\>

##### read()

> **read**(`doc`): [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; \}

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | `unknown` |

###### Returns

[`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; \}

##### unplaced()

> **unplaced**(`option`): [`Refusal`](index.md#refusal) \| [`CardOption`](#cardoption)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`CardOption`](#cardoption) |

###### Returns

[`Refusal`](index.md#refusal) \| [`CardOption`](#cardoption)

***

### CardValues

The values the seller's own stack places: the legal context shown before payment, with the agreement URL after the
link when one is given, and the processor reference.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-legalcontext"></a> `legalContext` | `object` |
| `legalContext.legalContextAgreementUrl?` | `string` |
| `legalContext.legalContextUrl` | `string` |
| `legalContext.type` | `"sha256"` |
| `legalContext.value` | `` `0x${string}` `` |
| <a id="property-reference"></a> `reference` | `string` |

***

### TapPresented

A TAP or Agent Pay request as the merchant received it: its two signature fields and, where the merchant's checkout
path carries the hash, the request's absolute path without its query, as RFC 9421 §2.2.6 defines `@path`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-path"></a> `path?` | `string` |
| <a id="property-signature"></a> `signature` | `string` |
| <a id="property-signatureinput"></a> `signatureInput` | `string` |

***

### TapUnsigned

What the agent's own RFC 9421 signer places in every message signature of its checkout request: the `nonce`, the
padded base64 of the hash's 32 bytes followed by 32 random bytes.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-nonce"></a> `nonce` | `string` |

***

### ViAutonomous

The Autonomous chain. `l2` is exactly the presentation that L3b's `sd_hash` covers.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-l1"></a> `l1` | `string` |
| <a id="property-l2"></a> `l2` | `string` |
| <a id="property-l3b"></a> `l3b` | `string` |

***

### ViCheckoutChoice

Immediate mode with a `checkout_jwt` the agent creates: the checkout payload it will sign, and the JSON the seller
showed, whose `legalContext` member `build` writes into the payload.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-1"></a> `checkout` | `object` |
| <a id="property-shown"></a> `shown` | `unknown` |

***

### ViCheckoutUnsigned

The checkout payload with the seller's `legalContext` member, for the agent to sign as its `checkout_jwt`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkout-2"></a> `checkout` | `object` |

***

### VicPresented

A VIC transaction reference as the merchant reads it from the credential payload Visa signs for the sale.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-transactionreferenceid"></a> `transactionReferenceId` | `string` |

***

### VicUnsigned

The transaction reference the agent writes into its VIC credential request: the hash as unpadded base64url.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-transactionreferenceid-1"></a> `transactionReferenceId` | `string` |

***

### ViImmediate

L2 as presented: its JWS, then its disclosures, `~`-separated, ending in `~`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-l2-1"></a> `l2` | `string` |

***

### ViUnsigned

The checkout mandate for the wallet (L2) or the agent (L3b) to sign, and the payment mandate's `transaction_id`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkoutmandate"></a> `checkoutMandate` | `object` |
| `checkoutMandate.checkout_hash` | `string` |
| `checkoutMandate.checkout_jwt` | `string` |
| `checkoutMandate.vct` | `"mandate.checkout.1"` |
| <a id="property-transactionid"></a> `transactionId` | `string` |

## Type Aliases

### CardPairingId

> **CardPairingId** = `"card/visa-tap"` \| `"card/mastercard-vi/immediate"` \| `"card/mastercard-vi/autonomous"` \| `"card/seller-reference"` \| `"card/visa-vic"` \| `"card/mastercard-agent-pay"`

***

### CardScheme

> **CardScheme** = `"visa-tap"` \| `"mastercard-vi"` \| `"seller-reference"` \| `"visa-vic"` \| `"mastercard-agent-pay"`

## Variables

### agentPay

> `const` **agentPay**: [`CardPairing`](#cardpairing)\<`"card/mastercard-agent-pay"`, [`TapUnsigned`](#tapunsigned)\>

`card/mastercard-agent-pay`. TAP's carrier under Mastercard's two published `tag` spellings. The payee broadcasts
(`broadcaster` answers `"payee"`): the seller submits the card payment to its processor; nothing here reads it. A
value that is not an object gets `card/tap-signature-input-malformed`, as `bound` refuses it.

***

### MAX\_CHARGE\_REFERENCE

> `const` **MAX\_CHARGE\_REFERENCE**: `255` = `255`

The longest charge reference lcp reads, in characters: a resource bound on what the seller presents, the bound lcp's
Stripe subscription key takes for a Stripe ID (`mpp-card-stripe.ts`), which an Adyen `pspReference` (16 characters)
is well within.

***

### MAX\_CHECKOUT\_ID

> `const` **MAX\_CHECKOUT\_ID**: `128` = `128`

The longest checkout id a card option names, in characters.

***

### MAX\_CHECKOUT\_JWT

> `const` **MAX\_CHECKOUT\_JWT**: `16384` = `16_384`

The longest `checkout_jwt` lcp reads, in characters.

***

### MAX\_TAP\_COMPONENTS

> `const` **MAX\_TAP\_COMPONENTS**: `32` = `32`

The most items lcp parses in one inner list of a TAP signature field: a signature's covered components.

***

### MAX\_TAP\_FIELD

> `const` **MAX\_TAP\_FIELD**: `8192` = `8192`

The longest TAP `Signature-Input` or `Signature` field lcp parses, in characters.

***

### MAX\_TAP\_MEMBERS

> `const` **MAX\_TAP\_MEMBERS**: `16` = `16`

The most members lcp parses in one TAP signature field, an RFC 9651 Dictionary.

***

### MAX\_TAP\_PATH

> `const` **MAX\_TAP\_PATH**: `2048` = `2048`

The longest request path lcp reads from a TAP or Agent Pay request, in characters.

***

### MAX\_VI\_DISCLOSURES

> `const` **MAX\_VI\_DISCLOSURES**: `32` = `32`

The most disclosures lcp reads in one Verifiable Intent layer.

***

### MAX\_VI\_LAYER

> `const` **MAX\_VI\_LAYER**: `65536` = `65_536`

The longest Verifiable Intent layer, an SD-JWT with its disclosures, lcp reads, in characters.

***

### sellerReference

> `const` **sellerReference**: [`CardPairing`](#cardpairing)\<`"card/seller-reference"`, `never`\> & `object`

`card/seller-reference`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment
to its processor, with H in its processor reference; nothing here reads it. `reference` names the charge by the
seller's own reference for it.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `reference()` | (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ChargeRef`](acp.md#chargeref)\> |

***

### viAutonomous

> `const` **viAutonomous**: [`CardPairing`](#cardpairing)\<`"card/mastercard-vi/autonomous"`, [`ViUnsigned`](#viunsigned)\>

`card/mastercard-vi/autonomous`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card
payment the mandates authorize to its processor; nothing here reads it. A value that is not an object gets
`card/vi-malformed`, as `bound` refuses it.

***

### viImmediate

> `const` **viImmediate**: [`CardPairing`](#cardpairing)\<`"card/mastercard-vi/immediate"`, [`ViUnsigned`](#viunsigned) \| [`ViCheckoutUnsigned`](#vicheckoutunsigned)\>

`card/mastercard-vi/immediate`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card
payment the mandate authorizes to its processor; nothing here reads it. A value that is not an object gets
`card/vi-malformed`, as `bound` refuses it.

***

### visaTap

> `const` **visaTap**: [`CardPairing`](#cardpairing)\<`"card/visa-tap"`, [`TapUnsigned`](#tapunsigned)\>

`card/visa-tap`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment to its
processor; nothing here reads it. A value that is not an object gets `card/tap-signature-input-malformed`, as
`bound` refuses it.

***

### visaVic

> `const` **visaVic**: [`CardPairing`](#cardpairing)\<`"card/visa-vic"`, [`VicUnsigned`](#vicunsigned)\>

`card/visa-vic`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment with the
credential Visa issued for the sale to its processor; nothing here reads it. A value that is not an object gets
`card/vic-reference-malformed`, as `bound` refuses it.

## Functions

### disclosureDigest()

> **disclosureDigest**(`s`): `Promise`\<`string`\>

base64url, unpadded, of SHA-256 over the US-ASCII characters of `s` (RFC 9901 §4.2.3).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `string` |

#### Returns

`Promise`\<`string`\>

***

### tie()

> **tie**(`options`): \[`"card"`, \{ `options`: readonly [`CardOption`](#cardoption)[]; \}\]

The binding slot: every card option offered at this checkout, exactly as issued.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`CardOption`](#cardoption)[] |

#### Returns

\[`"card"`, \{ `options`: readonly [`CardOption`](#cardoption)[]; \}\]

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### ChargePresented

Re-exports [ChargePresented](acp.md#chargepresented)

***

### ChargeRef

Re-exports [ChargeRef](acp.md#chargeref)
