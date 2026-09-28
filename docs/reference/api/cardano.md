---
title: "@integraledger/lcp/cardano"
description: "The exports of @integraledger/lcp/cardano."
---

# @integraledger/lcp/cardano

## Interfaces

### CardanoOnChain

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` | - |
| <a id="property-cbor"></a> `cbor?` | `Uint8Array`\<`ArrayBufferLike`\> | The transaction as included, when asked for. |
| <a id="property-slot"></a> `slot` | `bigint` | - |
| <a id="property-valid"></a> `valid` | `boolean` | db-sync's `tx.valid_contract`. |

***

### CardanoPayload

The payload x402's Cardano scheme defines.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### CardanoPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | [`CardanoPayload`](#cardanopayload) |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

***

### CardanoReader

Bounded, read-only calls against one network's indexer. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`CardanoNetwork`](#cardanonetwork) |

#### Methods

##### tip()

> **tip**(): `Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

###### Returns

`Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

##### transaction()

> **transaction**(`txId`, `withCbor`): `Promise`\<[`CardanoOnChain`](#cardanoonchain) \| `null`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txId` | `` `0x${string}` `` |
| `withCbor` | `boolean` |

###### Returns

`Promise`\<[`CardanoOnChain`](#cardanoonchain) \| `null`\>

***

### CardanoRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | [`CardanoNetwork`](#cardanonetwork) | - |
| <a id="property-ttlslot"></a> `ttlSlot` | `string` | The last slot the transaction can land in, as a decimal string. |
| <a id="property-txid"></a> `txId` | `` `0x${string}` `` | - |

***

### CardanoTx

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-h"></a> `h` | [`Refusal`](index.md#refusal) \| `` `0x${string}` `` |
| <a id="property-ttlslot-1"></a> `ttlSlot` | `bigint` \| `null` |
| <a id="property-txid-1"></a> `txId` | `` `0x${string}` `` |

***

### CardanoUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.auxiliaryData` | `Uint8Array` |
| `request.kind` | `"cardano-transaction"` |

#### Methods

##### complete()

> **complete**(`signed`): `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoPaymentPayload`](#cardanopaymentpayload)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`CardanoPayload`](#cardanopayload) |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoPaymentPayload`](#cardanopaymentpayload)\>

## Type Aliases

### CardanoNetwork

> **CardanoNetwork** = `"cardano:mainnet"` \| `"cardano:preprod"` \| `"cardano:preview"`

***

### CardanoStatus

> **CardanoStatus** = \{ `blockHeight`: `bigint`; `confirmations`: `bigint`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"phase-2-invalid"` \| `"expired"`; \}

## Variables

### exactCardano

> `const` **exactCardano**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoUnsigned`](#cardanounsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/cardano"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoRef`](#cardanoref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`CardanoStatus`](#cardanostatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### LCP\_MARKER

> `const` **LCP\_MARKER**: `"lcp:sha256:0x"` = `"lcp:sha256:0x"`

CIP-20 line 1 of the carrier; line 2 is the hash's 64 lowercase hex digits.

## Functions

### auxiliaryData()

> **auxiliaryData**(`h`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

The exact auxiliary data the payer attaches: `#6.259({0: {674: {"msg": [LCP_MARKER, <64 hex>]}}})`. A value that is
not a 32-byte hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

***

### cardanoOptionCheck()

> **cardanoOptionCheck**(`option`): [`Refusal`](index.md#refusal) \| `undefined`

The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| `undefined`

***

### cardanoPairingOf()

> **cardanoPairingOf**(`option`): `"x402/exact/cardano"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/cardano"` \| `undefined`

***

### cardanoRecover()

> **cardanoRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the hash back from the included transaction alone, by its id. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: [`CardanoNetwork`](#cardanonetwork); `txId`: `` `0x${string}` ``; \} |
| `ref.network` | [`CardanoNetwork`](#cardanonetwork) |
| `ref.txId` | `` `0x${string}` `` |
| `reader` | [`CardanoReader`](#cardanoreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### cardanoStatus()

> **cardanoStatus**(`ref`, `reader`): `Promise`\<[`CardanoStatus`](#cardanostatus)\>

Reads the recorded id. A failed read, or a reader for another network, is pending. An absent transaction is
expired once the tip's slot is past its TTL; a present one fails only when the ledger marks it invalid. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CardanoRef`](#cardanoref) |
| `reader` | [`CardanoReader`](#cardanoreader) |

#### Returns

`Promise`\<[`CardanoStatus`](#cardanostatus)\>

***

### decodeCardanoTx()

> **decodeCardanoTx**(`base64`): `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoTx`](#cardanotx)\>

Decodes a base64 transaction `[body, witness set, bool, auxiliary data / nil]`, keeping each item's bytes as
received. The id is the Blake2b-256 of the body's bytes; the auxiliary data must hash to the body's key 7.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `base64` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoTx`](#cardanotx)\>
