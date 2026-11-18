---
title: "@integraledger/lcp/tron"
description: "Tron: the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its memo, `raw_data.data`, in LCP string form, and the transaction pieces it uses."
---

# @integraledger/lcp/tron

Tron: the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its
memo, `raw_data.data`, in LCP string form, and the transaction pieces it uses.

The pieces are protobuf for the fields the profile uses, base58check addresses and the transaction id. Settlement is
read by transaction id through a bounded reader.

## Interfaces

### TronBlock

A block as `getblockbylimitnext` and `getblockbynum` give it: its `blockID`, the `number` and `parentHash` of its
header's `raw_data`, and the `raw_data_hex` of each of its `transactions`, in order (java-tron at `4e8389f1`,
`framework/src/main/java/org/tron/core/services/http/Util.java:137-148`, `:295-298`).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-blockid"></a> `blockId` | `` `0x${string}` `` |
| <a id="property-number"></a> `number` | `bigint` |
| <a id="property-parenthash"></a> `parentHash` | `` `0x${string}` `` |
| <a id="property-transactions"></a> `transactions` | readonly `string`[] |

***

### TronChoice

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-feelimit"></a> `feeLimit` | `bigint` | In sun, from 1 to 15,000,000,000. |
| <a id="property-now"></a> `now` | `bigint` | Milliseconds since the epoch. |
| <a id="property-payer"></a> `payer` | `string` | The payer's base58check address. |
| <a id="property-refblock"></a> `refBlock` | `object` | A recent block from the buyer's FullNode. |
| `refBlock.id` | `` `0x${string}` `` | - |
| `refBlock.number` | `bigint` | - |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |

***

### TronCursor

The search's position: the last block it linked, by its number and `blockID`, at or below the solidified head. A
`pending` answer returns it, and the next call takes it as `query.search` and reads on from the block after it.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-blockid-1"></a> `blockId` | `readonly` | `` `0x${string}` `` |
| <a id="property-number-1"></a> `number` | `readonly` | `bigint` |

***

### TronInfo

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` | - |
| <a id="property-logs"></a> `logs` | readonly `object`[] | `address` is 20-byte hex as the node returns it; `data`, where given, the log's data in hex. |
| <a id="property-result"></a> `result` | `string` | `receipt.result` as the node returns it: "SUCCESS", "REVERT", … |

***

### TronNow

A node's latest block at a level, as its `getnowblock` names it: its number, its `blockID` and its time in ms.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-blockid-2"></a> `blockId` | `` `0x${string}` `` |
| <a id="property-number-2"></a> `number` | `bigint` |
| <a id="property-timestamp"></a> `timestamp` | `bigint` |

***

### TronRaw

The `Transaction.raw` fields this profile uses. `B` is what its bytes are backed by: `decodeTronTx` gives
`TronRaw<ArrayBuffer>`, each byte field in its own fresh `ArrayBuffer`, and `encodeTronRaw` and `tronCarrier` take
any backing.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calldata"></a> `callData` | `Uint8Array`\<`B`\> |
| <a id="property-contractaddress"></a> `contractAddress` | `Uint8Array`\<`B`\> |
| <a id="property-data"></a> `data` | `Uint8Array`\<`B`\> |
| <a id="property-expiration"></a> `expiration` | `bigint` |
| <a id="property-feelimit-1"></a> `feeLimit` | `bigint` |
| <a id="property-owner"></a> `owner` | `Uint8Array`\<`B`\> |
| <a id="property-refblockbytes"></a> `refBlockBytes` | `Uint8Array`\<`B`\> |
| <a id="property-refblockhash"></a> `refBlockHash` | `Uint8Array`\<`B`\> |
| <a id="property-timestamp-1"></a> `timestamp` | `bigint` |

***

### TronReader

Bounded, read-only calls against one network's FullNode: its `/walletsolidity` API for solidified data and its
`/wallet` API at the head. Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`, and
reads as unreadable `transport`; a rejection whose `kind` is `too-large`, as `ReaderError` carries it, is an answer over
the reader's byte bound.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-archival"></a> `archival?` | `readonly` | `boolean` | Declared by the caller where its node holds the chain's whole history, so that with no position given absence can be read; absent, it is not declared. |
| <a id="property-network"></a> `network` | `readonly` | `` `tron:${number}` `` | - |

