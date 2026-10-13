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

Bounded, read-only calls against one network's RPC. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable.

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

> **transfers**(`f`): `Promise`\<\{ `complete`: `boolean`; `cursor?`: `string`; `events`: readonly `object`[]; `latestLedger`: `number`; `oldestLedger`: `number`; \}\>

One page of SEP-41 `transfer` events of `asset` to `toBase` from `fromLedger` through `toLedger`, both inclusive,
with each event's `to_muxed_id`. `stellarLocate` passes the authorization entry's expiration ledger as `toLedger`,
and the entry can still be used in that ledger. `cursor` is present while more pages remain: until the search has
read through `toLedger`. `complete` is false when the RPC reports events disabled. `oldestLedger` is the oldest
ledger the RPC still holds, and `latestLedger` the latest ledger it held when it answered (`getEvents`'
`latestLedger`). Stellar RPC's `getEvents` treats `endLedger` as exclusive, takes a cursor or a ledger range but
not both, and scans a bounded number of ledgers per call (10,000 in stellar-rpc), so a reader over it sends
`startLedger: fromLedger` and `endLedger: toLedger + 1` on the first page and only the cursor on later pages, and
returns a `cursor` until `getEvents` has scanned through `toLedger`, whether or not a page holds events. A cursor
page can scan past `toLedger`, so the reader keeps only the events through `toLedger`.

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

`Promise`\<\{ `complete`: `boolean`; `cursor?`: `string`; `events`: readonly `object`[]; `latestLedger`: `number`; `oldestLedger`: `number`; \}\>

***

### StellarRef

The read keys `reference` returns.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset-1"></a> `asset` | `string` | - |
| <a id="property-authdigest"></a> `authDigest?` | `` `0x${string}` `` | SHA-256 of the payer's authorization entry's `HashIDPreimage`. Absent, with `expiration`, for an MPP push payment the payer authorized as the transaction's source account: `transaction` then names the instrument. |
| <a id="property-expiration"></a> `expiration?` | `number` | The entry's expiration ledger. Absent with `authDigest`. |
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

