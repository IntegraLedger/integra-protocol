---
title: "@integraledger/lcp/tron"
description: "The exports of @integraledger/lcp/tron."
---

# @integraledger/lcp/tron

## Interfaces

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

### TronInfo

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` | - |
| <a id="property-logs"></a> `logs` | readonly `object`[] | `address` is 20-byte hex as the node returns it. |
| <a id="property-result"></a> `result` | `string` | `receipt.result` as the node returns it: "SUCCESS", "REVERT", … |

***

### TronRaw

The `Transaction.raw` fields this profile uses.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calldata"></a> `callData` | `Uint8Array` |
| <a id="property-contractaddress"></a> `contractAddress` | `Uint8Array` |
| <a id="property-data"></a> `data` | `Uint8Array` |
| <a id="property-expiration"></a> `expiration` | `bigint` |
| <a id="property-feelimit-1"></a> `feeLimit` | `bigint` |
| <a id="property-owner"></a> `owner` | `Uint8Array` |
| <a id="property-refblockbytes"></a> `refBlockBytes` | `Uint8Array` |
| <a id="property-refblockhash"></a> `refBlockHash` | `Uint8Array` |
| <a id="property-timestamp"></a> `timestamp` | `bigint` |

***

### TronReader

Bounded, read-only calls against one network's FullNode and SolidityNode. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `tron:${number}` `` |

#### Methods

##### info()

> **info**(`txid`, `level`): `Promise`\<[`TronInfo`](#troninfo) \| `null`\>

`/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"); null: none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `` `0x${string}` `` |
| `level` | `"head"` \| `"solid"` |

###### Returns

`Promise`\<[`TronInfo`](#troninfo) \| `null`\>

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

The read keys recorded at claim, JSON-serialisable. `asset` is the contract's 21-byte address; `expiration` is decimal milliseconds.

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
| `request.txid` | `Uint8Array` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`TronPayment`](#tronpayment)

Takes the 65-byte secp256k1 signature `r ‖ s ‖ v`, v in {0, 1, 27, 28}.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`TronPayment`](#tronpayment)

## Type Aliases

### TronNetwork

> **TronNetwork** = `` `tron:${number}` ``

CAIP-2 with the decimal chain id: tron:728126428 mainnet, tron:3448148188 Nile, tron:2494104990 Shasta.

***

### TronPayment

> **TronPayment** = [`X402Payment`](x402.md#x402payment)\<\{ `transaction`: `string`; \}\>

***

### TronStatus

> **TronStatus** = \{ `blockNumber`: `bigint`; `finality`: `"solidified"` \| `"head"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `result?`: `string`; `state`: `"failed"`; `why`: `"contract-failed"` \| `"no-transfer"` \| `"expired"`; \}

## Variables

### exactTronMemo

> `const` **exactTronMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronUnsigned`](#tronunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/tron/lcp-trc20-memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TronRef`](#tronref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`TronStatus`](#tronstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `txId`: (`tx`) => `string`; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

> **decodeTronTx**(`hex`): [`Refusal`](index.md#refusal) \| \{ `raw`: [`TronRaw`](#tronraw); `rawBytes`: `Uint8Array`; `signatures`: `Uint8Array`\<`ArrayBufferLike`\>[]; \}

Decodes a signed `Transaction` from lowercase hex: `raw_data` with exactly one `TriggerSmartContract` and only the
fields TronRaw names, and 1 to 5 signatures of 65 bytes. The raw bytes must be exactly what `encodeTronRaw` writes
for the fields read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `hex` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `raw`: [`TronRaw`](#tronraw); `rawBytes`: `Uint8Array`; `signatures`: `Uint8Array`\<`ArrayBufferLike`\>[]; \}

***

### encodeTronRaw()

> **encodeTronRaw**(`r`): `Uint8Array`

`Transaction.raw` as java-tron serialises it: fields in ascending order, default values omitted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `r` | [`TronRaw`](#tronraw) |

#### Returns

`Uint8Array`

***

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/tron/lcp-trc20-memo"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/tron/lcp-trc20-memo"` \| `undefined`

***

### tronAddress()

> **tronAddress**(`address`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

Decodes a base58check address to its 21 bytes, which begin 0x41. The checksum is SHA-256 twice.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

***

### tronCarrier()

> **tronCarrier**(`tx`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `txid`: `` `0x${string}` ``; \}\>

The hash in the memo of a transaction whose one contract calls `transfer`, and the transaction id.

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

Recovers the hash from the transaction id alone: the memo of the transaction whose raw bytes hash to the id. One call.

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

Reads the latest solidified block first, then the transaction by id: at the Solidity node, then at the FullNode's
head. Settled when its receipt result is `SUCCESS` and it holds a `Transfer` log from `ref.asset`. Failed as
`expired` only when that earlier solidified block is two slots past the expiration and neither lookup finds the
transaction. A failed read, or a reader for another network, is pending. At most three calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TronRef`](#tronref) |
| `reader` | [`TronReader`](#tronreader) |

#### Returns

`Promise`\<[`TronStatus`](#tronstatus)\>

***

### tronTxId()

> **tronTxId**(`tx`): `string`

A Tron transaction id in one spelling: lowercase hex without `0x`, the SHA-256 of `raw_data` as the node's `txID`
gives it, whether it is given with or without `0x` and in either case. Any other string is returned unchanged.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `string` |

#### Returns

`string`
