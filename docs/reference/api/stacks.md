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

An unmined transaction: `pending`, or one of the `dropped_…` states.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-mined-1"></a> `mined` | `false` |
| <a id="property-status-1"></a> `status` | `string` |

***

### StacksReader

Bounded reads of one network's Stacks Blockchain API. Any failure rejects with ReaderError.

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

> **confirmedNonce**(`principal`): `Promise`\<`bigint` \| `null`\>

The principal's last confirmed nonce, or null when it has none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `principal` | `string` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### tipTenure()

> **tipTenure**(): `Promise`\<`bigint`\>

The tip's tenure height.

###### Returns

`Promise`\<`bigint`\>

##### transaction()

> **transaction**(`txid`): `Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| `null`\>

The transaction by its `0x`-prefixed id, with its function arguments; null when the API does not know it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| `null`\>

***

### StacksRef

The read keys of a Stacks payment: its network, the token contract, the origin and its nonce as a decimal string,
and the transaction id (absent for a sponsored transaction, whose id is fixed only by the sponsor's signature).

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

## Variables

### MEMO\_PREFIX

> `const` **MEMO\_PREFIX**: `"0x0a0200000020"` = `"0x0a0200000020"`

The Clarity serialization of `(some <32-byte buffer>)` before its bytes: `0x0a`, `0x02`, then the length 32.

## Functions

### memoArgument()

> **memoArgument**(`h`): `` `0x${string}` `` \| `undefined`

The memo argument's serialization for `h`: `(some h)` as a 32-byte buffer, lowercase.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`` `0x${string}` `` \| `undefined`

***

### memoHash()

> **memoHash**(`arg`): `` `0x${string}` `` \| `null`

H from a memo argument that is `(some <32-byte buffer>)`, or null.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `arg` | `unknown` |

#### Returns

`` `0x${string}` `` \| `null`

***

### stacksRecover()

> **stacksRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party: H from the fourth argument of a mined, successful call to the contract's `transfer`, in one reader call.
A wrong reader is `stacks/wrong-reader`, a failed read or an answer of neither documented shape `stacks/unreadable`,
an unknown or unmined transaction `stacks/not-found`, any other status `stacks/not-success`, and no
`(some <32 bytes>)` memo of that call `stacks/no-memo`.

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
transaction. A wrong reader, a failed transaction read, or an answer of neither documented shape is pending
`unreadable`. A mined transaction must be the origin's at its nonce, calling the contract's `transfer` with `(some H)`
as its fourth argument, else failed `not-this-instrument`; then the API's `status` decides. A mined transaction's
answer, settled or failed, carries its finality: `bitcoin` once the tip's tenure height is at least the block's plus
two, else `block`, and a failed or malformed tenure read counts as `block`. Unmined and dropped, or unknown, it is
failed `nonce-used` only when the nonce read before the lookup was already at or above the transaction's: that nonce
was read at the API's tip, so `block`. A failed or malformed nonce read then is pending `unreadable`.

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

SHA-512/256 of a transaction's whole consensus serialization, as `0x` and lowercase hex.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

`` `0x${string}` ``
