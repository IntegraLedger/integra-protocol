---
title: "@integraledger/lcp/stellar"
description: "The exports of @integraledger/lcp/stellar."
---

# @integraledger/lcp/stellar

## Interfaces

### StellarPayment

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-auth"></a> `auth` | `object` |
| `auth.address` | `string` |
| `auth.expiration` | `number` |
| `auth.nonce` | `bigint` |
| `auth.preimageHash` | `` `0x${string}` `` |
| `auth.v2` | `boolean` |
| <a id="property-from"></a> `from` | `string` |
| <a id="property-to"></a> `to` | `string` |
| <a id="property-tobase"></a> `toBase` | `string` |
| <a id="property-toid"></a> `toId` | `bigint` \| `null` |

***

### StellarReader

Bounded, read-only calls against one network's RPC. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`StellarNetwork`](#stellarnetwork) |

#### Methods

##### latestLedger()

> **latestLedger**(): `Promise`\<`number`\>

`getLatestLedger`.

###### Returns

`Promise`\<`number`\>

##### transaction()

> **transaction**(`hash`): `Promise`\<\{ `envelopeXdr?`: `string`; `ledger?`: `number`; `oldestLedger`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"NOT_FOUND"`; \}\>

`getTransaction`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<\{ `envelopeXdr?`: `string`; `ledger?`: `number`; `oldestLedger`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"NOT_FOUND"`; \}\>

##### transfers()

> **transfers**(`f`): `Promise`\<\{ `complete`: `boolean`; `cursor?`: `string`; `events`: readonly `object`[]; `oldestLedger`: `number`; \}\>

One page of SEP-41 `transfer` events of `asset` to `toBase` between two ledgers, with each event's `to_muxed_id`.
`cursor` is present while more pages remain. `complete` is false when the RPC reports events disabled.
`oldestLedger` is the oldest ledger the RPC still holds.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `f` | \{ `asset`: `string`; `cursor?`: `string`; `fromLedger`: `number`; `toBase`: `string`; `toLedger`: `number`; \} |
| `f.asset` | `string` |
| `f.cursor?` | `string` |
| `f.fromLedger` | `number` |
| `f.toBase` | `string` |
| `f.toLedger` | `number` |

###### Returns

`Promise`\<\{ `complete`: `boolean`; `cursor?`: `string`; `events`: readonly `object`[]; `oldestLedger`: `number`; \}\>

***

### StellarRef

The read keys recorded at claim.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset-1"></a> `asset` | `string` | - |
| <a id="property-authdigest"></a> `authDigest` | `` `0x${string}` `` | - |
| <a id="property-expiration"></a> `expiration` | `number` | - |
| <a id="property-fromledger"></a> `fromLedger` | `number` | - |
| <a id="property-network-1"></a> `network` | [`StellarNetwork`](#stellarnetwork) | - |
| <a id="property-tobase-1"></a> `toBase` | `string` | - |
| <a id="property-toid-1"></a> `toId` | `string` | The muxed id, as a decimal string. |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

***

### StellarUnsigned

What the payer signs (the signer signs SHA-256 of `preimage`), and how the signature completes the transaction.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"stellar-auth"` |
| `request.preimage` | `Uint8Array` |

#### Methods

##### complete()

> **complete**(`signature`): `string` \| [`Refusal`](index.md#refusal)

The base64 XDR of the transaction with the entry signed.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

`string` \| [`Refusal`](index.md#refusal)

## Type Aliases

### StellarNetwork

> **StellarNetwork** = `"stellar:pubnet"` \| `"stellar:testnet"`

***

### StellarStatus

> **StellarStatus** = \{ `ledger`: `number`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"failed"` \| `"not-this-instrument"`; \}

## Variables

### PASSPHRASE