#### Methods

##### block()

> **block**(`num`, `level`): `Promise`\<\{ `block`: [`TronBlock`](#tronblock) \| `null`; `head`: `bigint` \| `null`; \}\>

`getblockbynum` at the level: the block, or null for the node's `{}`; and `head`, as `blocks` gives it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `num` | `bigint` |
| `level` | [`TronLevel`](#tronlevel) |

###### Returns

`Promise`\<\{ `block`: [`TronBlock`](#tronblock) \| `null`; `head`: `bigint` \| `null`; \}\>

##### blocks()

> **blocks**(`start`, `end`, `level`): `Promise`\<\{ `blocks`: readonly [`TronBlock`](#tronblock)[]; `head`: `bigint` \| `null`; \}\>

`getblockbylimitnext` under `/walletsolidity` ("solid") or `/wallet` ("head"): the blocks from `start` up to `end`,
not including it, at most 100, in the order the node gives them, none for its `{}`; and `head`, the number of that
node's latest block at that level, read from that same node before the call, or null where the reader cannot.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `start` | `bigint` |
| `end` | `bigint` |
| `level` | [`TronLevel`](#tronlevel) |

###### Returns

`Promise`\<\{ `blocks`: readonly [`TronBlock`](#tronblock)[]; `head`: `bigint` \| `null`; \}\>

##### info()

> **info**(`txid`, `level`): `Promise`\<[`TronInfo`](#troninfo) \| \{ `notFound`: `true`; `timestamp`: `bigint` \| `null`; \}\>

`/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"). When the node does
not know the transaction, `notFound` with `timestamp`: the time in milliseconds of the latest block at that level
on the node that answered (`/walletsolidity/getnowblock` or `/wallet/getnowblock`), read from that same node before
the lookup, or null when the reader cannot read it from that node. A lookup naming no time never reads failed.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |
| `level` | [`TronLevel`](#tronlevel) |

###### Returns

`Promise`\<[`TronInfo`](#troninfo) \| \{ `notFound`: `true`; `timestamp`: `bigint` \| `null`; \}\>

##### now()

> **now**(`level`): `Promise`\<[`TronNow`](#tronnow)\>

`/walletsolidity/getnowblock` ("solid") or `/wallet/getnowblock` ("head"): the latest block at that level.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `level` | [`TronLevel`](#tronlevel) |

###### Returns

`Promise`\<[`TronNow`](#tronnow)\>

##### transaction()

> **transaction**(`txid`): `Promise`\<\{ `rawDataHex`: `string`; \} \| `null`\>

`/walletsolidity/gettransactionbyid`; null: none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |

###### Returns

`Promise`\<\{ `rawDataHex`: `string`; \} \| `null`\>

***

### TronRef

The read keys `reference` returns, JSON-serialisable. `raw` is the `raw_data` the owner signed, lowercase hex, which
is the payment presented; `txid` its SHA-256, the single-use value; `asset` the contract's 21-byte address;
`expiration` decimal milliseconds; `payer` the transaction's owner in base58check, read from the signed bytes; and
`payee` the `payTo` of the option the payment answers, the key of the two party tests and no search key.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `` `0x${string}` `` |
| <a id="property-expiration-1"></a> `expiration` | `string` |
| <a id="property-network-1"></a> `network` | `` `tron:${number}` `` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |
| <a id="property-raw"></a> `raw` | `string` |
| <a id="property-txid"></a> `txid` | `` `0x${string}` `` |

***

### TronUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | What the payer signs. `rawBytes` is the transaction's `raw_data`, `Transaction.raw` as `encodeTronRaw` writes it; `txid` is its SHA-256, the 32-byte transaction id. `tronRequest` reads them. |
| `request.kind` | `"tron-txid"` | - |
| `request.rawBytes` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.txid` | `Uint8Array`\<`ArrayBuffer`\> | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`TronPayment`](index.md#tronpayment)

Takes the 65-byte secp256k1 signature `r ‖ s ‖ v`, v in {0, 1, 27, 28}.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`TronPayment`](index.md#tronpayment)

## Type Aliases

### TronLevel

> **TronLevel** = `"solid"` \| `"head"`

The level a read goes through: the full node's `/walletsolidity` API ("solid") or its `/wallet` API ("head").

***

### TronMark

> **TronMark** = `"head"` \| `"solidified"`

***

### TronNetwork

> **TronNetwork** = `` `tron:${number}` ``

CAIP-2 with the decimal chain id: tron:728126428 mainnet, tron:3448148188 Nile, tron:2494104990 Shasta.

***

### TronQuery

> **TronQuery** = [`StatusQuery`](index.md#statusquery)\<[`TronRef`](#tronref), `bigint`, [`TronMark`](#tronmark), [`TronCursor`](#troncursor)\>

The query `tronStatus` takes: the profile `read-status`'s, its search position a `TronCursor`.

***

### TronStatus

> **TronStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, [`TronMark`](#tronmark), [`TronCursor`](#troncursor)\>

The answer of `tronStatus`, as the profile `read-status` gives it. Its marks are `head` and `solidified`, in that
order, its position the block number and its search position a `TronCursor`. A `settled` answer states `presented`:
`yes` where the settled transaction's id is the reference's, the id being the SHA-256 of the `raw_data` the owner
signed, and `no` otherwise; its `signer` is the transaction's owner in base58check, and its `authority` the
contract's `Permission_id`, as `Permission_id 0`, 0 where the transaction names none.

## Variables

### exactTronMemo

> `const` **exactTronMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronUnsigned`](#tronunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/tron/lcp-trc20-memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronRef`](#tronref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TronStatus`](#tronstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/tron/lcp-trc20-memo`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator
broadcasts the TRC-20 transfer the payer signed; `status` reads it by transaction id.

***

### LCP\_TRC20\_MEMO

> `const` **LCP\_TRC20\_MEMO**: `"lcp-trc20-memo"` = `"lcp-trc20-memo"`

***

### TRANSFER\_SELECTOR

> `const` **TRANSFER\_SELECTOR**: `"a9059cbb"` = `"a9059cbb"`

transfer(address,uint256)

***

### TRANSFER\_TOPIC

> `const` **TRANSFER\_TOPIC**: `"ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"` = `"ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"`

keccak256("Transfer(address,address,uint256)")

***

### TRIGGER\_SMART\_CONTRACT

> `const` **TRIGGER\_SMART\_CONTRACT**: `31` = `31`

***

### TRIGGER\_URL

> `const` **TRIGGER\_URL**: `"type.googleapis.com/protocol.TriggerSmartContract"` = `"type.googleapis.com/protocol.TriggerSmartContract"`

***

### TRON\_BOUNDS

> `const` **TRON\_BOUNDS**: `Readonly`\<\{ `callData`: `68`; `feeLimit`: `15000000000`; `maxTimeoutSeconds`: `86340`; `rangeBlocks`: `100`; `searchBlocks`: `200`; `signatureBytes`: `65`; `signatures`: `5`; `transactionHex`: `8192`; \}\>

The pairing's bounds, each the chain's, the profile's or lcp's own resource bound, with its reason.
`transactionHex`: lcp's bound on a signed transaction's hex digits, which the profile's transaction fits many times
over and which bounds what is decoded. `signatures`: lcp's bound on the signatures decoded, enough for an owner's
permission of five keys. `signatureBytes`: a secp256k1 signature `r ‖ s ‖ v`. `callData`: `transfer(address,uint256)`,
its selector and two 32-byte words. `feeLimit`: the network's largest `fee_limit` in sun. `maxTimeoutSeconds`: the
profile's, which keeps a signed `expiration` within the node's 24-hour cap. `rangeBlocks`: the node's own bound on a
range of `getblockbylimitnext` (java-tron at `4e8389f1`, `GetBlockByLimitNextServlet.java:18`). `searchBlocks`: lcp's
resource bound, the blocks one call of `tronStatus` reads of its search, two full ranges, so that each call's reads
are bounded; the next call takes the search's position.

## Functions

### decodeTronTx()

> **decodeTronTx**(`hex`): [`Refusal`](index.md#refusal) \| \{ `raw`: [`TronRaw`](#tronraw)\<`ArrayBuffer`\>; `rawBytes`: `Uint8Array`\<`ArrayBuffer`\>; `signatures`: `Uint8Array`\<`ArrayBuffer`\>[]; \}

Decodes a signed `Transaction` from lowercase hex: `raw_data` with exactly one `TriggerSmartContract` and only the
fields TronRaw names, and 1 to 5 signatures of 65 bytes. The raw bytes must be exactly what `encodeTronRaw` writes
for the fields read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `hex` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `raw`: [`TronRaw`](#tronraw)\<`ArrayBuffer`\>; `rawBytes`: `Uint8Array`\<`ArrayBuffer`\>; `signatures`: `Uint8Array`\<`ArrayBuffer`\>[]; \}

***

### encodeTronRaw()

> **encodeTronRaw**(`r`): `Uint8Array`\<`ArrayBuffer`\>

`Transaction.raw` as java-tron serialises it: fields in ascending order, default values omitted. Throws TypeError
when `r` is not an object, a bytes field is not a `Uint8Array`, or `expiration`, `timestamp` or `feeLimit` is not a
bigint from 0 below 2^63, the values `decodeTronTx` reads back.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `r` | [`TronRaw`](#tronraw) |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### tronAddress()

> **tronAddress**(`address`): `Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

Decodes a base58check address to its 21 bytes, which begin 0x41. The checksum is SHA-256 twice.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

***

### tronCarrier()

> **tronCarrier**(`tx`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `txid`: `` `0x${string}` ``; \}\>

The hash in the memo of a transaction whose one contract calls `transfer`, and the transaction id. A `tx` that is not
`decodeTronTx`'s `{ raw, rawBytes }` is `tron/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | \{ `raw`: [`TronRaw`](#tronraw); `rawBytes`: `Uint8Array`; \} |
| `tx.raw` | [`TronRaw`](#tronraw) |
| `tx.rawBytes` | `Uint8Array` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `txid`: `` `0x${string}` ``; \}\>

***

### tronRecover()

> **tronRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the transaction id alone: the memo of the transaction whose raw bytes hash to the id. A ref
whose `txid` is not a 32-byte hash is `tron/wrong-reader`, with nothing read. Raw data longer than the size bound
`decodeTronTx` reads is `tron/tx-too-large`, the code that function gives such a transaction. Raw data whose SHA-256
is not the id is not the transaction it names, and is `tron/unreadable`, as a failed read is. The input's `tx` is the
id, and its `option` the option the payment answers, an object, of which the read needs no member; an input whose
`tx` is not a 32-byte hash, or whose option is not an object, is `tron/wrong-reader`, with nothing read. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `tron:${number}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`TronReader`](#tronreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### tronRequest()

> **tronRequest**(`rawBytes`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `asset`: `string`; `h`: `` `0x${string}` ``; `payer`: `string`; `payTo`: `string`; `raw`: [`TronRaw`](#tronraw)\<`ArrayBuffer`\>; `txid`: `Uint8Array`\<`ArrayBuffer`\>; \}\>

Reads the `raw_data` a `tron-txid` request carries, as `decodeTronTx` reads a signed transaction's and `tronCarrier`
reads its call and memo, with their codes, and gives `txid`, its SHA-256, which is the request's `txid` when the bytes
are its `rawBytes`. `raw` is every field the bytes hold, which are all the fields `decodeTronTx` admits: the reference
block's bytes and hash, `expiration` and `timestamp` in milliseconds, the memo `data`, `fee_limit` in sun, and the one
contract, a `TriggerSmartContract` with no call value from `owner` to `contractAddress` whose call data is
`transfer(address,uint256)`. Read from them: `payer`, the owner, and `asset`, the contract, in base58check; `payTo`,
the transfer's recipient, its address word's last 20 bytes under 0x41, in base58check; `amount`, the transfer's
value, in decimal; and `h`, the hash the memo carries. Bytes longer than the longest transaction `decodeTronTx` reads,
4,096 bytes, are `tron/tx-too-large`, and a value that is not a `Uint8Array` `tron/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rawBytes` | `Uint8Array` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `asset`: `string`; `h`: `` `0x${string}` ``; `payer`: `string`; `payTo`: `string`; `raw`: [`TronRaw`](#tronraw)\<`ArrayBuffer`\>; `txid`: `Uint8Array`\<`ArrayBuffer`\>; \}\>

***

### tronStatus()

> **tronStatus**(`ref`, `reader`, `query`): `Promise`\<[`TronStatus`](#tronstatus)\>

Answers the read of the act the query asks about as the profile `read-status` gives it, by the pairing's profile, rule
8. The single-use value is the transaction id, the SHA-256 of the `raw_data` the owner signed, which the reference
holds whole as the payment presented. The read takes the latest solidified block first, then the transaction by id at
the solidified level and at the head, each lookup naming its own node's latest block time. Found, the transaction
consumed the id: it is the payer's act where its owner is the reference's payer and not the option's payee, it
succeeded where its receipt's result is `SUCCESS`, and what it moved is each `Transfer` log of its receipt whose
sender is the owner, named by the id and the log's place among the receipt's logs, or, where the receipt holds no
`Transfer` log and its signed call is a transfer of zero, that call's transfer of zero to its `to`; on the act
`payment` it is the payment only where one of those names `payTo`. Its owner is the answer's signer, and its
`Permission_id` the answer's authority. Absent from both lookups, each lookup's node at or past the solidified head's time, and the node holding the
block at the position the caller gave (or declared archival where it gave none), the id is unconsumed: before the
lapse, two slots past `expiration`, `instrument-live`. Only a `failed` answer needs the search for H, which the read
makes only then: it reads every block after the position given, or after the search position an earlier answer
returned, up to the solidified head read first through `/walletsolidity`, then on to the full node's head under
`/wallet`, at most `TRON_BOUNDS.rangeBlocks` a call and `TRON_BOUNDS.searchBlocks` a read, each block linked to the one
before it by its `parentHash`. Each transaction whose `data`, field 10 of its `raw_data`, is H's LCP string, its hex digits
in either case as `bound` reads it, is read by its id: one of the form whose owner is the payer and that meets the act's tests is the act asked about; any other is
named as a foreign item where a reason holds. Until a run shows that a block's answer lists every transaction of its
block, a search read whole proves no absence, so no `failed` but `before-position` is answered. A ref, a reader or a
query that is not one, a ref whose `raw` does not hash to its `txid`, is not the form's or is not owned by its
`payer`, or a search position that is not a `TronCursor`, is unreadable `unparseable`, with nothing read; a reader for
another network `chain-mismatch`; a read that rejects `transport`; one block over the reader's byte bound
`too-large`; and absence where the node does not hold the history `history-gap`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TronRef`](#tronref) |
| `reader` | [`TronReader`](#tronreader) |
| `query` | [`TronQuery`](#tronquery) |

#### Returns

`Promise`\<[`TronStatus`](#tronstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### TronPayment

Re-exports [TronPayment](index.md#tronpayment)

***

### X402Payment

Re-exports [X402Payment](index.md#x402payment)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)