> **StellarStatus** = \{ `ledger`: `number`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"transaction-failed"` \| `"not-this-instrument"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"expired"`; \}

What a read of the instrument shows. `settled`: a transaction that used this authorization entry succeeded, or, for a
ref without `authDigest`, the named transaction succeeded as the transfer the payer authorized as its source account.
`pending`: nothing final yet; `why` names what the named transaction read as (`not-found`, `transaction-failed`, a
successful transaction that is `not-this-instrument`) or that a read failed (`unreadable`). `failed` is final:
`expired`, the ledger is past the entry's expiration and a complete search finds no transaction that used it.

## Variables

### PASSPHRASE

> `const` **PASSPHRASE**: `Readonly`\<`Record`\<[`StellarNetwork`](#stellarnetwork), `string`\>\>

Each network's passphrase; its SHA-256 is the network id.

***

### SCVAL\_MAX\_DEPTH

> `const` **SCVAL\_MAX\_DEPTH**: `64` = `64`

The deepest nesting of ScVal vectors and maps (a contract instance's storage counting as a map) within one ScVal,
the outermost container being level 1, and of authorized invocations within one authorization entry, the root
invocation being level 1. It bounds what is read of an envelope, the operation and the payer's authorization entry,
and an event's topics and data. It does not apply to other authorization entries, so another entry's nesting does
not make the envelope unreadable.

## Functions

### decodeStellarTx()

> **decodeStellarTx**(`xdrB64`, `network`): [`Refusal`](index.md#refusal) \| [`StellarPayment`](#stellarpayment)

Decodes a base64 `TransactionEnvelope` (v1, or a fee bump's inner v1) of at most 8,192 base64 characters (6 KiB of
XDR) holding exactly one
`invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract, and the one authorization entry
with address credentials (`sorobanCredentialsAddress` or `sorobanCredentialsAddressV2`) whose address is `from`.
The entry's `rootInvocation` must be that same `transfer`, byte for byte, with no sub-invocations; the payment's
contract, `to` and amount are the signed invocation's. The base64 is read strictly (RFC 4648 §4, zero padding bits),
and the XDR must be consumed whole. The operation and that entry nest ScVals and authorized invocations at most
`SCVAL_MAX_DEPTH` levels (`stellar/tx-malformed` past it); the cap does not apply to another entry, so its nesting
does not refuse the envelope. `preimageHash` is SHA-256 of that entry's `HashIDPreimage` under the network's
passphrase: the V1 form, or for V2 the form with the address. An entry with source-account credentials is not one:
without an address entry of `from` the envelope is `stellar/no-address-auth`. Only `mpp/charge/stellar`'s push
credential, once its transaction landed, reads a payer that authorized the transfer as the transaction's source
account.

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

The `M…` strkey of a `G…` account and `muxedId(h)`. Throws TypeError when `base` is not a `G…` strkey or `h` is not a
32-byte hash, and when @stellar/stellar-sdk is not installed.

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

The hash's first 8 bytes, big-endian, as a u64. Throws TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`bigint`

***

### stellarLocate()

> **stellarLocate**(`ref`, `reader`): `Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

Finds the instrument when no transaction was named: the asset's transfer events to `toBase` from `fromLedger` through
the entry's expiration ledger, both inclusive, keeping those whose muxed id is `toId`, each read as `stellarStatus`
reads its named transaction. A candidate that settles is `found`, on any page. With none found, `complete` is true
only when every page was read, the reader reported events enabled on each, the RPC still held `fromLedger`
(`oldestLedger` ≤ `fromLedger`) and had reached the expiration ledger (`latestLedger` ≥ `expiration`), and every
candidate was read: a listed candidate whose transaction is not found, or cannot be read, leaves the search
incomplete. At most 10 pages and 50 candidates. A ref without `authDigest` or `expiration` names its transaction and
has no entry to search for: `complete` is false. A ref or reader that is not an object, a reader for another network,
or a ref with a field the search uses in another form than `stellarStatus` reads (an `authDigest`, `expiration`,
`asset`, `toBase`, `toId` or `fromLedger`), is `complete` false too, with nothing read.

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

Reads the instrument through a named transaction. Settled when that transaction succeeded and used the authorization
entry `ref.authDigest` names. A landed transaction is read by the payer's first address-credential entry whose
`rootInvocation` is the operation's `transfer`, byte for byte, with no sub-invocations; other entries of the payer in
it are not read. Otherwise the entry can still be used by another transaction until its expiration ledger, so a named
transaction that is not found, failed, or succeeded with another entry is pending. The read is final only past that
ledger (`latestLedger()` above `expiration`): then `stellarLocate`'s search decides, settled when it finds a
transaction that used the entry, failed `expired` when it is complete, finds none, and each events page names a
`latestLedger` at or above the one read first, and pending otherwise: an events index that lags the ledger read first
is never read as absence. A failed read, or a reader for another network, is pending. A ref that lacks a field the
read uses, or holds one in another form than `reference` writes, is pending `unreadable`, with nothing read: a
`transaction` other than 64 hex digits (looked up in lower case), an `authDigest` other than `0x` and 64 hex digits,
an `authDigest` without an `expiration` or an `expiration` without an `authDigest`, an `asset` that is not a contract
strkey, a `toBase` that is not an account or contract strkey, a `toId` that is not a u64 in decimal, or an
`expiration` or `fromLedger` that is not an integer from 0 to 2^32 − 1. One call when the named transaction settles or
a read fails, two before the expiration ledger has passed, and after it `stellarLocate`'s calls as well. A ref
without `authDigest` (an MPP push payment the payer authorized as the transaction's source account, with no
`expiration` either) is settled when the named transaction succeeded as that transfer, and is otherwise pending:
there is no expiration ledger to pass.

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
