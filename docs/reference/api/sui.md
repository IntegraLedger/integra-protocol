---
title: "@integraledger/lcp/sui"
description: "The exports of @integraledger/lcp/sui."
---

# @integraledger/lcp/sui

## Interfaces

### SuiExecuted

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkpoint"></a> `checkpoint` | `bigint` \| `null` |
| <a id="property-status"></a> `status` | `"SUCCESS"` \| `"FAILURE"` |
| <a id="property-transactionbcs"></a> `transactionBcs` | `Uint8Array` |

***

### SuiPayload

The payload x402's Sui scheme defines.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-signature"></a> `signature` | `string` |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### SuiReader

Bounded, read-only calls against one network's GraphQL endpoint. Every failure rejects, for example with
`ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable. `read` is one request, so one
snapshot: `query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}}}
checkpoint{epoch{epochId}} serviceConfig{availableRange(type:"Query",field:"transaction"){first{sequenceNumber}}}}`.
`epoch` is the latest checkpoint's epoch. `firstCheckpoint` is the first checkpoint from which the endpoint holds
transactions (the available range's inclusive lower bound), or null when the endpoint states none.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`SuiNetwork`](#suinetwork) |

#### Methods

##### read()

> **read**(`digest`): `Promise`\<\{ `epoch`: `bigint`; `firstCheckpoint`: `bigint` \| `null`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `digest` | `string` |

###### Returns

`Promise`\<\{ `epoch`: `bigint`; `firstCheckpoint`: `bigint` \| `null`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

***

### SuiRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-digest"></a> `digest` | `string` | - |
| <a id="property-network-1"></a> `network` | [`SuiNetwork`](#suinetwork) | - |
| <a id="property-untilepoch"></a> `untilEpoch` | `string` \| `null` | The last epoch the transaction can execute in, as a decimal string, or null when it sets no maximum epoch. |

***

### SuiTx

A decoded `TransactionData`: the bytes as received, their digest, the unused `Pure` inputs, and the epoch bound. `B`
is what its bytes are backed by: `decodeSuiTx` gives `SuiTx<ArrayBuffer>`, each byte field in its own fresh
`ArrayBuffer`, and `suiCarrier` takes any backing.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bytes"></a> `bytes` | `Uint8Array`\<`B`\> | - |
| <a id="property-digest-1"></a> `digest` | `string` | Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. |
| <a id="property-untilepoch-1"></a> `untilEpoch` | `bigint` \| `null` | - |
| <a id="property-unusedpure"></a> `unusedPure` | readonly `Uint8Array`\<`B`\>[] | - |

***

### SuiUnsigned

What `build` hands the payer's wallet, and how it checks what comes back.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.expiration` | `"epoch-bounded"` |
| `request.kind` | `"sui-transaction"` |
| `request.pureInput` | `Uint8Array`\<`ArrayBuffer`\> |

#### Methods

##### complete()

> **complete**(`signed`): [`Refusal`](index.md#refusal) \| `SuiPaymentPayload`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`SuiPayload`](#suipayload) |

###### Returns

[`Refusal`](index.md#refusal) \| `SuiPaymentPayload`

## Type Aliases

### SuiNetwork

> **SuiNetwork** = `"sui:mainnet"` \| `"sui:testnet"` \| `"sui:devnet"`

***

### SuiStatus

> **SuiStatus** = \{ `checkpoint`: `bigint` \| `null`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"aborted"` \| `"expired"` \| `"not-this-instrument"`; \}

## Variables

### exactSui

> `const` **exactSui**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiUnsigned`](#suiunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/sui"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiRef`](#suiref)\>; `status`: (`ref`, `reader`, `position`) => `Promise`\<[`SuiStatus`](#suistatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/sui`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator executes the
transaction the payer signed; `status` reads it by the digest the signed bytes fix.

## Functions

### decodeSuiTx()

> **decodeSuiTx**(`base64`): [`Refusal`](index.md#refusal) \| [`SuiTx`](#suitx)\<`ArrayBuffer`\>

Decodes a base64 `TransactionData` V1 with a programmable kind. A programmable transaction with a type (a call's
type argument, a vector's element type, a funds withdrawal's type) that has a node at depth 16, Sui's type depth
limit, is `sui/tx-malformed`, the code of bytes that do not decode: @mysten/sui decodes a type by recursion, and the
bound gives the same answer whether this host's stack would hold the type or not. A V1 `TransactionData` of another
kind is `sui/not-programmable`, answered from its kind's tag before its body is decoded. The base64, the size bound
and the two tags are read without @mysten/sui: without it, bytes they refuse get the code they get with it, and any
other bytes are `sui/peer-missing`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `base64` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SuiTx`](#suitx)\<`ArrayBuffer`\>

***

### suiCarrier()

> **suiCarrier**(`tx`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The hash carried by exactly one unused `Pure` input of exactly 32 bytes. A `tx` that is not a decoded transaction, an
object whose `unusedPure` is an array of `Uint8Array`s, is `sui/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SuiTx`](#suitx) |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### suiRecover()

> **suiRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the hash back from the executed transaction alone, by its digest. A ref whose `digest` is not base58 of 32
bytes is `sui/wrong-reader`, with nothing read. Bytes that do not hash to the digest are `sui/unreadable`; bytes that
do, and that `decodeSuiTx` refuses, give its refusal, as `suiStatus` answers them failed `not-this-instrument`.
Without @mysten/sui the transaction cannot be decoded: bytes that hash to the digest, of a transaction that did not
abort, are `sui/peer-missing`, after the ref, the reader and the read are checked, which need no peer. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `digest`: `string`; `network`: [`SuiNetwork`](#suinetwork); \} |
| `ref.digest` | `string` |
| `ref.network` | [`SuiNetwork`](#suinetwork) |
| `reader` | [`SuiReader`](#suireader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### suiStatus()

> **suiStatus**(`ref`, `reader`, `position`): `Promise`\<[`SuiStatus`](#suistatus)\>

Reads the recorded digest. A failed read, or a reader for another network, is pending. `position` is the checkpoint
from which the caller needs the endpoint's history: one at or before every checkpoint the payment could have
executed in, such as the latest checkpoint when the payment is requested. An absent transaction is expired once the
latest epoch is past its bound and the endpoint holds transactions from `position` or earlier; otherwise it is
pending `not-found`, since an endpoint that holds a shorter history may have pruned a transaction that executed. One
with no bound (a null `untilEpoch`) is never expired: it can execute in any later epoch. A present one must be these
bytes carrying this hash, and its effects' status decides. A ref whose `digest` is not base58 of 32 bytes, whose `h`
is not `0x` and 64 hex digits, or whose `untilEpoch` is neither null nor a decimal string below 2^64, and a
`position` that is not a non-negative bigint, are pending `unreadable`, with nothing read. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SuiRef`](#suiref) & `object` |
| `reader` | [`SuiReader`](#suireader) |
| `position` | `bigint` |

#### Returns

`Promise`\<[`SuiStatus`](#suistatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
