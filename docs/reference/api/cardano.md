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

Bounded, read-only calls against one network's indexer. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable. `slotAt` answers the slot of the block at a height, or
null when the indexer holds no block at it. `transaction` answers `notFound` when the indexer does not hold the
transaction, with `slot`: the slot of the latest block the indexer that answered held, read from that same indexer
before the lookup, or null when the reader cannot read it from that indexer. A lookup naming no slot never reads
failed.

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
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
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
| `request.auxiliaryData` | `Uint8Array`\<`ArrayBuffer`\> |
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

> **CardanoStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `bigint`, `bigint`\>

The answer of `cardanoStatus`: positions are block heights, and marks are counts of confirmations, the newer blocks
above the transaction's; the final mark is the count the query asks for.

## Variables

### exactCardano

> `const` **exactCardano**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoUnsigned`](#cardanounsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/cardano"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoRef`](#cardanoref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CardanoStatus`](#cardanostatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/cardano`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
transaction the payer signed; `status` reads it by the id its body fixes.

***

### LCP\_MARKER

> `const` **LCP\_MARKER**: `"lcp:sha256:0x"` = `"lcp:sha256:0x"`

CIP-20 line 1 of the carrier; line 2 is the hash's 64 lowercase hex digits.

## Functions

### auxiliaryData()

> **auxiliaryData**(`h`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The exact auxiliary data the payer attaches: `#6.259({0: {674: {"msg": [LCP_MARKER, <64 hex>]}}})`. A value that is
not a 32-byte hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### cardanoRecover()

> **cardanoRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the hash back from the included transaction alone, by its id, `input.tx`. An input whose `tx` is not a 32-byte
hash, or whose option is not an object, is `cardano/wrong-reader`, with nothing read; the option is not read further. Bytes that are not one CBOR array whose first item, the body, has the id
as its Blake2b-256 are not the transaction the id names, and are `cardano/unreadable`, as a failed read is, whatever
the decoder answers for them; its refusals answer only for bytes whose body has the id. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`CardanoNetwork`](#cardanonetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`CardanoReader`](#cardanoreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### cardanoStatus()

> **cardanoStatus**(`ref`, `reader`, `query`): `Promise`\<[`CardanoStatus`](#cardanostatus)\>

The read of the payment by its transaction id, as the profile `read-status` answers it, with `query.finality` the
count of confirmations the caller takes as final, which is also the depth expiry is read at. A valid transaction
settles at that count or above it and is `below-mark` under it; an invalid one, an expired TTL and a transaction
not found answer `pending`, `search-incomplete`, since the read has no search for H.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CardanoRef`](#cardanoref) |
| `reader` | [`CardanoReader`](#cardanoreader) |
| `query` | `CardanoQuery` |

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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
