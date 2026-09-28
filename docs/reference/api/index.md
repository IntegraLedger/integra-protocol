---
title: "@integraledger/lcp"
description: "The exports of @integraledger/lcp."
---

# @integraledger/lcp

## Interfaces

### Authorizer

The optional member of a pull pairing whose payer signs an authorization that the chain executes later: the account
whose signature authorises the pull, from the presented payment, as lowercase hex. With the pairing's `reference`,
whose `authorization` names the nonce, the deadline and the token, it is what a settlement reader needs to read the
authorization's use before any transaction is named.

#### Methods

##### authorizer()?

> `optional` **authorizer**(`presented`): `Promise`\<`string` \| [`Refusal`](#refusal)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<`string` \| [`Refusal`](#refusal)\>

***

### CarrierAfterH

The optional member of a pairing whose carrier the seller writes after H: `advertise`'s checks and placement, without
the checks on that carrier.

#### Methods

##### advertiseBeforeCarrier()?

> `optional` **advertiseBeforeCarrier**(`doc`, `h`, `link`, `offer`, `agreementUrl?`): `unknown`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | `never` |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `offer` | `never` |
| `agreementUrl?` | `string` |

###### Returns

`unknown`

***

### PresentedOn

What the buyer presents as payment, per surface: the union of the payment types of every pairing on it. Every
pairing's `bound` and `reference` take `unknown` and check what they are given.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-ack"></a> `ack` | [`Json`](#json) | ACK defines no payer signature; its `bound` refuses whatever is presented. |
| <a id="property-acp"></a> `acp` | [`Presented`](acp.md#presented) | - |
| <a id="property-ap2"></a> `ap2` | [`Presented`](ap2.md#presented) | - |
| <a id="property-card"></a> `card` | [`TapPresented`](card.md#tappresented) \| [`ViImmediate`](card.md#viimmediate) \| [`ViAutonomous`](card.md#viautonomous) | - |
| <a id="property-mpp"></a> `mpp` | [`MppCredential`](mpp.md#mppcredential) | - |
| <a id="property-ucp"></a> `ucp` | [`Presented`](ap2.md#presented) | - |
| <a id="property-x402"></a> `x402` | [`PaymentPayload`](x402.md#paymentpayload) \| [`HederaPaymentPayload`](hedera.md#hederapaymentpayload) \| [`ExecutorPaymentPayload`](hedera.md#executorpaymentpayload) \| [`LnPaymentPayload`](lightning.md#lnpaymentpayload) \| [`AptosPaymentPayload`](aptos.md#aptospaymentpayload) \| [`AvmPaymentPayload`](avm.md#avmpaymentpayload) \| [`CardanoPaymentPayload`](cardano.md#cardanopaymentpayload) \| [`CasperPaymentPayload`](casper.md#casperpaymentpayload) \| [`CcdPaymentPayload`](ccd.md#ccdpaymentpayload) \| [`NearPayment`](near.md#nearpayment) \| [`PolkadotPaymentPayload`](polkadot.md#polkadotpaymentpayload) \| [`StarknetPayment`](starknet.md#starknetpayment) \| [`SuiPaymentPayload`](sui.md#suipaymentpayload) \| [`TronPayment`](tron.md#tronpayment) \| [`TvmPayment`](tvm.md#tvmpayment) \| [`BatchPaymentPayload`](x402-batch-settlement.md#batchpaymentpayload) \| [`CloudflarePaymentPayload`](x402-batch-settlement.md#cloudflarepaymentpayload) \| [`SvmPaymentPayload`](x402-exact-solana.md#svmpaymentpayload) \| [`StellarPaymentPayload`](x402-exact-stellar.md#stellarpaymentpayload) \| [`XrplPaymentPayload`](x402-exact-xrpl.md#xrplpaymentpayload) \| [`UptoSvmPaymentPayload`](x402-upto-solana.md#uptosvmpaymentpayload) | - |

***

### PushMode

The optional member of a push-mode pairing: the transaction its credential names, or undefined.

#### Methods

##### landedTx()?

> `optional` **landedTx**(`presented`): `string` \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`string` \| `undefined`

***

### TieRequestOn

The request a surface's `tie` takes with its options: x402's request commitment; the others' `tie` takes none.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-ack-1"></a> `ack` | `never` |
| <a id="property-acp-1"></a> `acp` | `never` |
| <a id="property-ap2-1"></a> `ap2` | `never` |
| <a id="property-card-1"></a> `card` | `never` |
| <a id="property-mpp-1"></a> `mpp` | `never` |
| <a id="property-ucp-1"></a> `ucp` | `never` |
| <a id="property-x402-1"></a> `x402` | [`RequestCommitment`](x402.md#requestcommitment) |

***

### TxSpelling

The optional member of a pairing whose rail spells one transaction id more than one way: the id in the one spelling
a record keeps.

#### Methods

##### txId()?

> `optional` **txId**(`tx`): `string`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `string` |

###### Returns

`string`

## Type Aliases

### AtrHash

> **AtrHash** = `` `0x${string}` ``

`0x` followed by 64 hex digits. Every hash this module emits is lowercase.

***

### Binding

> **Binding** = [`X402Binding`](#x402binding) \| [`MppBinding`](#mppbinding) \| *typeof* [`paymentRequest`](ack.md#paymentrequest) \| *typeof* [`delegated`](acp.md#delegated) \| *typeof* [`undelegated`](acp.md#undelegated) \| *typeof* [`checkoutMandate`](ap2.md#checkoutmandate) \| *typeof* [`viAutonomous`](card.md#viautonomous-1) \| *typeof* [`viImmediate`](card.md#viimmediate-1) \| *typeof* [`sellerReference`](card.md#sellerreference) \| *typeof* [`visaTap`](card.md#visatap) \| *typeof* [`bookingAp2Mandate`](ucp.md#bookingap2mandate) \| *typeof* [`bookingUnsigned`](ucp.md#bookingunsigned) \| *typeof* [`ap2Mandate`](ucp.md#ap2mandate) \| *typeof* [`unsigned`](ucp.md#unsigned-1) & [`PushMode`](#pushmode) & [`CarrierAfterH`](#carrierafterh) & [`TxSpelling`](#txspelling) & [`Authorizer`](#authorizer)

A pairing of protocol, scheme and rail.

***

### CoreRefusal

> **CoreRefusal** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-code"></a> `code` | `"core/slot-name"` \| `"core/slot-reserved"` \| `"core/slot-duplicate"` \| `"core/content-not-json"` \| `"core/binding-not-json"` \| `"core/too-large"` |
| <a id="property-refused"></a> `refused` | `true` |

***

### Json

> **Json** = `string` \| `number` \| `boolean` \| `null` \| readonly [`Json`](#json)[] \| \{\[`k`: `string`\]: [`Json`](#json); \}

A JSON value. Numbers in a binding value must be safe integers.

***

### MppBinding

> **MppBinding** = *typeof* [`MPP_BINDINGS`](mpp.md#mpp_bindings)\[`number`\]

An MPP pairing of intent and method.

***

### PairingId

> **PairingId** = [`Binding`](#binding)\[`"id"`\]

***

### PairingOn

> **PairingOn**\<`S`\> = `Extract`\<[`PairingId`](#pairingid), `` `${S}/${string}` ``\>

The pairing ids of one surface.

#### Type Parameters

| Type Parameter |
| ------ |
| `S` *extends* [`Surface`](#surface) |

***

### Presented

> **Presented** = [`PresentedOn`](#presentedon)\[[`Surface`](#surface)\]

What the buyer presents as payment.

***

### Refusal

> **Refusal** = `object`

A refusal returned as a value. `code` is `<entry point>/<reason>`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-code-1"></a> `code` | `string` |
| <a id="property-refused-1"></a> `refused` | `true` |

***

### Surface

> **Surface** = keyof [`PresentedOn`](#presentedon)

The surfaces: a pairing id's first "/" segment.

***

### X402Binding

> **X402Binding** = *typeof* [`exactEip3009`](x402.md#exacteip3009) \| *typeof* [`authCaptureEip3009`](x402.md#authcaptureeip3009) \| *typeof* [`authCapturePermit2`](x402.md#authcapturepermit2) \| *typeof* [`batchCloudflare`](x402-batch-settlement.md#batchcloudflare) \| *typeof* [`batchEvm`](x402-batch-settlement.md#batchevm) \| *typeof* [`batchSvm`](x402-batch-settlement.md#batchsvm) \| *typeof* [`exactAvm`](avm.md#exactavm) \| *typeof* [`exactAptos`](aptos.md#exactaptos) \| *typeof* [`exactCardano`](cardano.md#exactcardano) \| *typeof* [`exactCasper`](casper.md#exactcasper) \| *typeof* [`exactCcd`](ccd.md#exactccd) \| *typeof* [`exactErc7710`](x402.md#exacterc7710) \| *typeof* [`exactErc7710Salt`](x402.md#exacterc7710salt) \| *typeof* [`exactPermit2`](x402.md#exactpermit2) \| *typeof* [`exactHedera`](hedera.md#exacthedera) \| *typeof* [`exactHederaExecutor`](hedera.md#exacthederaexecutor) \| *typeof* [`exactLnbtc`](lightning.md#exactlnbtc) \| *typeof* [`exactLnbtcNamed`](lightning.md#exactlnbtcnamed) \| *typeof* [`exactNear`](near.md#exactnear) \| *typeof* [`exactPolkadotRemark`](polkadot.md#exactpolkadotremark) \| *typeof* [`exactSvm`](x402-exact-solana.md#exactsvm) \| *typeof* [`exactStarknet`](starknet.md#exactstarknet) \| *typeof* [`exactStellar`](x402-exact-stellar.md#exactstellar) \| *typeof* [`exactSui`](sui.md#exactsui) \| *typeof* [`exactTronMemo`](tron.md#exacttronmemo) \| *typeof* [`exactTvm`](tvm.md#exacttvm) \| *typeof* [`exactXrpl`](x402-exact-xrpl.md#exactxrpl) \| *typeof* [`uptoPermit2`](x402.md#uptopermit2) \| *typeof* [`uptoSvm`](x402-upto-solana.md#uptosvm)

An x402 pairing of scheme and rail.

## Variables

### BINDINGS

> `const` **BINDINGS**: readonly [`Binding`](#binding)[]

Every pairing this package implements.

***

### MAX\_JSON\_DEPTH

> `const` **MAX\_JSON\_DEPTH**: `64` = `64`

The deepest nesting of arrays and objects in any JSON this package writes or reads.

## Functions

### assemble()

> **assemble**(`id`, `binding`, `content`, `limits?`): `Promise`\<[`CoreRefusal`](#corerefusal) \| \{ `atrHash`: `` `0x${string}` ``; `bytes`: `Uint8Array`; \}\>

Writes the ATR's bytes and hashes them. The same inputs always give the same bytes. Every problem with the inputs
is returned as a refusal.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `binding` | readonly \[`string`, [`Json`](#json)\] |
| `content` | readonly readonly \[`string`, `Uint8Array`\<`ArrayBufferLike`\>\][] |
| `limits?` | \{ `maxBytes?`: `number`; \} |
| `limits.maxBytes?` | `number` |

#### Returns

`Promise`\<[`CoreRefusal`](#corerefusal) \| \{ `atrHash`: `` `0x${string}` ``; `bytes`: `Uint8Array`; \}\>

***

### canonicalJson()

> **canonicalJson**(`v`): `string` \| [`CoreRefusal`](#corerefusal)

The RFC 8785 form of `v`: object members sorted by the UTF-16 code units of their names, recursively, and every
primitive written as `JSON.stringify` writes it. Refuses what `digestJson` refuses.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `v` | [`Json`](#json) |

#### Returns

`string` \| [`CoreRefusal`](#corerefusal)

***

### canonicalTx()

> **canonicalTx**(`binding`, `tx`): `string`

A transaction id as a record keeps it: the pairing's `txId`, where it has one, else the id unchanged.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `binding` | [`Binding`](#binding) \| `undefined` |
| `tx` | `string` |

#### Returns

`string`

***

### digestJson()

> **digestJson**(`v`): `Promise`\<`` `0x${string}` `` \| [`CoreRefusal`](#corerefusal)\>

SHA-256 over the RFC 8785 form of `v`. Refuses a value deeper than 64 levels, a non-finite number, a string with
an unpaired surrogate, or anything that is not a JSON value.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `v` | [`Json`](#json) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`CoreRefusal`](#corerefusal)\>

***

### fromLcpString()

> **fromLcpString**(`s`): `` `0x${string}` `` \| `null`

Decodes `lcp:sha256:0x…`, returning the lowercase hash, or null for anything else.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `string` |

#### Returns

`` `0x${string}` `` \| `null`

***

### fromLegalContext()

> **fromLegalContext**(`o`): \{ `h`: `` `0x${string}` ``; `url`: `string`; \} \| `null`

Decodes the structured form: `type` "sha256", a 32-byte hash, and an `https://` link in either spelling. Returns
the lowercase hash and the link, or null for anything else, including two spellings that disagree. Other members
are ignored.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | `unknown` |

#### Returns

\{ `h`: `` `0x${string}` ``; `url`: `string`; \} \| `null`

***

### fromRawBytes()

> **fromRawBytes**(`b`): `` `0x${string}` `` \| `null`

The lowercase hash of exactly 32 raw bytes, or null.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `Uint8Array` |

#### Returns

`` `0x${string}` `` \| `null`

***

### hash()

> **hash**(`bytes`): `Promise`\<`` `0x${string}` ``\>

SHA-256 over the bytes as given, as `0x` and lowercase hex.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `bytes` | `Uint8Array` |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### hashEquals()

> **hashEquals**(`a`, `b`): `boolean`

True when `a` and `b` are each `0x` and 64 hex digits, in either case, and decode to the same 32 bytes (LCP §2.5).
Anything else is false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | `string` |
| `b` | `string` |

#### Returns

`boolean`

***

### isHashWithNonHttpsLink()

> **isHashWithNonHttpsLink**(`info`): `boolean`

True for a structured form's inner object that `fromLegalContext` would decode except that its one link, in either
spelling, is a link of another scheme (`isOtherSchemeLink`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `info` | `unknown` |

#### Returns

`boolean`

***

### isHttpsLink()

> **isHttpsLink**(`s`): `s is string`

The one https-link rule. The raw string holds no whitespace, control character or backslash; it parses as an
absolute URL; its scheme is `https`, compared case-insensitively (RFC 3986 §3.1); its authority has a host, a DNS
name or an IP literal, and no userinfo.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`s is string`

***

### isOtherSchemeLink()

> **isOtherSchemeLink**(`s`): `s is string`

True for a string of at most 2048 characters that parses as an absolute URL whose scheme is not `https`: the one
failing link refused as `link-not-https`. Every other failing link is `legal-context-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`s is string`

***

### jsonWithinDepth()

> **jsonWithinDepth**(`text`): `boolean`

True when no array or object in JSON text is nested more than `MAX_JSON_DEPTH` deep. Brackets inside strings are
skipped; nothing else about the text is checked.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`boolean`

***

### newAtrId()

> **newAtrId**(): `string`

A random RFC 9562 version 4 UUID, lowercase.

#### Returns

`string`

***

### pairingOf()

> **pairingOf**(`option`): [`PairingOn`](#pairingon)\<`"x402"`\> \| `undefined`

The x402 pairing that serves an option: a Lightning option's by `lnbtcPairingOf`, which names `x402/exact/lnbtc` for
an option whose invoice is not yet written; else the first x402 pairing in `BINDINGS` whose `read` offers it, on a
document holding that option alone. Undefined when none does.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

[`PairingOn`](#pairingon)\<`"x402"`\> \| `undefined`

***

### pairingsOfPlaced()

> **pairingsOfPlaced**(`c`): readonly [`MppPairing`](mpp.md#mpppairing)[]

The pairings a placed challenge offers: `pairingsOf` over the challenge with its `opaque` removed, so the LCP members
`place` wrote are not read as an occupied carrier. None when the challenge does not read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](mpp.md#mppchallenge) |

#### Returns

readonly [`MppPairing`](mpp.md#mpppairing)[]

***

### parseJson()

> **parseJson**(`text`): `unknown`

The value of JSON text nested at most `MAX_JSON_DEPTH` deep; undefined for text that is deeper or is not JSON.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`unknown`

***

### toLcpString()

> **toLcpString**(`h`): `string`

LCP §8.1 string form: `lcp:sha256:0x…`. Throws TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`string`

***

### toLegalContext()

> **toLegalContext**(`h`, `url`, `spelling?`): `object`

LCP §8.1 structured form, with the link beside the digest. `spelling` "snake" writes `legal_context_url`.
Throws TypeError when `h` is not a 32-byte hash or `url` is not an `https://` URL.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `h` | `` `0x${string}` `` | `undefined` |
| `url` | `string` | `undefined` |
| `spelling` | `"camel"` \| `"snake"` | `"camel"` |

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `legalContext` | `object` |
| `legalContext.legal_context_url?` | `string` |
| `legalContext.legalContextUrl?` | `string` |
| `legalContext.type` | `"sha256"` |
| `legalContext.value` | `` `0x${string}` `` |

***

### toRawBytes()

> **toRawBytes**(`h`): `Uint8Array`

The raw 32 bytes of a hash. Throws TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`

## References

### LcpPattern

Re-exports [LcpPattern](x402.md#lcppattern)
