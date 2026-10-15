---
title: "@integraledger/lcp/tron"
description: "The exports of @integraledger/lcp/tron."
---

# @integraledger/lcp/tron

## Interfaces

### TronInfo

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` | - |
| <a id="property-logs"></a> `logs` | readonly `object`[] | `address` is 20-byte hex as the node returns it. |
| <a id="property-result"></a> `result` | `string` | `receipt.result` as the node returns it: "SUCCESS", "REVERT", … |

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
| <a id="property-feelimit"></a> `feeLimit` | `bigint` |
| <a id="property-owner"></a> `owner` | `Uint8Array`\<`B`\> |
| <a id="property-refblockbytes"></a> `refBlockBytes` | `Uint8Array`\<`B`\> |
| <a id="property-refblockhash"></a> `refBlockHash` | `Uint8Array`\<`B`\> |
| <a id="property-timestamp"></a> `timestamp` | `bigint` |

***

### TronReader

Bounded, read-only calls against one network's FullNode: its `/walletsolidity` API for solidified data and its
`/wallet` API at the head. Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`; any
rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `tron:${number}` `` |

#### Methods

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
| `level` | `"head"` \| `"solid"` |

###### Returns

`Promise`\<[`TronInfo`](#troninfo) \| \{ `notFound`: `true`; `timestamp`: `bigint` \| `null`; \}\>

##### solidHead()

> **solidHead**(): `Promise`\<\{ `number`: `bigint`; `timestamp`: `bigint`; \}\>

`/walletsolidity/getnowblock`: the latest solidified block's number and time in milliseconds.

###### Returns

`Promise`\<\{ `number`: `bigint`; `timestamp`: `bigint`; \}\>

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

The read keys `reference` returns, JSON-serialisable. `asset` is the contract's 21-byte address; `expiration` is
decimal milliseconds.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `` `0x${string}` `` |
| <a id="property-expiration-1"></a> `expiration` | `string` |
| <a id="property-network-1"></a> `network` | `` `tron:${number}` `` |
| <a id="property-txid"></a> `txid` | `` `0x${string}` `` |

***

### TronUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | The 32-byte transaction id the payer signs. |
| `request.kind` | `"tron-txid"` | - |
| `request.txid` | `Uint8Array`\<`ArrayBuffer`\> | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `TronPayment`

Takes the 65-byte secp256k1 signature `r ‖ s ‖ v`, v in {0, 1, 27, 28}.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `TronPayment`

## Type Aliases

### TronNetwork

> **TronNetwork** = `` `tron:${number}` ``

CAIP-2 with the decimal chain id: tron:728126428 mainnet, tron:3448148188 Nile, tron:2494104990 Shasta.

***

### TronStatus

> **TronStatus** = \{ `blockNumber`: `bigint`; `finality`: `"solidified"` \| `"head"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `result?`: `string`; `state`: `"failed"`; `why`: `"contract-failed"` \| `"no-transfer"` \| `"expired"`; \}

## Variables

### exactTronMemo

> `const` **exactTronMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronUnsigned`](#tronunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/tron/lcp-trc20-memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronRef`](#tronref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`TronStatus`](#tronstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

> **tronRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the transaction id alone: the memo of the transaction whose raw bytes hash to the id. A ref
whose `txid` is not a 32-byte hash is `tron/wrong-reader`, with nothing read. Raw data longer than the size bound
`decodeTronTx` reads is `tron/tx-too-large`, the code that function gives such a transaction. Raw data whose SHA-256
is not the id is not the transaction it names, and is `tron/unreadable`, as a failed read is. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `tron:${number}` ``; `txid`: `` `0x${string}` ``; \} |
| `ref.network` | `` `tron:${number}` `` |
| `ref.txid` | `` `0x${string}` `` |
| `reader` | [`TronReader`](#tronreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### tronStatus()

> **tronStatus**(`ref`, `reader`): `Promise`\<[`TronStatus`](#tronstatus)\>

Reads the latest solidified block first, then the transaction by id: through the FullNode's `/walletsolidity` API for
solidified data, then its `/wallet` API at the head. Settled when its receipt result is `SUCCESS` and it holds a
`Transfer` log from `ref.asset`; otherwise failed, at whichever lookup finds the transaction first, the head's
included, and a failed answer names no level. Failed as `expired` only when that earlier solidified block is two
slots past the expiration and neither lookup finds the transaction, each naming a block time at or past that earlier
block's: a lookup whose node lags the block read first, or that names no time, is pending `not-found`. A failed read,
an answer of neither documented shape, or a reader for another network is pending `unreadable`. A ref whose `txid` is
not `0x` and 64 hex digits, or whose `asset` is not the token's 21-byte address in hex (`41` and 20 bytes, `0x`
optional), is pending `unreadable`, with nothing read; the reader is given the txid in lowercase. At most three
calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TronRef`](#tronref) |
| `reader` | [`TronReader`](#tronreader) |

#### Returns

`Promise`\<[`TronStatus`](#tronstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
