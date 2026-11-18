---
title: "@integraledger/lcp/ap2"
description: "AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the `legalContext` member of the merchant-signed `checkout_jwt` payload, which the buyer's closed Checkout Mandate commits to through `checkout_hash`."
---

# @integraledger/lcp/ap2

AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the
`legalContext` member of the merchant-signed `checkout_jwt` payload, which the buyer's closed Checkout Mandate
commits to through `checkout_hash`.

The hash is read back from the checkout JWT presented beside the mandate. The mandate is presented alone, or last in
AP2's chain after the open mandate. In AP2's push funding, where the payer's side sends the funds, the presentation
also carries the confirmation of funds sent, `payment_receipt`. Nothing here verifies a signature, a `cnf` delegation
or a link between hops.

## Interfaces

### Ap2Offer

The offer `read` gives, and the buyer's input to `build`: the merchant's `checkout_jwt` (`checkoutJwt`), its decoded
payload, and the checkout's own `id` (`checkout`).

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

#### Extended by

- [`X402Presented`](#x402presented)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-checkout_jwt-1"></a> `checkout_jwt` | `string` | The checkout JWT presented beside the mandate. For AP2's latest-checkout check, the seller passes the one it last sent for this checkout; the buyer's copy shows only that the mandate and that JWT agree. |
| <a id="property-checkout_mandate"></a> `checkout_mandate` | `string` | The closed Checkout Mandate as presented: one SD-JWT, or AP2's chain of the open mandate's SD-JWT and the closed mandate's, joined by `~~`. |
| <a id="property-payment_receipt"></a> `payment_receipt?` | `object` | Present only in AP2's push funding, where the payment method pushes funds to the merchant and the merchant receives confirmation of funds sent instead of a payment credential: that confirmation, AP2's Payment Receipt as the payer's side gives it, a JSON object carried whole and read by nothing here. Absent where the merchant initiates the charge. |

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

***

### X402Authorization

The EIP-3009 `TransferWithAuthorization` AP2's x402 credential carries, its numbers as decimal strings.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-from"></a> `from` | `string` | - |
| <a id="property-nonce"></a> `nonce` | `string` | keccak-256 of the payment mandate chain's UTF-8 text, as 64 hex digits, with or without `0x`. |
| <a id="property-to"></a> `to` | `string` | - |
| <a id="property-validafter"></a> `validAfter` | `string` | - |
| <a id="property-validbefore"></a> `validBefore` | `string` | - |
| <a id="property-value"></a> `value` | `string` | - |

***

### X402Bundle

AP2's x402 payment credential: the payment mandate chain, its nonce, and the signed EIP-3009 authorization.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-eip_3009_payload"></a> `eip_3009_payload` | `object` |
| `eip_3009_payload.authorization` | [`X402Authorization`](#x402authorization) |
| `eip_3009_payload.signature` | `string` |
| <a id="property-payment_mandate_chain"></a> `payment_mandate_chain` | `string` |
| <a id="property-payment_nonce"></a> `payment_nonce` | `string` |

***

### X402Method

AP2's x402 payment method, as the merchant names it in the checkout's `accepted_payment_methods`, with the token the
authorization moves, which AP2's method does not name.

#### Indexable

> \[`k`: `string`\]: [`Json`](index.md#json)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-address"></a> `address` | `string` | The account the payment pays. |
| <a id="property-asset"></a> `asset` | `string` | The token under whose EIP-712 domain the authorization is signed, a 20-byte address: the merchant's own configuration of the method, as x402's option names it `asset`. |
| <a id="property-network"></a> `network` | `string` | The network: an `eip155:<chain id>` CAIP-2 id, or an x402 v1 EVM network name as AP2 writes it (`base-sepolia`). |
| <a id="property-type"></a> `type` | `"x402"` | - |

***

### X402Presented

The checkout mandate as `ap2/checkout-mandate` takes it, with the x402 credential the merchant received.

#### Extends

- [`Presented`](#presented)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-checkout_jwt-2"></a> `checkout_jwt` | `string` | The checkout JWT presented beside the mandate. For AP2's latest-checkout check, the seller passes the one it last sent for this checkout; the buyer's copy shows only that the mandate and that JWT agree. | [`Presented`](#presented).[`checkout_jwt`](#property-checkout_jwt-1) |
| <a id="property-checkout_mandate-1"></a> `checkout_mandate` | `string` | The closed Checkout Mandate as presented: one SD-JWT, or AP2's chain of the open mandate's SD-JWT and the closed mandate's, joined by `~~`. | [`Presented`](#presented).[`checkout_mandate`](#property-checkout_mandate) |
| <a id="property-payment"></a> `payment` | [`X402Bundle`](#x402bundle) | - | - |
| <a id="property-payment_receipt-1"></a> `payment_receipt?` | `object` | Present only in AP2's push funding, where the payment method pushes funds to the merchant and the merchant receives confirmation of funds sent instead of a payment credential: that confirmation, AP2's Payment Receipt as the payer's side gives it, a JSON object carried whole and read by nothing here. Absent where the merchant initiates the charge. | [`Presented`](#presented).[`payment_receipt`](#property-payment_receipt) |

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

***

### X402Ref

> **X402Ref** = [`Eip3009Ref`](evm.md#eip3009ref) & `Omit`\<[`EvmRef`](evm.md#evmref), `"network"` \| `"payee"` \| `"transaction"`\> & `object`

The read keys of the x402 credential: the keys of `x402/exact/eip155/eip3009`'s reference, the authorization's own
nonce standing where that pairing's reference has H, so that the carried pairing's `status` reads the payment; and
the authorization's members as presented. The authorization's `nonce` is its single-use value.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `authorization` | [`PullAuthorization`](evm.md#pullauthorization) |
| `from` | `string` |
| `idDigest` | [`Hex`](evm.md#hex) |
| `nonce` | `string` |
| `to` | `string` |
| `transferLog` | [`TransferLog`](evm.md#transferlog) |
| `validAfter` | `string` |
| `validBefore` | `string` |
| `value` | `string` |

## Variables

### CHECKOUT\_VCT

> `const` **CHECKOUT\_VCT**: `"mandate.checkout.1"` = `"mandate.checkout.1"`

***

### checkoutMandate

> `const` **checkoutMandate**: `Readonly`\<\{ `advertise`: (`payload`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`Payload`](#payload); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`offer`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"ap2/checkout-mandate"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`Ap2Offer`](#ap2offer); \}; `tie`: (`options`) => \[`"ap2"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`CheckoutOption`](#checkoutoption); \}\>

`ap2/checkout-mandate`. Where the merchant initiates the charge, the payee broadcasts (`broadcaster` answers
`"payee"`): the seller's payment processor executes the payment the closed Checkout Mandate authorizes. In AP2's
push funding the presentation carries `payment_receipt` and the payer broadcasts (`"payer"`): its side sent the funds
before the merchant saw them. Nothing here reads the payment. A value outside `bound`'s shape gate gets the refusal
`bound` gives it.

***

### checkoutMandateX402

> `const` **checkoutMandateX402**: `Readonly`\<\{ `advertise`: (`payload`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`Payload`](#payload); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`offer`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Unsigned`](#unsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"ap2/checkout-mandate/x402"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`Ap2Offer`](#ap2offer); \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`X402Ref`](#x402ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>\>; `tie`: (`options`) => \[`"ap2"`, \{ `options`: readonly [`CheckoutOption`](#checkoutoption)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`CheckoutOption`](#checkoutoption); \}\>

`ap2/checkout-mandate/x402`. The payee broadcasts (`broadcaster` answers `"payee"`): the merchant forwards AP2's x402
credential to its payment processor, which submits the authorization. `status` reads it by this pairing's
`reference` as `x402/exact/eip155/eip3009`'s read does, at coverage `none`, the authorization's own nonce standing
where that pairing has H. A value that is not a JSON object gets `ap2/mandate-malformed`, as `bound` refuses it.

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

The payload of a compact JWS, decoded as one JSON object. Each segment is base64url without padding in its canonical
form (RFC 7515 §2, RFC 4648 §3.5); a JWS with a segment in another form is `ap2/jws-malformed`. The signature is
never verified.

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
`issuer_jwt_hash` link to the open one; the open mandate's constraints are not read. Each segment of each hop's
issuer-signed JWT and each disclosure is base64url without padding in its canonical form (RFC 4648 §3.5), or the
mandate is `ap2/mandate-malformed`; the last hop's Key Binding JWT is not read. A hop whose payload, with each
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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
