---
title: "@integraledger/lcp/sui"
description: "The exports of @integraledger/lcp/sui."
---

# @integraledger/lcp/sui

## Interfaces

### SuiBalanceChange

One owner's net change in one coin type, an entry of the effects' `balanceChanges`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-cointype"></a> `coinType` | `string` |
| <a id="property-owner"></a> `owner` | `string` |

***

### SuiExecuted

#### Extended by

- [`SuiFound`](#suifound)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-balancechanges"></a> `balanceChanges` | readonly [`SuiBalanceChange`](#suibalancechange)[] | The effects' balance changes, each owner's net change in each coin type (`balanceChangesJson`). |
| <a id="property-checkpoint"></a> `checkpoint` | `bigint` \| `null` | The checkpoint that holds the effects, or null for a transaction executed and not yet in one. |
| <a id="property-status"></a> `status` | `"SUCCESS"` \| `"FAILURE"` | - |
| <a id="property-transactionbcs"></a> `transactionBcs` | `Uint8Array` | - |

***

### SuiFound

A transaction a page of the search returns: its digest as the endpoint names it, with the read's members.

#### Extends

- [`SuiExecuted`](#suiexecuted)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-balancechanges-1"></a> `balanceChanges` | readonly [`SuiBalanceChange`](#suibalancechange)[] | The effects' balance changes, each owner's net change in each coin type (`balanceChangesJson`). | [`SuiExecuted`](#suiexecuted).[`balanceChanges`](#property-balancechanges) |
| <a id="property-checkpoint-1"></a> `checkpoint` | `bigint` \| `null` | The checkpoint that holds the effects, or null for a transaction executed and not yet in one. | [`SuiExecuted`](#suiexecuted).[`checkpoint`](#property-checkpoint) |
| <a id="property-digest"></a> `digest` | `string` | - | - |
| <a id="property-status-1"></a> `status` | `"SUCCESS"` \| `"FAILURE"` | - | [`SuiExecuted`](#suiexecuted).[`status`](#property-status) |
| <a id="property-transactionbcs-1"></a> `transactionBcs` | `Uint8Array` | - | [`SuiExecuted`](#suiexecuted).[`transactionBcs`](#property-transactionbcs) |

***

### SuiPage

One page of the sender's transactions, in checkpoint order, with the endpoint's `pageInfo`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-endcursor"></a> `endCursor` | `string` \| `null` |
| <a id="property-hasnextpage"></a> `hasNextPage` | `boolean` |
| <a id="property-transactions"></a> `transactions` | readonly [`SuiFound`](#suifound)[] |

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
snapshot: `query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}
balanceChangesJson}} checkpoint{epoch{epochId}} serviceConfig{availableRange(type:"Query",field:"transaction"){first{sequenceNumber}}
sender:availableRange(type:"Query",field:"transactions",filters:["sentAddress"]){first{sequenceNumber}
last{sequenceNumber epoch{epochId}}}}}`. `epoch` is the latest checkpoint's epoch. `firstCheckpoint` is the first
checkpoint from which the endpoint holds transactions (the available range's inclusive lower bound), or null when the
endpoint states none. `searchRange` is the range it states for the sender filter, its first and last checkpoints and
the last one's epoch (`SuiSearchRange`). Every executed transaction carries its effects' balance changes
(`balanceChangesJson`), each owner's net change in each coin type, whole: an answer without them is `unparseable`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`SuiNetwork`](#suinetwork) |

#### Methods

##### read()

> **read**(`digest`): `Promise`\<\{ `epoch`: `bigint`; `firstCheckpoint`: `bigint` \| `null`; `searchRange?`: [`SuiSearchRange`](#suisearchrange) \| `null`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `digest` | `string` |

###### Returns

`Promise`\<\{ `epoch`: `bigint`; `firstCheckpoint`: `bigint` \| `null`; `searchRange?`: [`SuiSearchRange`](#suisearchrange) \| `null`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

##### search()

> **search**(`sender`, `afterCheckpoint`, `beforeCheckpoint`, `cursor`): `Promise`\<[`SuiPage`](#suipage)\>

One page of the sender's transactions: `transactions(first, after: cursor, filter: {sentAddress: sender,
afterCheckpoint, beforeCheckpoint}) { pageInfo { hasNextPage endCursor } nodes { digest transactionBcs effects {
status checkpoint { sequenceNumber } balanceChangesJson } } }`, `cursor` null for the first page.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `sender` | `string` |
| `afterCheckpoint` | `bigint` |
| `beforeCheckpoint` | `bigint` |
| `cursor` | `string` \| `null` |

###### Returns

`Promise`\<[`SuiPage`](#suipage)\>

***

### SuiRef

The read keys: the network, the digest, the epoch bound, the payee, the `payTo` of the option the payment answers,
and the sender, by which the search for H finds the payer's acts. The digest is over the whole transaction data the
payer signed, its signatures apart, so it also names the payment presented.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-digest-1"></a> `digest` | `string` | - |
| <a id="property-network-1"></a> `network` | [`SuiNetwork`](#suinetwork) | - |
| <a id="property-payee"></a> `payee` | `string` | - |
| <a id="property-sender"></a> `sender` | `string` | - |
| <a id="property-untilepoch"></a> `untilEpoch` | `string` \| `null` | The last epoch the transaction can execute in, as a decimal string, or null when it sets no maximum epoch. |

***

### SuiSearchRange

The range of checkpoints the endpoint states it holds for the sender filter of `transactions`
(`serviceConfig.availableRange(type: "Query", field: "transactions", filters: ["sentAddress"])`): its first and
last checkpoints, and the epoch of the last.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-epoch"></a> `epoch` | `bigint` |
| <a id="property-first"></a> `first` | `bigint` |
| <a id="property-last"></a> `last` | `bigint` |

***

### SuiTransfer

A transfer a signed command names: `TransferObjects` to an address given as a `Pure` input, or a call of
`0x2::coin::send_funds<T>(coin, recipient)` with the recipient given so. `command` is the command's index among the
transaction's commands; `coinType` is the type the command shows, `T` of `send_funds`, or `0x2::sui::SUI` where every
object transferred is split from the gas coin, and absent where the bytes do not show it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-cointype-1"></a> `coinType?` | `string` |
| <a id="property-command"></a> `command` | `number` |
| <a id="property-recipient"></a> `recipient` | `string` |

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
| <a id="property-digest-2"></a> `digest` | `string` | Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. |
| <a id="property-sender-1"></a> `sender` | `string` | The sender, who signed the bytes: `0x` and 64 lowercase hex digits. |
| <a id="property-transfers"></a> `transfers` | readonly [`SuiTransfer`](#suitransfer)[] | The transfers the signed commands name, each with the recipient it names (`SuiTransfer`). |
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

> **complete**(`signed`, `sent?`): [`Refusal`](index.md#refusal) \| `SuiPaymentPayload`

The payment, once the signed transaction carries H. `sent` is the transaction the client sent to the option's gas
station (`extra.gasStation`), base64 of its `TransactionData`: on the sponsored path it is required, and the signed
transaction must equal it in everything but the gas data (its owner, payment, price and budget), else
`sui/not-as-sent`, since a gas station that changed the sender, an input, a command or the expiration could raise
the amount or remove the lapse under a valid H.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`SuiPayload`](#suipayload) |
| `sent?` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| `SuiPaymentPayload`

## Type Aliases

### SuiNetwork

> **SuiNetwork** = `"sui:mainnet"` \| `"sui:testnet"` \| `"sui:devnet"`

***

### SuiStatus

> **SuiStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `SuiMark`, `bigint`\>

The answer of `suiStatus`, as the profile `read-status` gives it, and on `settled` whether its act is the payment
presented. Positions are checkpoint sequence numbers, and so is the search's position. The one mark a query can ask
for is `final`, certified effects in a checkpoint; `executed`, a transaction the endpoint returns with no checkpoint,
is the state below it that the endpoint tells apart and no query names.

## Variables

### exactSui

> `const` **exactSui**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiUnsigned`](#suiunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/sui"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiRef`](#suiref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SuiStatus`](#suistatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/sui`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator executes the
transaction the payer signed; `status` reads it by the digest the signed bytes fix.

***

### MAX\_SUI\_BALANCE\_CHANGES

> `const` **MAX\_SUI\_BALANCE\_CHANGES**: `4096` = `4096`

The most balance changes the read takes of one executed transaction: lcp's own bound on the work one reader's answer
asks of it. Sui sets no count a GraphQL answer is held to; a transaction with more is out of the reader's form.

***

### MAX\_SUI\_COIN\_TYPE\_LENGTH

> `const` **MAX\_SUI\_COIN\_TYPE\_LENGTH**: `4096` = `4096`

The longest coin type, in characters, the read takes from a balance change: lcp's own bound on a reader's answer. Sui
bounds a type by its nesting (16) and its identifiers, not by its text; a coin type with type parameters, such as a
pool's share `…::reserve::CToken<P, T>`, is a coin type all the same.

***

### MAX\_SUI\_SEARCH\_PAGES

> `const` **MAX\_SUI\_SEARCH\_PAGES**: `8` = `8`

The pages one call of `status` reads of the search before it answers with the search's position: lcp's own bound on
the reads one call makes. The next call resumes from that position.

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

Answers the read of the recorded digest as the profile `read-status` gives it, with the search for H the profile
`x402/exact/sui` states. The digest is the single-use value: Sui derives it from the signed bytes alone, so the
transaction with it, succeeded or not, consumed it. That transaction must be these bytes carrying this hash, else
the answer is unreadable `unparseable`. It is classified from what landed: its signer, the sender, against the
option's payee and the reference's sender; the account it names, a positive balance change the payee's address owns
or a recipient a signed transfer names, against the payee; and whether it is another act the caller gave by its
reference. One with no checkpoint is in the state `executed`, after every checkpoint, so after the position given,
and below the final mark. An absent transaction can still land while the endpoint holds transactions from the
position given and the epoch at the search's head is not past its bound, or it has none; past it, it lapsed. Where
the read would answer `failed` for any reason but `before-position`, it reads the search for H: the sender's
transactions after the position given, or after the search's position an earlier answer returned, to the last
checkpoint the endpoint states it holds for the sender filter, at most `MAX_SUI_SEARCH_PAGES` pages a call, each transaction
read as `bound` reads one, those that carry H classified as the digest's is. A transaction it passes that does not
hash to its digest or does not decode is named among the items the search could not decode, held at the checkpoint
before it. A rejected read is
unreadable `transport`; an answer out of the reader's form `unparseable`; transaction bytes over the bound
`too-large`; a reader for another network `chain-mismatch`; a ref, a reader or a query that is not one is
`unparseable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SuiRef`](#suiref) & `object` |
| `reader` | [`SuiReader`](#suireader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`SuiRef`](#suiref) & `object`, `bigint`, `SuiMark`, `bigint`\> |

#### Returns

`Promise`\<[`SuiStatus`](#suistatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
