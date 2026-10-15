---
title: "@integraledger/lcp/avm"
description: "The exports of @integraledger/lcp/avm."
---

# @integraledger/lcp/avm

## Interfaces

### AvmParams

The buyer's read of algod `GET /v2/transactions/params`. `genesisHash` is its base64.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-feeperbyte"></a> `feePerByte` | `bigint` |
| <a id="property-firstvalid"></a> `firstValid` | `bigint` |
| <a id="property-genesishash"></a> `genesisHash` | `string` |
| <a id="property-genesisid"></a> `genesisId` | `string` |
| <a id="property-minfee"></a> `minFee` | `bigint` |

***

### AvmPresented

The x402 payload on Algorand.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-paymentgroup"></a> `paymentGroup` | readonly `string`[] |
| <a id="property-paymentindex"></a> `paymentIndex` | `number` |

***

### AvmReader

Bounded, read-only calls against one network's Indexer. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `algorand:${string}` `` |

#### Methods

##### search()

> **search**(`txid`): `Promise`\<\{ `currentRound`: `bigint`; `found`: \{ `confirmedRound`: `bigint`; `note`: `Uint8Array`; \} \| `null`; \}\>

`GET /v2/transactions?txid=…`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `string` |

###### Returns

`Promise`\<\{ `currentRound`: `bigint`; `found`: \{ `confirmedRound`: `bigint`; `note`: `Uint8Array`; \} \| `null`; \}\>

***

### AvmRef

The read keys `reference` returns, computed from the signed bytes. `lastValid` is a decimal string, so the reference
is JSON-serialisable.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-lastvalid"></a> `lastValid` | `string` |
| <a id="property-network-1"></a> `network` | `` `algorand:${string}` `` |
| <a id="property-txid"></a> `txid` | `string` |

***

### AvmUnsigned

The bytes the payer signs, and how the signature completes the payment.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | "TX" ‖ msgpack(txn) |
| `request.bytes` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.kind` | `"algorand-txn"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `AvmPaymentPayload`

Completes the payment with the payer's 64-byte Ed25519 signature over `request.bytes`; a signature of any other
length is `avm/signature-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `AvmPaymentPayload`

## Type Aliases

### AlgorandNetwork

> **AlgorandNetwork** = `` `algorand:${string}` ``

CAIP-2: the first 32 characters of the URL-safe base64 genesis hash.

***

### AvmStatus

> **AvmStatus** = \{ `finality`: `"final"`; `round`: `bigint`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"expired"`; \}

## Variables

### exactAvm

> `const` **exactAvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmUnsigned`](#avmunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/algorand"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmRef`](#avmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`AvmStatus`](#avmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/algorand`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
signed transaction `complete` returns; `status` reads it by the transaction id computed from the signed bytes.

***

### MSGPACK\_MAX\_DEPTH

> `const` **MSGPACK\_MAX\_DEPTH**: `32` = `32`

The deepest nesting of msgpack arrays and maps `avmCarrier` reads in a payment entry, the outermost container being
level 1. algod's signed transaction nests at most 10 (a state proof's reveal, down to a byte string written as an
array of numbers), so the cap refuses no entry algod decodes.

## Functions

### avmCarrier()

> **avmCarrier**(`p`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `txid`: `string`; \}

The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, read as a signed asset transfer
whose note is an LCP string. Gives the hash, the transaction id and the last valid round. On the x402 path the entry
has two readers: the facilitator decodes it, and algod decodes the bytes the facilitator submits, which are the
entry's own. The entry is read only when it is one msgpack value nesting at most `MSGPACK_MAX_DEPTH` deep, algod's
decoder takes it as a signed transaction of a type algod knows with no member of another type set, the
facilitator's decoder takes it as an asset transfer, and both read the same signed transaction: their canonical
encodings are equal, and the facilitator can compute its id (it has a genesis hash). Any other entry is
`avm/txn-malformed`, and one algod reads as another type is `avm/not-axfer`. So a repeated scalar key, keys out of
order, a member written at its default, an integer or length in a longer format than it needs, a nil member, or a
binary and a string in each other's place reads as algod reads it, and the transaction id is the one algod computes,
from the transaction's canonical encoding. Where the two read different transactions the entry is refused: a
repeated struct whose earlier occurrences set a member the last one does not, which algod merges in and the
facilitator does not read, a repeated list whose elements algod decodes into those an earlier list left, and a
fixed-length byte member of another length. A byte member written as a msgpack string is read as its
bytes, whatever they are; a string member (`type`, `gen`) is refused when its bytes are not UTF-8, which the
facilitator reads as other text. Each answer is a function of the entry's bytes alone. Both readers are the package's
own (`readEntry`), so nothing here needs algosdk: every answer is the same without it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | [`AvmPresented`](#avmpresented) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `txid`: `string`; \}

***

### avmRecover()

> **avmRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from the landed payment's note, for anyone holding the transaction id. A ref whose `txid` is not the 52
base32 characters of a 32-byte hash is `avm/wrong-reader`, with nothing read. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `algorand:${string}` ``; `txid`: `string`; \} |
| `ref.network` | `` `algorand:${string}` `` |
| `ref.txid` | `string` |
| `reader` | [`AvmReader`](#avmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### avmStatus()

> **avmStatus**(`ref`, `reader`): `Promise`\<[`AvmStatus`](#avmstatus)\>

Reads the payment by its id. Found is settled and final; absent after the last valid round is expired; otherwise
pending. A failed read, or a reader for another network, is pending. A ref whose `txid` is not the 52 base32
characters of a 32-byte hash, as `reference` writes it, or whose `lastValid` is not a decimal below 2^64, is pending
`unreadable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`AvmRef`](#avmref) |
| `reader` | [`AvmReader`](#avmreader) |

#### Returns

`Promise`\<[`AvmStatus`](#avmstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
