---
title: "@integraledger/lcp/stacks"
description: "The exports of @integraledger/lcp/stacks."
---

# @integraledger/lcp/stacks

## Interfaces

### StacksLanded

A mined transaction as the Stacks Blockchain API reports it from the canonical chain. `result` is never read.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` | - |
| <a id="property-call"></a> `call` | \{ `args`: readonly `` `0x${string}` ``[]; `contractId`: `string`; `functionName`: `string`; \} \| `null` | The contract call, with each argument's consensus serialization as `0x` hex; null for any other payload. |
| <a id="property-mined"></a> `mined` | `true` | - |
| <a id="property-sender"></a> `sender` | `object` | - |
| `sender.address` | `string` | - |
| `sender.nonce` | `bigint` | - |
| <a id="property-status"></a> `status` | `"success"` \| `"abort_by_response"` \| `"abort_by_post_condition"` \| `"problematic_skipped"` | - |

***

### StacksMempool

An unmined transaction: `pending`, or one of the `dropped_…` states, with the `height` its API had reached when it
answered (see `StacksReader`).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-height"></a> `height` | `bigint` \| `null` |
| <a id="property-mined-1"></a> `mined` | `false` |
| <a id="property-status-1"></a> `status` | `string` |

***

### StacksReader

Bounded reads of one network's Stacks Blockchain API. Any failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; a rejected tenure read counts as `block`, and any other rejection reads as unreadable.
`height` is the block height of that API's indexed chain tip (`GET /extended` → `chain_tip.block_height`), read from
the node that gave the answer it goes with: after the `confirmedNonce` call, so the nonce read is at or below it, and
before a lookup that answers `notFound` or an unmined transaction, so the lookup is at or above it. It is null when
the reader cannot read it from that node, and an answer naming no height never reads an unknown or dropped
transaction as failed.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `stacks:${string}` `` |

#### Methods

##### blockTenure()

> **blockTenure**(`height`): `Promise`\<`bigint`\>

The tenure height of the block at `height`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |

###### Returns

`Promise`\<`bigint`\>

##### confirmedNonce()

> **confirmedNonce**(`principal`): `Promise`\<\{ `height`: `bigint` \| `null`; `nonce`: `bigint` \| `null`; \}\>

The principal's last confirmed nonce, or null when it has none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `principal` | `string` |

###### Returns

`Promise`\<\{ `height`: `bigint` \| `null`; `nonce`: `bigint` \| `null`; \}\>

##### tipTenure()

> **tipTenure**(): `Promise`\<`bigint`\>

The tip's tenure height.

###### Returns

`Promise`\<`bigint`\>

##### transaction()

> **transaction**(`txid`): `Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| \{ `height`: `bigint` \| `null`; `notFound`: `true`; \}\>

The transaction by its `0x`-prefixed id, with its function arguments; `notFound` when the API does not know it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| \{ `height`: `bigint` \| `null`; `notFound`: `true`; \}\>

***

### StacksRef

The read keys of a Stacks payment: its network, the contract the transaction calls, the origin and its nonce as a
decimal string, and the transaction id (absent for a sponsored transaction, whose id is fixed only by the sponsor's
signature).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-contract"></a> `contract` | `string` |
| <a id="property-network-1"></a> `network` | `` `stacks:${string}` `` |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-origin"></a> `origin` | `string` |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` |

## Type Aliases

### StacksNetwork

> **StacksNetwork** = `` `stacks:${string}` ``

CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet).

***

### StacksStatus

> **StacksStatus** = \{ `blockHeight`: `bigint`; `finality`: `"block"` \| `"bitcoin"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"mempool"` \| `"dropped"` \| `"unreadable"`; \} \| \{ `blockHeight`: `bigint`; `finality`: `"block"` \| `"bitcoin"`; `state`: `"failed"`; `why`: `"abort-by-response"` \| `"abort-by-post-condition"` \| `"skipped"` \| `"not-this-instrument"`; \} \| \{ `finality`: `"block"`; `state`: `"failed"`; `why`: `"nonce-used"`; \}

## Functions

### stacksRecover()

> **stacksRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party: H from the fourth argument of a mined, successful call to the contract's `transfer`, in one reader call,
or at most three for a failed one. A ref or reader that is not an object, a reader for another network, or a ref
whose `transaction` is not a 32-byte hash is `stacks/wrong-reader`, with nothing read; a failed read, an answer of no
documented shape, or a mined transaction whose status is none of `success`, `abort_by_response`,
`abort_by_post_condition` and `problematic_skipped`, `stacks/unreadable`; an unknown or unmined transaction
`stacks/not-found`. A failed status is `stacks/not-success` once the tip's tenure height is at least the block's plus
two, as `stacksStatus` reads `bitcoin` finality; below that, or where a tenure read fails, it is `stacks/not-final`,
since that block can be replaced. No `(some <32 bytes>)` memo of the call is `stacks/no-memo`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `contract`: `string`; `network`: `` `stacks:${string}` ``; `transaction`: `` `0x${string}` ``; \} |
| `ref.contract` | `string` |
| `ref.network` | `` `stacks:${string}` `` |
| `ref.transaction` | `` `0x${string}` `` |
| `reader` | [`StacksReader`](#stacksreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### stacksStatus()

> **stacksStatus**(`ref`, `reader`): `Promise`\<[`StacksStatus`](#stacksstatus)\>

The payment's settlement, in at most four reader calls. The origin's confirmed nonce is read first, then the
transaction. A wrong reader, a failed transaction read, or an answer of no documented shape is pending
`unreadable`. A mined transaction must be the origin's at its nonce, calling `transfer` on the ref's `contract`, the
contract the presented transaction called, with `(some H)` as its fourth argument, else failed `not-this-instrument`;
then the API's `status` decides. A mined transaction's
answer, settled or failed, carries its finality: `bitcoin` once the tip's tenure height is at least the block's plus
two, else `block`, and a failed or malformed tenure read counts as `block`. Unmined and dropped, or unknown, it is
failed `nonce-used` only when the nonce read before the lookup was already at or above the transaction's: that nonce
was read at the API's tip, so `block`. It counts so only when the lookup names a height at or above the one the nonce
read names; a lookup that lags the nonce read, or a lookup or nonce read naming no height, is pending `dropped` or
`not-found`. A failed or malformed nonce read then is pending `unreadable`. A ref whose origin is not a c32 address
in upper case, or whose contract is not such an address, `.` and a contract name, is pending `unreadable`, with
nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StacksRef`](#stacksref) & `object` |
| `reader` | [`StacksReader`](#stacksreader) |

#### Returns

`Promise`\<[`StacksStatus`](#stacksstatus)\>

***

### stacksTxid()

> **stacksTxid**(`wire`): `` `0x${string}` ``

SHA-512/256 of a transaction's whole consensus serialization, as `0x` and lowercase hex. Throws TypeError when `wire`
is not a `Uint8Array`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

`` `0x${string}` ``
