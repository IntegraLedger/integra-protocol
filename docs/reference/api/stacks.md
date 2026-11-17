---
title: "@integraledger/lcp/stacks"
description: "The exports of @integraledger/lcp/stacks."
---

# @integraledger/lcp/stacks

## Interfaces

### StacksAssetEvent

A `fungible_token_asset` event of `asset_event_type` `transfer`, as the API lists it among a transaction's events.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` | - |
| <a id="property-assetid"></a> `assetId` | `string` | `asset.asset_id`: the token's contract, `::` and the token's name. |
| <a id="property-index"></a> `index` | `number` | `event_index`: its place among the transaction's events, as the endpoint lists them. |
| <a id="property-recipient"></a> `recipient` | `string` | - |
| <a id="property-sender"></a> `sender` | `string` | - |

***

### StacksLanded

A mined transaction as the Stacks Blockchain API reports it (`GET /extended/v1/tx/<id>`, stacks-blockchain-api 9.9.0
`src/api/schemas/v1/entities/transactions.ts`). `raw` is the transaction's bytes (`GET /extended/v1/tx/<id>/raw`),
or null where the reader does not read them.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` | - |
| <a id="property-call"></a> `call` | \{ `args`: readonly `` `0x${string}` ``[]; `contractId`: `string`; `functionName`: `string`; \} \| `null` | The contract call, with each argument's consensus serialization as `0x` hex; null for any other payload. |
| <a id="property-canonical"></a> `canonical` | `boolean` | `canonical`: the block is on the canonical chain. |
| <a id="property-events"></a> `events` | readonly [`StacksAssetEvent`](#stacksassetevent)[] | Its `fungible_token_asset` `transfer` events. |
| <a id="property-mined"></a> `mined` | `true` | - |
| <a id="property-raw"></a> `raw` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-sender-1"></a> `sender` | `object` | `sender_address` and `nonce`: the origin, never the sponsor. |
| `sender.address` | `string` | - |
| `sender.nonce` | `bigint` | - |
| <a id="property-sponsor"></a> `sponsor` | `string` \| `null` | `sponsor_address`, or null for a standard authorization. |
| <a id="property-status"></a> `status` | `"success"` \| `"abort_by_response"` \| `"abort_by_post_condition"` \| `"problematic_skipped"` | - |
| <a id="property-transfer"></a> `transfer` | \{ `amount`: `bigint`; `memo`: `` `0x${string}` ``; `recipient`: `string`; \} \| `null` | A token transfer's `recipient_address`, `amount` and 34-byte `memo` as `0x` hex; null for any other payload. |
| <a id="property-txid"></a> `txid` | `` `0x${string}` `` | `tx_id`. |
| <a id="property-unanchored"></a> `unanchored` | `boolean` | `is_unanchored`: in a microblock no anchor block has confirmed, so no block places it. |

***

### StacksListed

A transaction as a list of the API's names it: its id, its origin and its nonce.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-nonce"></a> `nonce` | `bigint` |
| <a id="property-sender-2"></a> `sender` | `string` |
| <a id="property-txid-1"></a> `txid` | `` `0x${string}` `` |

***

### StacksMempool

An unmined transaction: `pending`, or one of the `dropped_…` states. It decides nothing.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-mined-1"></a> `mined` | `false` |
| <a id="property-status-1"></a> `status` | `string` |

***

### StacksPage

A page of a list, with the count the list holds in all (`total`).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-results"></a> `results` | readonly [`StacksListed`](#stackslisted)[] |
| <a id="property-total"></a> `total` | `number` |

***

### StacksReader

Bounded reads of one network's Stacks Blockchain API, stacks-blockchain-api 9.9.0's routes. Any failure rejects, for
example with `ReaderError` from `@integraledger/lcp/evm`: one of kind `too-large` reads as `too-large`, one of kind
`malformed` as `unparseable`, and any other rejection as `transport`. A route that answers 404 for a height it does
not know answers `{ unknownHeight: true }`, which is never absence.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `stacks:${string}` `` |

#### Methods

##### byNonce()

> **byNonce**(`principal`, `nonce`): `Promise`\<readonly [`StacksListed`](#stackslisted)[]\>

`GET /extended/v1/tx/?from_address=<principal>&nonce=<nonce>`: the results, each by its id, origin and nonce.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `principal` | `string` |
| `nonce` | `bigint` |

###### Returns

`Promise`\<readonly [`StacksListed`](#stackslisted)[]\>

##### byOrigin()

> **byOrigin**(`principal`, `offset`): `Promise`\<[`StacksPage`](#stackspage)\>

`GET /extended/v1/tx/?from_address=<principal>&order=asc&limit=50&offset=<offset>`: a page of the origin's transactions.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `principal` | `string` |
| `offset` | `number` |

###### Returns

`Promise`\<[`StacksPage`](#stackspage)\>

##### inBlock()

> **inBlock**(`height`, `offset`): `Promise`\<[`StacksPage`](#stackspage) \| \{ `unknownHeight`: `true`; \}\>

`GET /extended/v1/tx/block_height/<height>?limit=50&offset=<offset>`: a page of a block's transactions.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |
| `offset` | `number` |

###### Returns

`Promise`\<[`StacksPage`](#stackspage) \| \{ `unknownHeight`: `true`; \}\>

##### lastNonce()

> **lastNonce**(`principal`, `height?`): `Promise`\<\{ `nonce`: `bigint` \| `null`; \} \| \{ `unknownHeight`: `true`; \}\>

`GET /extended/v1/address/<principal>/nonces`, at `height` where given (`?block_height=<height>`), else at the tip:
`last_executed_tx_nonce`, null where the principal has none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `principal` | `string` |
| `height?` | `bigint` |

###### Returns

`Promise`\<\{ `nonce`: `bigint` \| `null`; \} \| \{ `unknownHeight`: `true`; \}\>

##### nextTenureBurn()

> **nextTenureBurn**(`height`): `Promise`\<`bigint` \| `null`\>

The Bitcoin height of the burn block of the first tenure that starts after the tenure of the Stacks block at
`height` and builds on it, read from the tenures the indexer lists with their burn blocks; null where it lists none
yet.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### tip()

> **tip**(): `Promise`\<\{ `burnHeight`: `bigint`; `height`: `bigint`; \}\>

`GET /extended`: the chain tip's Stacks block height and the Bitcoin block height the indexer serves.

###### Returns

`Promise`\<\{ `burnHeight`: `bigint`; `height`: `bigint`; \}\>

##### transaction()

> **transaction**(`txid`): `Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| \{ `notFound`: `true`; \}\>

