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

The read keys: the network, the digest, the epoch bound, and the payee, the `payTo` of the option the payment answers.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-digest"></a> `digest` | `string` | - |
| <a id="property-network-1"></a> `network` | [`SuiNetwork`](#suinetwork) | - |
| <a id="property-payee"></a> `payee` | `string` | - |
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

> **SuiStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `SuiMark`\>

The answer of `suiStatus`, as the profile `read-status` gives it. Its one mark is `final`, the effects of an executed
transaction, and its position the checkpoint sequence number.

## Variables

### exactSui

> `const` **exactSui**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiUnsigned`](#suiunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/sui"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiRef`](#suiref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SuiStatus`](#suistatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

> **suiRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the hash back from the executed transaction alone, by its digest, the input's `tx`; the input's `option` is
the option the payment answers, an object, of which the read needs no member. An input whose `tx` is not base58 of
32 bytes, or whose option is not an object, is `sui/wrong-reader`, with nothing read. Bytes that do not hash to the
digest are `sui/unreadable`; bytes that do, and that `decodeSuiTx` refuses, give its refusal, as `suiStatus` reads
no act in them. Without @mysten/sui the transaction cannot be decoded: bytes that hash to the digest, of a
transaction that did not abort, are `sui/peer-missing`, after the input, the reader and the read are checked, which
need no peer. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`SuiNetwork`](#suinetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`SuiReader`](#suireader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### suiStatus()

> **suiStatus**(`ref`, `reader`, `query`): `Promise`\<[`SuiStatus`](#suistatus)\>

Answers the read of the recorded digest as the profile `read-status` gives it. The digest is the single-use value:
Sui derives it from the signed bytes alone, so a transaction with it that executed, succeeded or not, consumed it. A
present transaction must be these bytes carrying this hash, else it carries no act that binds H; its effects' status
then decides: `SUCCESS` is the payer's act, and `FAILURE` the act included with a failed result, each at the one
mark `final` and at its checkpoint, where the effects name one. An absent transaction is past its validity once the
latest epoch is past its bound and the endpoint holds transactions from the position the query gives as `after`, or
earlier: such a position is at or before every checkpoint the payment could have executed in, such as the latest
checkpoint when the payment is requested. Otherwise it names no included act, since an endpoint that holds a shorter
history may have pruned a transaction that executed; one with no bound (a null `untilEpoch`) can execute in any later
epoch. The read holds no search for H, so none of these answers `failed` but `before-position`. A read that rejects
is unreadable `transport`; an answer out of the reader's form, bytes that do not hash to the digest, or, without
@mysten/sui, bytes that hash to the digest and that `decodeSuiTx` cannot read before the peer, are `unparseable`;
and a reader for another network than the ref's is `chain-mismatch`. A ref, a reader or a query that is not one, a
reader that names no network, a ref whose `digest` is not base58 of 32 bytes, whose `h` is not `0x` and 64 hex
digits, or whose `untilEpoch` is neither null nor a decimal string below 2^64, and an `after` that is not a
non-negative bigint, are unreadable `unparseable`, with nothing read. One call. Only the decode of a present
transaction's bytes needs @mysten/sui; every other answer is the one with it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SuiRef`](#suiref) & `object` |
| `reader` | [`SuiReader`](#suireader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`SuiRef`](#suiref) & `object`, `bigint`, `"final"`\> |

#### Returns

`Promise`\<[`SuiStatus`](#suistatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
