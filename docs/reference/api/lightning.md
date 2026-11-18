---
title: "@integraledger/lcp/lightning"
description: "BOLT11 invoices and the Lightning pairings: on x402 (`x402/exact/lnbtc/payment-hash`) the ATR commits the option's `extra.paymentHash`, and on MPP the seller's node writes the ATR hash as the invoice's description hash `h`."
---

# @integraledger/lcp/lightning

BOLT11 invoices and the Lightning pairings: on x402 (`x402/exact/lnbtc/payment-hash`) the ATR commits the option's
`extra.paymentHash`, and on MPP the seller's node writes the ATR hash as the invoice's description hash `h`.

The payment hash is that of the invoice the seller's node issues after the agreement. The payer signs nothing; it
pays the invoice.

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
| <a id="property-signer"></a> `signer` | `string` | The compressed secp256k1 public key that signed the invoice, as 66 lowercase hex digits: the `n` field's key where the invoice has one, and otherwise the key recovered from the signature. |
| <a id="property-tags"></a> `tags` | readonly `number`[] | Every tagged field's type, in invoice order. |
| <a id="property-timestamp"></a> `timestamp` | `number` | - |

***

### LnChoice

The buyer's choice: the 402 document, the option it pays, its validation time in Unix seconds, and its own request.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-now"></a> `now` | `number` | - |
| <a id="property-request"></a> `request` | [`LnbtcRequest`](#lnbtcrequest) | The request the buyer means to make, from which `build` computes the scheme's request hash. |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |

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
| <a id="property-request-1"></a> `request` | `object` |
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
| <a id="property-request-2"></a> `request` | `object` | The payer's node pays exactly this invoice. |
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

### ExactLnbtcReason

> **ExactLnbtcReason** = `"unsupported_scheme"` \| `"network_mismatch"` \| `"unsupported_network"` \| `"invalid_exact_lnbtc_asset"` \| `"invalid_exact_lnbtc_amount"` \| `"invalid_exact_lnbtc_amount_mismatch"` \| `"invalid_exact_lnbtc_pay_to_mismatch"` \| `"invalid_exact_lnbtc_pay_to_malformed"` \| `"invalid_exact_lnbtc_max_timeout_mismatch"` \| `"invalid_exact_lnbtc_extra_mismatch"` \| `"invalid_exact_lnbtc_request_binding"` \| `"invalid_exact_lnbtc_request_mismatch"` \| `"invalid_exact_lnbtc_asset_transfer_method"` \| `"invalid_exact_lnbtc_payment_flow"` \| `"invalid_exact_lnbtc_invoice_missing"` \| `"invalid_exact_lnbtc_invoice_decode_failed"` \| `"invalid_exact_lnbtc_invoice_description"` \| `"invalid_exact_lnbtc_invoice_request_mismatch"` \| `"invalid_exact_lnbtc_invoice_payee_mismatch"` \| `"invalid_exact_lnbtc_invoice_currency_mismatch"` \| `"invalid_exact_lnbtc_invoice_amount_mismatch"` \| `"invalid_exact_lnbtc_max_timeout"` \| `"invalid_exact_lnbtc_invoice_expiry_mismatch"` \| `"invalid_exact_lnbtc_invoice_created_in_future"` \| `"invalid_exact_lnbtc_invoice_payment_hash_mismatch"` \| `"invalid_exact_lnbtc_preimage_missing"` \| `"invalid_exact_lnbtc_preimage_malformed"` \| `"invalid_exact_lnbtc_preimage_length"` \| `"invalid_exact_lnbtc_preimage_hash_mismatch"` \| `"invalid_exact_lnbtc_invoice_expired"`

The scheme's `errorReason` strings its validation gives, and this form's one more.

***

### ExactLnbtcValidation

> **ExactLnbtcValidation** = \{ `network`: [`LnNetwork`](#lnnetwork); `paymentHash`: `string`; `valid`: `true`; \} \| \{ `reason`: [`ExactLnbtcReason`](#exactlnbtcreason); `valid`: `false`; \}

The validation's answer: the network and payment hash of the scheme's consumption key, or the scheme's reason.

***

### LnbtcRequest

> **LnbtcRequest** = \{ `body`: `Uint8Array`; `headers?`: [`LnHeaderFields`](#lnheaderfields); `method`: `string`; `profile`: `"http:1"`; `url`: `string`; \} \| \{ `arguments?`: [`Json`](index.md#json); `meta?`: [`Json`](index.md#json); `name`: `string`; `profile`: `"mcp:1"`; `server`: `string`; \}

The buyer's intended request, which the scheme's request binding commits to.

#### Union Members

##### Type Literal

\{ `body`: `Uint8Array`; `headers?`: [`LnHeaderFields`](#lnheaderfields); `method`: `string`; `profile`: `"http:1"`; `url`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `body` | `Uint8Array` | The content bytes after transfer decoding; empty where the request has no body. |
| `headers?` | [`LnHeaderFields`](#lnheaderfields) | - |
| `method` | `string` | The method, case kept. |
| `profile` | `"http:1"` | An HTTP request (the scheme's `http:1`). |
| `url` | `string` | The absolute URL the request is made to, its query included. |

***

##### Type Literal

\{ `arguments?`: [`Json`](index.md#json); `meta?`: [`Json`](index.md#json); `name`: `string`; `profile`: `"mcp:1"`; `server`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `arguments?` | [`Json`](index.md#json) | `params.arguments`; absent is `{}`. |
| `meta?` | [`Json`](index.md#json) | `params._meta`; absent is `{}`. |
| `name` | `string` | - |
| `profile` | `"mcp:1"` | An MCP `tools/call` (the scheme's `mcp:1`). |
| `server` | `string` | The MCP server the buyer means to call, as its own configuration spells it. |

***

### LnHeaderFields

> **LnHeaderFields** = `Readonly`\<`Record`\<`string`, `string` \| readonly `string`[]\>\>

A request's header fields as received: each field's name, in any case, with its lines in order, or its one line.

***

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
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.preimage` | `string` |
| <a id="property-resource"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### chargeLightning

> `const` **chargeLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `act?`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `act?`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge); \}\>

`mpp/charge/lightning`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice before the
preimage is presented. The seller's node, which received the payment, confirms it; `reference` names the invoice,
and no `status` reads it.

***

### exactLnbtcPaymentHash

> `const` **exactLnbtcPaymentHash**: `Readonly`\<\{ `advertise`: `X402Advertise`; `advertiseBeforeCarrier`: `X402Advertise`; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnUnsigned`](#lnunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/lnbtc/payment-hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/lnbtc/payment-hash`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice
before the preimage is presented. No ledger shows the payment, and no `status` reads it. `advertiseBeforeCarrier`
places the offer the seller issues before its node writes the invoice; `advertise` the option with the invoice.

***

### sessionLightning

> `const` **sessionLightning**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `act?`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `act?`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](#lnmppunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge); \}\>

`mpp/session/lightning`. `broadcaster` answers by the payment's action (`sessionBroadcasts`), for the actions
`channel.kind` takes. `"payer"`: the opening and a top-up, whose deposits the payer's node paid, and a bearer proof,
which draws on them; the seller's node, which received each deposit, confirms it, and no `status` reads it.
`"payee"`: the close, whose refund the seller's node pays. Any other action gets `ln/no-payment-in-action`, as `bound`
refuses it.

## Functions

### checkPreimage()

> **checkPreimage**(`preimage`, `paymentHash`): `true` \| [`Refusal`](index.md#refusal)

The preimage check: `true` where `preimage` is 64 lowercase hex digits whose SHA-256 is `paymentHash`, itself 64
lowercase hex digits; else `ln/preimage-malformed`, `ln/payment-hash-required` or `ln/preimage-mismatch`, in that
order. A resource server makes it before it serves a Lightning payment.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `preimage` | `string` |
| `paymentHash` | `string` |

#### Returns

`true` \| [`Refusal`](index.md#refusal)

***

### decodeBolt11()

> **decodeBolt11**(`invoice`): `Promise`\<[`Refusal`](index.md#refusal) \| [`Bolt11`](#bolt11)\<`ArrayBuffer`\>\>

Decodes a BOLT11 invoice of up to 8,192 characters strictly, past Bech32's 90-character limit, which BOLT 11 lets an
invoice exceed: exactly one `p` and one `s` field, at most one `n` field, and a signature that verifies, by the `n`
key where the invoice has one (a low `s` required) and otherwise by public-key recovery; `signer` is that key. An
invoice that fails is `ln/invoice-malformed`; one of more characters, or of more than 64 tagged fields, is
`ln/invoice-too-large`.

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

***

### validateExactLnbtc()

> **validateExactLnbtc**(`payload`, `requirements`, `at`): [`Refusal`](index.md#refusal) \| [`ExactLnbtcValidation`](#exactlnbtcvalidation)

x402's validation of `exact` on `lnbtc` (the scheme's Facilitator Validation, checks 1 to 7 and its Paid-but-expired
Policy), in the scheme's order, with this form's one check added at the end of check 5: the accepted invoice's `p`
is `requirements.extra.paymentHash` (`invalid_exact_lnbtc_invoice_payment_hash_mismatch`). `payload` is the payment
presented; `requirements` the ones the resource server built from its own record of the sale; `now` the validation
time and `skew` the clock-skew allowance, in seconds, 60 by default. A failure answers the scheme's `errorReason`; a
success answers the network and the payment hash of the scheme's consumption key. It moves nothing, reads nothing,
and records nothing: the resource server or a settler records the key once after it. A `now` or `skew` that is not a
non-negative safe integer is `ln/time-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `unknown` |
| `requirements` | `unknown` |
| `at` | \{ `now`: `number`; `skew?`: `number`; \} |
| `at.now` | `number` |
| `at.skew?` | `number` |

#### Returns

[`Refusal`](index.md#refusal) \| [`ExactLnbtcValidation`](#exactlnbtcvalidation)

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
