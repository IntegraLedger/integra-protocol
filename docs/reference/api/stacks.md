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
decimal string, the transaction id (absent for a sponsored transaction, whose id is fixed only by the sponsor's
signature), and the payee, the recipient of the challenge the payment answers.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-contract"></a> `contract` | `string` |
| <a id="property-network-1"></a> `network` | `` `stacks:${string}` `` |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-origin"></a> `origin` | `string` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` |

## Type Aliases

### StacksNetwork

> **StacksNetwork** = `` `stacks:${string}` ``

CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet).

***

### StacksStatus

> **StacksStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `StacksMark`\>

The answer of `stacksStatus`, as the profile `read-status` gives it. Its marks are `block` and `bitcoin`, in that
order, and its position the block height.

## Functions

### stacksRecover()

> **stacksRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party: H from the fourth argument of a mined, successful call to the contract's `transfer`, in one reader call,
or at most three for a failed one. A ref or reader that is not an object, a reader for another network, or a ref
whose `transaction` is not a 32-byte hash is `stacks/wrong-reader`, with nothing read; a failed read, an answer of no
documented shape, or a mined transaction whose status is none of `success`, `abort_by_response`,
`abort_by_post_condition` and `problematic_skipped`, `stacks/unreadable`; an unknown or unmined transaction
`stacks/not-found`. A failed status is `stacks/not-success` once the tip's tenure height is at least the block's plus
two, as `stacksStatus` reads `bitcoin` finality; below that, or where a tenure read fails, it is `stacks/not-final`,
since that block can be replaced. No `(some <32 bytes>)` memo of a call to the contract's `transfer` is
`stacks/no-memo`. The input's `tx` is the transaction id, and its `option` the challenge the payment answers, whose
decoded request names the contract in `methodDetails.stacks`: its `contractAddress`, `.` and its `contractName`. An
input whose `tx` is not a 32-byte hash, or whose option is not a challenge whose request names a contract so, is
`stacks/wrong-reader`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `stacks:${string}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`StacksReader`](#stacksreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### stacksStatus()

> **stacksStatus**(`ref`, `reader`, `query`): `Promise`\<[`StacksStatus`](#stacksstatus)\>

Answers the read of the payment as the profile `read-status` gives it, in at most four reader calls. The origin's
confirmed nonce is read first, then the transaction. A mined transaction that is the origin's at its nonce, calling
`transfer` on the ref's `contract`, the contract the presented transaction called, with `(some H)` as its fourth
argument, is the payer's act; the API's `status` then decides whether it succeeded. A mined act, succeeded or not,
is read at its mark, `bitcoin` once the tip's tenure height is at least the block's plus two, else `block`, a failed
or malformed tenure read counting as `block`, and at its block height. An act aborted by its response or a post
condition is included with a failed result that took the nonce; a skipped one took none. A mined transaction of the
origin at its nonce that is not that transfer means the nonce is taken by another act, and one of another origin or
nonce carries no act of the payer's. An unmined, dropped or unknown transaction names no included act, except where
the nonce read before the lookup was already at or above the transaction's and the lookup names a height at or above
the one the nonce read names: the nonce is then taken by another act. The read holds no search for H, so none of
these answers `failed`. A transaction read that rejects, or a nonce read that rejects where the answer needs it, is
unreadable `transport`; an answer of no documented shape, or a mined status the API does not document, is
`unparseable`; a reader for another network than the ref's is `chain-mismatch`. A ref, a reader or a query that is
not one, a reader that names no network, or a ref whose nonce is not a decimal below 2^64, whose origin is not a c32
address in upper case, whose contract is not such an address, `.` and a contract name, or whose transaction or `h`
is not a 32-byte hash, is unreadable `unparseable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StacksRef`](#stacksref) & `object` |
| `reader` | [`StacksReader`](#stacksreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`StacksRef`](#stacksref) & `object`, `bigint`, `StacksMark`\> |

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