> `const` **PASSPHRASE**: `Readonly`\<`Record`\<[`StellarNetwork`](#stellarnetwork), `string`\>\>

Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8
bytes, the digest of the signed authorization entry, and settlement read through a bounded reader.

***

### SCVAL\_MAX\_DEPTH

> `const` **SCVAL\_MAX\_DEPTH**: `64` = `64`

The deepest nesting of ScVal vectors and maps (a contract instance's storage counting as a map) within one ScVal,
the outermost container being level 1, and of authorized invocations within one authorization entry.

***

### SCVAL\_MAX\_ELEMENTS

> `const` **SCVAL\_MAX\_ELEMENTS**: `number`

The most ScVal vector elements and map entries in one envelope. Each takes at least its 4-byte discriminant, so no
envelope within `MAX_XDR` base64 characters holds more.

## Functions

### decodeStellarTx()

> **decodeStellarTx**(`xdrB64`, `network`): [`Refusal`](index.md#refusal) \| [`StellarPayment`](#stellarpayment)

Decodes a base64 `TransactionEnvelope` (v1, or a fee bump's inner v1) of at most 8 KiB holding exactly one
`invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract, and the one authorization entry
with address credentials (`sorobanCredentialsAddress` or `sorobanCredentialsAddressV2`) whose address is `from`.
The entry's `rootInvocation` must be that same `transfer`, byte for byte, with no sub-invocations; the payment's
contract, `to` and amount are the signed invocation's. The base64 is read strictly (RFC 4648 §4, zero padding bits),
and the XDR must be consumed whole. `preimageHash` is SHA-256 of that entry's `HashIDPreimage` under the network's
passphrase: the V1 form, or for V2 the form with the address.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xdrB64` | `string` |
| `network` | [`StellarNetwork`](#stellarnetwork) |

#### Returns

[`Refusal`](index.md#refusal) \| [`StellarPayment`](#stellarpayment)

***

### muxedFor()

> **muxedFor**(`base`, `h`): `string`

The `M…` strkey of a `G…` account and `muxedId(h)`. Throws TypeError when `base` is not a `G…` strkey.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `base` | `string` |
| `h` | `` `0x${string}` `` |

#### Returns

`string`

***

### muxedId()

> **muxedId**(`h`): `bigint`

The hash's first 8 bytes, big-endian, as a u64.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`bigint`

***

### scValsWithinCaps()

> **scValsWithinCaps**(`wire`): `boolean`

True when every ScVal in a decoded XDR value nests at most `SCVAL_MAX_DEPTH` vectors and maps, every authorized
invocation at most `SCVAL_MAX_DEPTH` sub-invocations, and the value holds at most `SCVAL_MAX_ELEMENTS` vector
elements and map entries. The walk keeps its own stack.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `unknown` |

#### Returns

`boolean`

***

### stellarLocate()

> **stellarLocate**(`ref`, `reader`): `Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

Finds the instrument when no transaction was named: the asset's transfer events to `toBase` from `fromLedger` to
the entry's expiration, keeping those whose muxed id is `toId`, each read as `stellarStatus` does. `complete` is
true only when every page was read, the reader reported events enabled on each, the RPC still held `fromLedger`
(`oldestLedger` ≤ `fromLedger`), and every candidate was read: a listed candidate whose transaction reads pending
leaves the search incomplete. At most 10 pages and 50 candidates.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StellarRef`](#stellarref) |
| `reader` | [`StellarReader`](#stellarreader) |

#### Returns

`Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

***

### stellarStatus()

> **stellarStatus**(`ref`, `reader`): `Promise`\<[`StellarStatus`](#stellarstatus)\>

Reads a named transaction. Settled when it succeeded and its authorization entry's preimage digest and `to` id are
the ones recorded at claim. A failed read, or a reader for another network, is pending. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StellarRef`](#stellarref) & `object` |
| `reader` | [`StellarReader`](#stellarreader) |

#### Returns

`Promise`\<[`StellarStatus`](#stellarstatus)\>

***

### transferEventOf()

> **transferEventOf**(`topic`, `value`): [`Refusal`](index.md#refusal) \| \{ `toBase`: `string`; `toMuxedId`: `bigint` \| `null`; \}

A `transfer` event's recipient (the non-muxed `to` topic) and its `to_muxed_id`: the u64 in the event's data map, or
null when the data carries none, or carries the string or bytes form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `topic` | readonly `string`[] |
| `value` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `toBase`: `string`; `toMuxedId`: `bigint` \| `null`; \}

***

### transferEventTopics()

> **transferEventTopics**(`toBase`): readonly `string`[] \| [`Refusal`](index.md#refusal)

The `getEvents` topic filter for SEP-41 `transfer` events to `toBase`, as base64 XDR segments: the symbol
`transfer`, any `from`, `toBase` as an address, and any trailing topics (the Stellar Asset Contract adds its asset).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `toBase` | `string` |

#### Returns

readonly `string`[] \| [`Refusal`](index.md#refusal)
