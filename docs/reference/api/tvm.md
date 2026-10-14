---
title: "@integraledger/lcp/tvm"
description: "The exports of @integraledger/lcp/tvm."
---

# @integraledger/lcp/tvm

## Interfaces

### TonCell

A TON cell, as `@ton/core`'s `Cell` gives one: its data bits, its references and its representation hash. The entry
point's public types name this shape rather than the optional peer's class, and a `Cell` is one.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-bits"></a> `bits` | `readonly` | `object` |
| `bits.length` | `readonly` | `number` |
| <a id="property-refs"></a> `refs` | `readonly` | readonly [`TonCell`](#toncell)[] |

#### Methods

##### hash()

> **hash**(`level?`): `Uint8Array`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `level?` | `number` |

###### Returns

`Uint8Array`

***

### TonTx

A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC, or null when the
transaction has no inbound message body (its `in_msg`, or that message's `message_content.body`, is null).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-aborted"></a> `aborted` | `boolean` | - |
| <a id="property-account"></a> `account` | `string` | - |
| <a id="property-finality"></a> `finality` | `0` \| `1` \| `2` | TON Center v3's `FinalityState`: 0 pending, 1 confirmed, 2 finalized. |
| <a id="property-hash"></a> `hash` | `string` | - |
| <a id="property-inbody"></a> `inBody` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-outmsgs"></a> `outMsgs` | readonly `object`[] | - |

***

### TvmReader

Bounded, read-only calls against one network's TON Center v3 endpoint. Every failure rejects, for example with
`ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `tvm:${number}` `` |

#### Methods

##### byHash()

> **byHash**(`txHash`): `Promise`\<[`TonTx`](#tontx) \| `null`\>

GET /api/v3/transactions?hash=…

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txHash` | `string` |

###### Returns

`Promise`\<[`TonTx`](#tontx) \| `null`\>

##### byInBody()

> **byInBody**(`bodyHash`): `Promise`\<\{ `headUtime`: `number` \| `null`; `transactions`: readonly [`TonTx`](#tontx)[]; \}\>

GET /api/v3/transactionsByMessage?body_hash=…&direction=in, with `headUtime`: the `gen_utime` of a masterchain
block through which the index that answered holds every block, read from that same index before the lookup, or null
when the reader cannot read it from that index. `masterchainInfo`'s `last` can be ahead of an earlier block the
index has not finished writing, so on its own it does not name such a block. A lookup naming no time never reads
`expired`, nor `no-transfer` or `aborted` from the W5 wallet's transactions.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `bodyHash` | `` `0x${string}` `` |

###### Returns

`Promise`\<\{ `headUtime`: `number` \| `null`; `transactions`: readonly [`TonTx`](#tontx)[]; \}\>

##### byInMessage()

> **byInMessage**(`msgHash`): `Promise`\<readonly [`TonTx`](#tontx)[]\>

GET /api/v3/transactionsByMessage?msg_hash=…&direction=in

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `msgHash` | `string` |

###### Returns

`Promise`\<readonly [`TonTx`](#tontx)[]\>

##### headUtime()

> **headUtime**(): `Promise`\<`number`\>

GET /api/v3/masterchainInfo: the last indexed block's gen_utime.

###### Returns

`Promise`\<`number`\>

***

### TvmRef

The read keys a payment's settlement is read by.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-jettonwallet"></a> `jettonWallet` | `string` | The payer's Jetton wallet, raw: the address TON sends the W5 request's one message to. |
| <a id="property-network-1"></a> `network` | `` `tvm:${number}` `` | - |
| <a id="property-requestbodyhash"></a> `requestBodyHash` | `` `0x${string}` `` | The representation hash of the signed W5 request: the body of the message to the payer's wallet. |
| <a id="property-transferbodyhash"></a> `transferBodyHash` | `` `0x${string}` `` | The representation hash of the Jetton transfer body the W5 request sends. |
| <a id="property-validuntil"></a> `validUntil` | `number` | - |
| <a id="property-wallet"></a> `wallet` | `string` | The payer's W5 wallet, raw: the address TON sends the settlement message to. |

***

### TvmUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | The 32-byte representation hash of the W5 request the wallet key signs. |
| `request.hash` | `Uint8Array` | - |
| `request.kind` | `"ton-w5"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `TvmPayment`

Takes the 64-byte Ed25519 signature.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `TvmPayment`

## Type Aliases

### TvmNetwork

> **TvmNetwork** = `` `tvm:${number}` ``

tvm:<global_id>: tvm:-239 mainnet, tvm:-3 testnet.

***

### TvmStatus

> **TvmStatus** = \{ `finality`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"in-flight"` \| `"not-final"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"aborted"` \| `"no-transfer"` \| `"bounced"` \| `"expired"`; \}

## Variables

### exactTvm

> `const` **exactTvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmUnsigned`](#tvmunsigned)\>; `carrier`: `"extra.forwardPayload"`; `claims`: `boolean`; `id`: `"x402/exact/tvm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmRef`](#tvmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`TvmStatus`](#tvmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### OP

> `const` **OP**: `object`

#### Type Declaration

| Name | Type | Default value |
| ------ | ------ | ------ |
| <a id="property-internalsigned"></a> `internalSigned` | `1936289396` | `0x73696e74` |
| <a id="property-internaltransfer"></a> `internalTransfer` | `395134233` | `0x178d4519` |
| <a id="property-jettontransfer"></a> `jettonTransfer` | `260734629` | `0x0f8a7ea5` |
| <a id="property-sendmsg"></a> `sendMsg` | `247711853` | `0x0ec3c86d` |

## Functions

### lcpComment()

> **lcpComment**(`h`): [`Refusal`](index.md#refusal) \| [`TonCell`](#toncell)

TEP-74's text comment: 32 zero bits, then the UTF-8 of the hash's LCP string. A value that is not a 32-byte hash is
`x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| [`TonCell`](#toncell)

***

### tvmCarrier()

> **tvmCarrier**(`settlementBoc`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

Reads the signed request in a settlement BoC: an internal message whose body is a W5 `internal_signed` request with
exactly one `action_send_msg` behind an empty list, carrying a Jetton transfer whose forward payload is a reference
to a text comment holding an LCP string. The BoC's bytes are read as TON deserializes a bag of cells, and bytes TON
refuses are `tvm/boc-malformed`. `requestBodyHash` and `transferBodyHash` are the representation hashes TON gives,
for any cell TON reads, a pruned branch of any level mask included. Each message is read as TON's action phase sends
it, at mainnet's configuration (global version 15, workchains -1 and 0, no extra currencies): a source of
`addr_none` or an `addr_std` with no anycast (the outgoing message's the W5 wallet's own), a destination TON sends
to, `extra_flags` of at most 3, its state init validated as TON validates it, a referenced body with nothing after
it, and at most two nested Merkle proofs or updates. The settlement message TON would not send is
`tvm/boc-malformed`, and the outgoing one `tvm/not-jetton-transfer`. `wallet` and `jettonWallet` are the addresses
TON sends to: an `addr_var` of 256 bits names its `addr_std`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `settlementBoc` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

***

### tvmRecover()

> **tvmRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. A
transaction with no inbound message body, or whose body is not a Jetton `transfer`, is `tvm/not-jetton-transfer`. A
body that is not a bag of cells with one root is an answer out of the reader's documented form, `tvm/unreadable`. A
ref that names no `transaction` string is `tvm/wrong-reader`, with nothing read. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `tvm:${number}` ``; `transaction`: `string`; \} |
| `ref.network` | `` `tvm:${number}` `` |
| `ref.transaction` | `string` |
| `reader` | [`TvmReader`](#tvmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### tvmStatus()

> **tvmStatus**(`ref`, `reader`): `Promise`\<[`TvmStatus`](#tvmstatus)\>

Reads the head's time first. Then finds the signed request by its body hash on the payer's W5 wallet: only a W5
transaction there that did not abort and emitted the Jetton transfer counts, because W5 checks the request's
signature before any action runs, so a request the payer did not sign sends nothing from that wallet. It follows that
message to the payer's Jetton wallet, and that wallet's `internal_transfer` to whichever Jetton wallet
takes it, which is not compared with `payTo`: settled
when both Jetton wallets executed without aborting, at the lower finality of the two. An equal Jetton body executed
any other way is never counted. A W5 transaction that emitted the Jetton transfer is pending `in-flight` until the
Jetton wallet takes it, because an internal message carries no expiry. When no W5 transaction with the request
emitted the Jetton transfer, the head read first decides, because W5 refuses the request once `valid_until <= now()`:
pending `not-found` up to 60 seconds past `validUntil`, since a W5 transaction runs at its shard block's time, which
a masterchain block references only later; past that, failed `expired` when the W5 wallet holds no transaction with
the request, `no-transfer` when one executed and emitted nothing, and `aborted` when every one aborted, each only
when the lookup names an indexed time at or past the head read first. The lookup shows the W5 wallet's transactions
only through the blocks its index holds, and an internal request that aborts leaves its seqno unused (wallet_v5.fc
commits the seqno only for an external request), so the request can run again before `validUntil`: a lookup whose
index lags that head, or that names no time, is pending `not-found`. The payer's Jetton wallet's transaction aborted
is failed `aborted`, one with no `internal_transfer` failed `no-transfer`, and an aborted delivery failed `bounced`,
at any head and at any finality. A transaction on any other account is ignored. A failed or malformed read, a
malformed reference (a `requestBodyHash` that is not `0x` and 64 hex digits included), or a reader for another
network is pending `unreadable`, a malformed reference with nothing read; the request's body hash is looked up in
lowercase. At most four calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TvmRef`](#tvmref) |
| `reader` | [`TvmReader`](#tvmreader) |

#### Returns

`Promise`\<[`TvmStatus`](#tvmstatus)\>
