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

### CardanoReader

Bounded, read-only calls against one network's indexer. Every failure rejects with `ReaderError`. `slotAt` answers
the slot of the block at a height, or null when the indexer holds no block at it. `transaction` answers `notFound`
when the indexer does not hold the transaction, with `slot`: the slot of the latest block the indexer that answered
held, read from that same indexer before the lookup, or null when the reader cannot read it from that indexer. A
lookup naming no slot never reads failed.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`CardanoNetwork`](#cardanonetwork) |

#### Methods

##### slotAt()

> **slotAt**(`blockHeight`): `Promise`\<`bigint` \| `null`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockHeight` | `bigint` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### tip()

> **tip**(): `Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

###### Returns

`Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

##### transaction()

> **transaction**(`txId`, `withCbor`): `Promise`\<[`CardanoOnChain`](#cardanoonchain) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txId` | `` `0x${string}` `` |
| `withCbor` | `boolean` |

###### Returns

`Promise`\<[`CardanoOnChain`](#cardanoonchain) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

***

### CardanoRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | [`CardanoNetwork`](#cardanonetwork) | - |
| <a id="property-ttlslot"></a> `ttlSlot` | `string` | The slot from which the transaction cannot land (body key 3, `invalid_hereafter`), as a decimal string. |
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

> **complete**(`signed`): `Promise`\<[`Refusal`](index.md#refusal) \| `CardanoPaymentPayload`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`CardanoPayload`](#cardanopayload) |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `CardanoPaymentPayload`\>

## Type Aliases

### CardanoNetwork

> **CardanoNetwork** = `"cardano:mainnet"` \| `"cardano:preprod"` \| `"cardano:preview"`

***

### CardanoStatus

> **CardanoStatus** = \{ `blockHeight`: `bigint`; `confirmations`: `bigint`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"phase-2-invalid"` \| `"expired"`; \}

## Variables

### exactCardano

> `const` **exactCardano**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoUnsigned`](#cardanounsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/cardano"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoRef`](#cardanoref)\>; `status`: (`ref`, `reader`, `depth`) => `Promise`\<[`CardanoStatus`](#cardanostatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

> **cardanoStatus**(`ref`, `reader`, `depth`): `Promise`\<[`CardanoStatus`](#cardanostatus)\>

Reads the tip first, then the recorded id. A failed read, or a reader for another network, is pending. `depth` is
the number of newer blocks at which the caller takes a settlement as final. The ledger takes a transaction only in a
slot below its TTL (cardano-ledger's Allegra `inInterval`: `slot < top`, the check Babbage and Conway run), so an
absent transaction is expired once the slot of the block `depth` below the tip is at or past `ttlSlot` and the lookup
names a slot at or past the tip's: a rollback of fewer than `depth` blocks, or a lookup that lags the tip read first,
never turns a payment that landed into a failed one. While that block's slot is below `ttlSlot`, the tip is fewer
than `depth` blocks high, the reader holds no block at that height, or the lookup names an earlier slot or none, it
is pending `not-found`. A present one fails only when the ledger marks it invalid. A `depth` that is not a
non-negative bigint is pending `unreadable`, and so is a ref whose `txId` is not `0x` and 64 hex digits, with nothing
read; the id is looked up in lowercase. At most three calls: `slotAt` only for an absent transaction once the tip's
slot is at or past `ttlSlot` and the lookup covers the tip, and not at `depth` 0, where the tip is that block.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CardanoRef`](#cardanoref) |
| `reader` | [`CardanoReader`](#cardanoreader) |
| `depth` | `bigint` |

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
