---
title: "@integraledger/lcp/tvm"
description: "The exports of @integraledger/lcp/tvm."
---

# @integraledger/lcp/tvm

## Interfaces

### TonAccountState

An account's status and data hash, as TON Center v3 states them before or after a transaction.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-datahash"></a> `dataHash` | `string` \| `null` | The representation hash of the account's data, in the index's spelling; null where the account holds none. |
| <a id="property-status"></a> `status` | [`TonAccountStatus`](#tonaccountstatus) | - |

***

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

### TonIndexed

The index's statement of the masterchain blocks it holds: every block from `first` through `last`, a finalized block.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-first"></a> `first` | `bigint` | - |
| <a id="property-last"></a> `last` | `bigint` | - |
| <a id="property-utime"></a> `utime` | `number` | `last`'s `gen_utime`. |

***

### TonLink

A transaction of the wallet's list by the two members its successor links it by: its hash and its logical time.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-hash"></a> `hash` | `readonly` | `string` | - |
| <a id="property-lt"></a> `lt` | `readonly` | `string` | In decimal. |

***

### TonOutMsg

A transaction's out message: its hash, its body's opcode (null where it has none), and its body as a BoC.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | The body as a bag of cells (`message_content.body`); absent or null where the index gives none. |
| <a id="property-hash-1"></a> `hash` | `string` | - |
| <a id="property-opcode"></a> `opcode` | `number` \| `null` | - |

***

### TonTx

A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC, or null when the
transaction has no inbound message body (its `in_msg`, or that message's `message_content.body`, is null). The members
after `outMsgs` are the ones the expiry read takes, from `/api/v3/transactions`: a transaction lacking one cannot be
placed, linked or classed, and the read holds its search there.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-aborted"></a> `aborted` | `boolean` | - |
| <a id="property-account"></a> `account` | `string` | - |
| <a id="property-after"></a> `after?` | [`TonAccountState`](#tonaccountstate) | The account's state after it (`account_state_after`, with `end_status`). |
| <a id="property-before"></a> `before?` | [`TonAccountState`](#tonaccountstate) | The account's state before it (`account_state_before`, with `orig_status`). |
| <a id="property-finality"></a> `finality` | `0` \| `1` \| `2` | TON Center v3's `FinalityState`: 0 pending, 1 confirmed, 2 finalized. |
| <a id="property-hash-2"></a> `hash` | `string` | - |
| <a id="property-inbody"></a> `inBody` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-insource"></a> `inSource?` | `string` \| `null` | The inbound message's source, raw (`in_msg.source`); null for an external message. |
| <a id="property-lt-1"></a> `lt?` | `string` | Its logical time, in decimal (`lt`). |
| <a id="property-mcseqno"></a> `mcSeqno?` | `bigint` \| `null` | The masterchain block that holds it (`mc_block_seqno`); null while none does. |
| <a id="property-outmsgs"></a> `outMsgs` | readonly [`TonOutMsg`](#tonoutmsg)[] | - |
| <a id="property-prev"></a> `prev?` | \{ `hash`: `string`; `lt`: `string`; \} \| `null` | Its predecessor on the account (`prev_trans_hash`, `prev_trans_lt`); null for the account's first. |

***

### TonWalletState

A wallet's state as the index holds it (`walletStates`): status, code hash, sequence number, last transaction.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-codehash"></a> `codeHash` | `` `0x${string}` `` \| `null` | The representation hash of the account's code, `0x` and 64 hex digits; null where it holds none. |
| <a id="property-last-1"></a> `last` | \{ `hash`: `string`; `lt`: `string`; \} \| `null` | The account's last transaction; null where it has none. |
| <a id="property-seqno"></a> `seqno` | `number` \| `null` | The wallet's sequence number; null where the account holds no data. |
| <a id="property-status-1"></a> `status` | [`TonAccountStatus`](#tonaccountstatus) | - |

***

### TvmReader

Bounded, read-only calls against one network's TON Center v3 endpoint. Every failure rejects, for example with
`ReaderError` from `@integraledger/lcp/evm`: one of kind `too-large` reads as `too-large`, one of kind `malformed` as
`unparseable`, and any other rejection as `transport`.

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

> **byInBody**(`bodyHash`): `Promise`\<readonly [`TonTx`](#tontx)[]\>

GET /api/v3/transactionsByMessage?body_hash=…&direction=in: the transactions that took a message with this body.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `bodyHash` | `` `0x${string}` `` |

###### Returns

`Promise`\<readonly [`TonTx`](#tontx)[]\>

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

GET /api/v3/masterchainInfo: the latest masterchain block's gen_utime, the latest head the endpoint serves.

###### Returns

`Promise`\<`number`\>

##### indexed()

> **indexed**(): `Promise`\<[`TonIndexed`](#tonindexed) \| `null`\>

The index's own statement of the masterchain blocks through which it holds every block, from the same index that
answers the other calls, or null where it states none. `masterchainInfo`'s `last` is no such statement: it can be
ahead of an earlier block the index has not finished writing.

###### Returns

`Promise`\<[`TonIndexed`](#tonindexed) \| `null`\>

##### jettonMaster()

> **jettonMaster**(`jettonWallet`): `Promise`\<`string`\>

`runGetMethod` `get_wallet_data` on a Jetton wallet: its master, raw.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `jettonWallet` | `string` |

###### Returns

`Promise`\<`string`\>

##### jettonWallet()

> **jettonWallet**(`master`, `owner`): `Promise`\<`string`\>

`runGetMethod` `get_wallet_address` on a Jetton master for an owner: the owner's Jetton wallet, raw.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `master` | `string` |
| `owner` | `string` |

###### Returns

`Promise`\<`string`\>

##### transactions()

> **transactions**(`account`, `from`, `limit`): `Promise`\<readonly [`TonTx`](#tontx)[]\>

GET /api/v3/transactions?account=…&end_lt=…&sort=desc&limit=…: the account's transactions from `from` back, newest
first, at most `limit`, each with the members the expiry read takes.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `from` | \{ `hash`: `string`; `lt`: `string`; \} |
| `from.hash` | `string` |
| `from.lt` | `string` |
| `limit` | `number` |

###### Returns

`Promise`\<readonly [`TonTx`](#tontx)[]\>

##### walletState()

> **walletState**(`account`): `Promise`\<[`TonWalletState`](#tonwalletstate)\>

GET /api/v3/walletStates?address=…: the wallet's state as the index holds it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |

###### Returns

`Promise`\<[`TonWalletState`](#tonwalletstate)\>

***

### TvmRef

The read keys a payment's settlement is read by, the members of the payment presented, and the payee, the `payTo` of
the option the payment answers, for both party tests and no search key. It names no asset.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-codehash-1"></a> `codeHash?` | `` `0x${string}` `` | The representation hash of the code in the state init the payment carries; absent where it carries none. |
| <a id="property-h"></a> `h` | `` `0x${string}` `` | H, which the request's Jetton transfer carries: the search for H looks for it in every run of the wallet. |
| <a id="property-jettonwallet"></a> `jettonWallet` | `string` | The payer's Jetton wallet, raw: the address TON sends the W5 request's one message to. |
| <a id="property-network-1"></a> `network` | `` `tvm:${number}` `` | - |
| <a id="property-payee"></a> `payee` | `string` | - |
| <a id="property-requestbodyhash"></a> `requestBodyHash` | `` `0x${string}` `` | The representation hash of the signed W5 request: the whole body of the message to the payer's wallet, its signature and any bit or reference after `has_other_actions` 0, which W5 does not read, included. |
| <a id="property-seqno-1"></a> `seqno` | `number` | The sequence number the request was signed against: the single-use value. |
| <a id="property-signedhash"></a> `signedHash` | `` `0x${string}` `` | The representation hash of the W5 request with its signature removed, its last 512 bits: the hash the wallet's key signs. It holds the members of the payment presented, the request the payer signed, whole, its signature apart. |
| <a id="property-transferbodyhash"></a> `transferBodyHash` | `` `0x${string}` `` | The representation hash of the Jetton transfer body the W5 request sends. |
| <a id="property-validuntil"></a> `validUntil` | `number` | - |
| <a id="property-wallet"></a> `wallet` | `string` | The payer's W5 wallet, raw: the address TON sends the settlement message to. |

***

### TvmSearch

The search position of the expiry read, from which the next read resumes: `top`, the newest transaction of the
wallet the search had listed, and `next`, the transaction it reads next, at or below which nothing is read yet. The
next read lists the wallet's transactions above `top`, which landed since, then reads on from `next`; the ones
between were read.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-next"></a> `next` | `readonly` | [`TonLink`](#tonlink) |
| <a id="property-top"></a> `top` | `readonly` | [`TonLink`](#tonlink) |

***

### TvmUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | What the wallet key signs. `signedBoc` is the W5 request, its signature not in it, as a base64 bag of cells of one root; `hash` is that root cell's 32-byte representation hash. `tvmRequest` reads them. |
| `request.hash` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.kind` | `"ton-w5"` | - |
| `request.signedBoc` | `string` | - |

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

### TonAccountStatus

> **TonAccountStatus** = `"active"` \| `"uninit"` \| `"nonexist"` \| `"frozen"`

An account's status as TON Center v3 states it.

***

### TvmNetwork

> **TvmNetwork** = `` `tvm:${number}` ``

tvm:<global_id>: tvm:-239 mainnet, tvm:-3 testnet.

***

### TvmStatus

> **TvmStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `TvmMark`, [`TvmSearch`](#tvmsearch)\>

The answer of `tvmStatus`, as the profile `read-status` gives it: each transfer of what moved named by the W5
transaction and, as its `place`, the hash of the Jetton `transfer` message that made it. Its marks are
`confirmed` and `finalized`, TON Center v3's finality states 1 and 2, in that order; a position is a masterchain
block's sequence number, and the search position a `TvmSearch`.

## Variables

### exactTvm

> `const` **exactTvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmUnsigned`](#tvmunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/tvm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmRef`](#tvmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TvmStatus`](#tvmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/tvm`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator sends the request
the payer's W5 wallet signed; `status` reads the wallet's transaction and the Jetton transfers it led to.

***

### MAX\_TVM\_ATTACHED\_ABOVE\_FORWARD

> `const` **MAX\_TVM\_ATTACHED\_ABOVE\_FORWARD**: `30000000n` = `30_000_000n`

The most nanotons `build` attaches above the option's forward TON amount: the stock settler refuses a request whose
attached value is above `forwardTonAmount` plus this (`@x402/tvm` 2.30.0, `src/exact/facilitator/scheme.ts:326-329`,
`DEFAULT_JETTON_WALLET_MESSAGE_AMOUNT` in `src/constants.ts:14`).

***

### MAX\_TVM\_BOC\_BYTES

> `const` **MAX\_TVM\_BOC\_BYTES**: `8192` = `8192`

The largest bag of cells the pairing reads, in bytes: lcp's own resource bound, far above the settlement message
of one W5 request with a deploying state init (a few hundred bytes).

***

### MAX\_TVM\_CELLS

> `const` **MAX\_TVM\_CELLS**: `512` = `512`

The most distinct cells a bag of cells the pairing reads may hold: lcp's own resource bound, as above.

***

### MAX\_TVM\_DEPTH

> `const` **MAX\_TVM\_DEPTH**: `32` = `32`

The deepest a bag of cells the pairing reads may be: lcp's own resource bound, as above.

***

### MAX\_TVM\_LISTED

> `const` **MAX\_TVM\_LISTED**: `256` = `256`

The most transactions of the payer's wallet one read lists, back from its latest: lcp's own resource bound. Past it
the search is held at the last masterchain block read.

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

***

### TVM\_EXPIRY\_MARGIN

> `const` **TVM\_EXPIRY\_MARGIN**: `60` = `60`

The seconds a masterchain block's time must pass `validUntil` by before the read takes the request's validity as
passed at that block: a W5 transaction runs at its shard block's time, and a masterchain block references that shard
block only later, so the masterchain head can pass `validUntil` before an index holds a transaction that ran in time.

***

### W5R1\_CODE\_HASH

> `const` **W5R1\_CODE\_HASH**: `"0x20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f"` = `"0x20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f"`

W5R1's code hash, the one entry of the scheme's list of wallets (`scheme_exact_ton.md:166` at `x402-foundation/x402@88b66dd4`).

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

> **tvmCarrier**(`settlementBoc`, `network`): [`Refusal`](index.md#refusal) \| \{ `codeHash?`: `` `0x${string}` ``; `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `seqno`: `number`; `signedHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

Reads the signed request in a settlement BoC: an internal message whose body is a W5 `internal_signed` request with
exactly one `action_send_msg` behind an empty list, carrying a Jetton transfer whose forward payload is a reference
to a text comment holding an LCP string. The request is read as W5's `internal_signed` path reads it
(ton-blockchain/wallet-contract-v5 `contracts/wallet_v5.fc`, `recv_internal`, `process_signed_request` and
`process_actions`): at least 640 bits, its signature the body's last 512 bits, and the signed part the rest with all
its references, in which the wallet id, `valid_until`, seqno, the action list's `Maybe ^Cell` and
`has_other_actions` are read; W5 reads nothing after `has_other_actions` 0, and neither does this, so bits and
references there are carried, not read. A body W5 does not run as a signed request, or whose signed part ends before
those fields, is `tvm/not-w5-signed`, and an empty action list or `has_other_actions` 1 is `tvm/actions`. The
signature is not verified. The BoC's bytes are read as TON deserializes a bag of cells, and bytes TON
refuses are `tvm/boc-malformed`. `requestBodyHash` and `transferBodyHash` are the representation hashes TON gives,
for any cell TON reads, a pruned branch of any level mask included. Each message is read as TON's action phase sends
it, at the configuration lcp holds for `network`, as `bound` and `reference` read the payment of an option on that
network: a source of `addr_none` or an `addr_std` with no anycast (the outgoing message's the W5 wallet's own), a
destination TON sends to, a value and an `extra_flags` of at most 3 each in its shortest form, its state init
validated as TON validates it, a referenced body that is an ordinary cell with nothing after it, and at most two
nested Merkle proofs or updates; the W5 action's send mode is one TON sends with. The network is `tvm:-239` (mainnet)
or `tvm:-3` (testnet), and any other is `tvm/network-malformed`. The settlement message TON would not send is
`tvm/boc-malformed`, and the outgoing one `tvm/not-jetton-transfer`; a send mode other than 1 or 3, the two the
scheme admits, is `tvm/actions`. It also gives the request's sequence number, `signedHash`, the representation hash of
the request less its signature, which the wallet's key signs, and, where the message carries a state init, the
hash of its code. The
settlement message's source names the account that relays it, which the BoC cannot show: one naming another account
is read, and TON sends it when that account relays it. `wallet` and `jettonWallet` are the addresses TON sends to: an
`addr_var` of 256 bits names its `addr_std`. The network, the base64, the 8 KiB bound, the bag-of-cells layout and
its CRC32C need no peer: without @ton/core they give the codes they give with it, and a BoC that passes them is
`tvm/peer-missing`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `settlementBoc` | `string` |
| `network` | `` `tvm:${number}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `codeHash?`: `` `0x${string}` ``; `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `seqno`: `number`; `signedHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

***

### tvmRecover()

> **tvmRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. A
transaction with no inbound message body, or whose body is not a Jetton `transfer`, is `tvm/not-jetton-transfer`. A
body that is not a bag of cells with one root is an answer out of the reader's documented form, `tvm/unreadable`. A
ref that names no `transaction` string is `tvm/wrong-reader`, with nothing read. Without @ton/core the body's cells
cannot be read: a transaction with an inbound message body is `tvm/peer-missing`, after the ref, the reader, the read
and the body's size, bag-of-cells layout and CRC32C are checked, which need no peer, so an empty body is
`tvm/unreadable` and one over 8 KiB `tvm/boc-too-large` either way. The input's `tx` is the transaction's hash, and
its `option` the option the payment answers, an object, of which the read needs no member; an input whose `tx` is
not a non-empty string, or whose option is not an object, is `tvm/wrong-reader`, with nothing read. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `tvm:${number}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`TvmReader`](#tvmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### tvmRequest()

> **tvmRequest**(`signedBoc`, `network`): [`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `attachNanotons`: `bigint`; `customPayload?`: `string`; `extraCurrencies`: `object`[]; `forwardTonAmount`: `string`; `h`: `` `0x${string}` ``; `hash`: `Uint8Array`\<`ArrayBuffer`\>; `jettonWallet`: `string`; `mode`: `number`; `payTo`: `string`; `queryId`: `bigint`; `responseDestination`: `string` \| `null`; `seqno`: `number`; `stateInit?`: `string`; `validUntil`: `number`; `walletId`: `number`; \}

Reads the W5 request a `ton-w5` request carries, `signedBoc`, as `tvmCarrier` reads the signed part of a settlement
message's body at the network's configuration, with its codes, and gives `hash`, the root cell's representation hash,
which is the request's `hash` when the text is its `signedBoc`. The root must be an ordinary cell whose op is
`internal_signed`, or it is `tvm/not-w5-signed`. It gives every member W5 reads: the wallet id, `validUntil`, the
sequence number and the one action's send mode; and of the one message that action sends, its destination
(`jettonWallet`), the nanotons it attaches, each extra currency it attaches by its id, and its state init, where it
carries one, as a base64 bag of cells; and of the Jetton `transfer` it carries, the query id, `amount`, the
destination (`payTo`), the response destination or null for `addr_none`, the custom payload where it carries one, as
a base64 bag of cells, the forward TON amount and the hash the forward payload's comment holds. Addresses are raw. A
request holds one action, sending one Jetton `transfer`, or it is refused, so nothing else runs under the signature;
W5 reads nothing after `has_other_actions`, and neither does this. The request names no wallet, so the message's
source is read as the settlement message's sender is, by its form alone.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedBoc` | `string` |
| `network` | `` `tvm:${number}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `attachNanotons`: `bigint`; `customPayload?`: `string`; `extraCurrencies`: `object`[]; `forwardTonAmount`: `string`; `h`: `` `0x${string}` ``; `hash`: `Uint8Array`\<`ArrayBuffer`\>; `jettonWallet`: `string`; `mode`: `number`; `payTo`: `string`; `queryId`: `bigint`; `responseDestination`: `string` \| `null`; `seqno`: `number`; `stateInit?`: `string`; `validUntil`: `number`; `walletId`: `number`; \}

***

### tvmStatus()

> **tvmStatus**(`ref`, `reader`, `query`): `Promise`\<[`TvmStatus`](#tvmstatus)\>

Answers the read of the request as the profile `read-status` gives it, from the facts the profile `x402-exact-tvm`
(rule 6) names, with `presented` on `settled`. The read takes, from one TON Center v3 index: the latest head's time;
the index's statement of the masterchain blocks it holds; the W5 wallet's transactions with the request's body; the
wallet's state; and, for a W5 wallet, its transactions from the latest back, each by its predecessor, to the first at
or before the position given (the expiry read, which is the search for H). Every run of the wallet whose Jetton
`transfer` carries H is followed to the payer's Jetton wallet and from its `internal_transfer` to the Jetton wallet
that took it, and tested by the two party tests: the W5 wallet is not the option's payee, on either act; and, on the
act `payment`, the delivering account is the payee's Jetton wallet of the payer's Jetton wallet's master, read by
`get_wallet_address` for `payTo` through the reader. Positions are masterchain block sequence numbers. The single-use
value is the signed sequence number: consumed where a listed run is at it, where the active wallet's number is above
it, or where a listed transaction removed or deployed the account; lapsed where the latest head is more than 60
seconds past `validUntil`, and read at the final mark only where the stated finalized block is too. The search is
read whole only through a reader that declares `listsWhole`. A wallet that is not W5 gets no expiry read: its value
is not read, and the body-hash lookup is its search, read whole where the stated block is at or past the latest head.
The read decodes the cells it reads itself, without @ton/core, and compares raw addresses itself, so every answer is
the same with it and without it. A ref, a reader or a query that is not one, or a ref whose hashes are not `0x` and
64 hex digits, is unreadable `unparseable`, with nothing read; a reader for another network than the ref's is
`chain-mismatch`; a rejected read is `transport`, or `too-large` or `unparseable` for a `ReaderError` of that kind;
an answer out of the reader's form is `unparseable`. A frozen account, its code removed, runs no request until a
message restores the state its hash fixes, its number among it, so it reads as `uninit` and `nonexist` do: the number
not passed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TvmRef`](#tvmref) |
| `reader` | [`TvmReader`](#tvmreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`TvmRef`](#tvmref), `bigint`, `TvmMark`, [`TvmSearch`](#tvmsearch)\> |

#### Returns

`Promise`\<[`TvmStatus`](#tvmstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
