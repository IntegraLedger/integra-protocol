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
| `Id` *extends* [`CardPairingId`](#cardpairingid-1) |
| `U` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-claims"></a> `claims` | `boolean` |
| <a id="property-id"></a> `id` | `Id` |
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

> **bound**(`presented`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

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

> **unplaced**(`option`): [`CardOption`](#cardoption)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`CardOption`](#cardoption) |

###### Returns

[`CardOption`](#cardoption)

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

A TAP payment request as received: the two signature fields and every `lcp-hash` field line.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-lcphash"></a> `lcpHash` | readonly `string`[] |
| <a id="property-signature"></a> `signature` | `string` |
| <a id="property-signatureinput"></a> `signatureInput` | `string` |

***

### TapUnsigned

What the agent's own RFC 9421 signer adds: the field, its value, and the component it lists.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-component"></a> `component` | `"lcp-hash"` |
| <a id="property-field"></a> `field` | `"lcp-hash"` |
| <a id="property-value"></a> `value` | `` `0x${string}` `` |

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

> **CardPairingId** = `"card/visa-tap"` \| `"card/mastercard-vi/immediate"` \| `"card/mastercard-vi/autonomous"` \| `"card/seller-reference"`

***

### CardScheme

> **CardScheme** = `"visa-tap"` \| `"mastercard-vi"` \| `"seller-reference"`

## Variables

### sellerReference

> `const` **sellerReference**: [`CardPairing`](#cardpairing)\<`"card/seller-reference"`, `never`\>

***

### TAP\_FIELD

> `const` **TAP\_FIELD**: `"lcp-hash"` = `"lcp-hash"`

***

### viAutonomous

> `const` **viAutonomous**: [`CardPairing`](#cardpairing)\<`"card/mastercard-vi/autonomous"`, [`ViUnsigned`](#viunsigned)\>

***

### viImmediate

> `const` **viImmediate**: [`CardPairing`](#cardpairing)\<`"card/mastercard-vi/immediate"`, [`ViUnsigned`](#viunsigned)\>

***

### visaTap

> `const` **visaTap**: [`CardPairing`](#cardpairing)\<`"card/visa-tap"`, [`TapUnsigned`](#tapunsigned)\>

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

### pairingsOf()

> **pairingsOf**(`o`): readonly [`CardPairingId`](#cardpairingid-1)[]

The pairings a well-formed option can be paid through: Verifiable Intent has two. Anything else has none.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | [`CardOption`](#cardoption) |

#### Returns

readonly [`CardPairingId`](#cardpairingid-1)[]

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