`GET /extended/v1/tx/<id>` with its events, and its bytes; `notFound` where the API does not know it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`StacksLanded`](#stackslanded) \| [`StacksMempool`](#stacksmempool) \| \{ `notFound`: `true`; \}\>

***

### StacksRef

The read keys of a Stacks payment: its network, the origin and the nonce it signed as a decimal string, the payee,
the recipient of the challenge the payment answers, for the read's two party tests, each a principal as a Stacks node
writes it (the API's spelling, which the read compares as written), `signed`, the digest of what the
origin signed (`0x` and 64 hex digits), the member `presented` compares, and `transaction`, the id of a standard
authorization's transaction, which is a hint the read takes first. A sponsored transaction's id is fixed only by the
sponsor's signature, so its reference names none.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-network-1"></a> `network` | `` `stacks:${string}` `` |
| <a id="property-nonce-1"></a> `nonce` | `string` |
| <a id="property-origin"></a> `origin` | `string` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-signed"></a> `signed` | `` `0x${string}` `` |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` |

## Type Aliases

### StacksMark

> **StacksMark** = `"block"` \| `"bitcoin"`

A Stacks mark: the block (`block`), and Bitcoin finality (`bitcoin`), the final one.

***

### StacksNetwork

> **StacksNetwork** = `` `stacks:${string}` ``

CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet).

***

### StacksQuery

> **StacksQuery** = [`StatusQuery`](index.md#statusquery)\<[`StacksRef`](#stacksref), `bigint`, [`StacksMark`](#stacksmark), `bigint`\>

What `stacksStatus` takes beside the reference and the reader.

***

### StacksStatus

> **StacksStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, [`StacksMark`](#stacksmark), `bigint`\>

The answer of `stacksStatus`, as the profile `read-status` gives it. Its marks are `block` and `bitcoin`, in that
order, its position the block height, its search position the next of the origin's nonces to read, and a transfer's
place the index of its event among the transaction's events, or `payload` for an STX token transfer.

## Variables

### MAX\_SEARCH\_NONCES

> `const` **MAX\_SEARCH\_NONCES**: `32` = `32`

The most of an origin's nonces one read searches for H: 32. The search covers every nonce the origin used after the
position it starts from, which a busy origin makes long, so one read reads at most these and answers
`search-incomplete` with the next nonce to read, from which the next read resumes.

***

### MAX\_STACKS\_TX\_BYTES

> `const` **MAX\_STACKS\_TX\_BYTES**: `16384` = `16_384`

The largest Stacks transaction lcp decodes, in bytes: 16,384. A credential carries the transaction whole, and no
Stacks specification lcp reads bounds a transaction's size below a block's, so lcp bounds the work of decoding one.

## Functions

### stacksRecover()

> **stacksRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party: H from a mined, successful transaction: the fourth argument of its call to the contract's `transfer`, or
an STX token transfer's memo, H followed by two zero bytes; in one reader call, or three for a failed one. A failed
status is `stacks/not-success` once 6 Bitcoin blocks stand on the block that anchors the transaction's block, as
`stacksStatus` reads `bitcoin`, and `stacks/not-final` below that or where a mark read fails, since that block can be
replaced. An input or reader that is not one, a reader for another network, or an input whose `tx` is not a 32-byte
hash or whose option is not a challenge whose decoded request names a contract in `methodDetails.stacks` (its
`contractAddress`, `.` and its `contractName`) is `stacks/wrong-reader`, with nothing read; a failed read or an answer
of no documented shape, `stacks/unreadable`; an unknown or unmined transaction, or one not on the canonical chain,
`stacks/not-found`; no H in either form, `stacks/no-memo`.

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

Answers the read of the act the query asks about as the profile `read-status` gives it, by the origin and the nonce
it signed (the profile `mpp/charge/usdc/stacks`). The read takes the tip, then the reference's transaction where it
names one, a hint that decides only where it is the origin's at the signed nonce; then the origin's last executed
nonce at the tip, the signed nonce being consumed where that is at or past it; then, where the hint has not, the
origin's transaction at the signed nonce (`transactionAt`). That transaction, where it is the act at or above the
finality asked for, settles; otherwise the read searches for H every nonce the origin executed after the position it
starts from: the query's `search` where given, else the nonce after the one the origin had executed at the height of
the query's `after`, else 0; through the last it executed at the tip, at most `MAX_SEARCH_NONCES` in one read. A
search from `after` rests on the nonce route's answer at a height, which no run has yet shown, so it proves no absence
and is never read whole. A transaction counts only on the canonical chain and included; its mark is `bitcoin` once 6
Bitcoin blocks stand on the block that anchors it (`nextTenureBurn` against the tip's Bitcoin height), else `block`.
A Stacks transaction has no expiry, so the signed nonce never lapses; read at the tip, a nonce unconsumed there is
unconsumed at the final mark. A transaction the search's lookup names whose answer the read cannot decode, and two
that decide at one nonce, an answer no chain gives, are named as items it could not decode, held at their nonce, and
the search reads on; at the signed nonce, which the read names by its number, or as the reference's own, either is
`unparseable`. A reference whose payee or origin is not a principal as a Stacks node writes it is `unparseable`. A rejected read is `transport`, `too-large` or
`unparseable` by its kind, an answer of no documented shape `unparseable`, a height a route does not know
`history-gap`, and a reader for another network than the reference's `chain-mismatch`. A reference or query not of
its form is `unparseable`, with nothing read. A `settled` answer states `presented`: `yes` where the digest of what
the landed transaction's origin signed is the reference's `signed`, `no` where it differs, and `unshown` where the
reader gives no bytes that are the transaction's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StacksRef`](#stacksref) & `object` |
| `reader` | [`StacksReader`](#stacksreader) |
| `query` | [`StacksQuery`](#stacksquery) |

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
