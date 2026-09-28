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

A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-aborted"></a> `aborted` | `boolean` |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-finality"></a> `finality` | `0` \| `1` \| `2` |
| <a id="property-hash"></a> `hash` | `string` |
| <a id="property-inbody"></a> `inBody` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` |
| <a id="property-outmsgs"></a> `outMsgs` | readonly `object`[] |

***

### TvmChoice

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-attachnanotons"></a> `attachNanotons` | `bigint` | The value attached to the outgoing message, above `forwardTonAmount`. |
| <a id="property-jettonwallet"></a> `jettonWallet` | `string` | The payer's Jetton wallet for `asset`, raw (`get_wallet_address` on the master). |
| <a id="property-now"></a> `now` | `number` | Seconds since the epoch. |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |
| <a id="property-seqno"></a> `seqno` | `number` | - |
| <a id="property-stateinit"></a> `stateInit?` | `string` \| [`TonCell`](#toncell) | The wallet's state init, for a wallet not yet deployed: a cell, or a base64 BoC of one root cell. |
| <a id="property-wallet"></a> `wallet` | `string` | The payer's W5 wallet, raw. |
| <a id="property-walletid"></a> `walletId` | `number` | `get_subwallet_id`. |

***

### TvmReader

Bounded, read-only calls against one network's TON Center v3 endpoint. Every failure rejects with `ReaderError`.

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

GET /api/v3/transactionsByMessage?body_hash=…&direction=in

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

GET /api/v3/masterchainInfo: the last indexed block's gen_utime.

###### Returns

`Promise`\<`number`\>

***

### TvmRef

The read keys recorded at claim.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-jettonwallet-1"></a> `jettonWallet` | `string` | The payer's Jetton wallet, raw: the destination of the W5 request's one message. |
| <a id="property-network-1"></a> `network` | `` `tvm:${number}` `` | - |
| <a id="property-requestbodyhash"></a> `requestBodyHash` | `` `0x${string}` `` | The representation hash of the signed W5 request: the body of the message to the payer's wallet. |
| <a id="property-transferbodyhash"></a> `transferBodyHash` | `` `0x${string}` `` | The representation hash of the Jetton transfer body the W5 request sends. |
| <a id="property-validuntil"></a> `validUntil` | `number` | - |
| <a id="property-wallet-1"></a> `wallet` | `string` | The payer's W5 wallet, raw: the destination of the settlement message. |

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

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`TvmPayment`](#tvmpayment)

Takes the 64-byte Ed25519 signature.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`TvmPayment`](#tvmpayment)

## Type Aliases

### TvmNetwork

> **TvmNetwork** = `` `tvm:${number}` ``

tvm:<global_id>: tvm:-239 mainnet, tvm:-3 testnet.

***

### TvmPayment

> **TvmPayment** = [`X402Payment`](x402.md#x402payment)\<\{ `asset`: `string`; `settlementBoc`: `string`; \}\>

***

### TvmStatus

> **TvmStatus** = \{ `finality`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"in-flight"` \| `"not-final"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"aborted"` \| `"no-transfer"` \| `"bounced"` \| `"expired"`; \}

## Variables

### exactTvm

> `const` **exactTvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmUnsigned`](#tvmunsigned)\>; `carrier`: `"extra.forwardPayload"`; `claims`: `boolean`; `id`: `"x402/exact/tvm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TvmRef`](#tvmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`TvmStatus`](#tvmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `txId`: (`tx`) => `string`; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/tvm"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/tvm"` \| `undefined`

***

### tvmCarrier()

> **tvmCarrier**(`settlementBoc`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

Reads the signed request in a settlement BoC: an internal message whose body is a W5 `internal_signed` request with
exactly one `action_send_msg` behind an empty list, carrying a Jetton transfer whose forward payload is a reference
to a text comment holding an LCP string.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `settlementBoc` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `jettonWallet`: `string`; `payload`: [`TonCell`](#toncell); `requestBodyHash`: `` `0x${string}` ``; `transferBodyHash`: `` `0x${string}` ``; `validUntil`: `number`; `wallet`: `string`; \}

***

### tvmRecover()

> **tvmRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. One call.

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

Reads the head's time first. Then finds the transfer by its body hash on the payer's Jetton wallet and follows its
`internal_transfer` to the payee's Jetton wallet: settled when both executed without aborting, at the lower
finality of the two. When the Jetton wallet holds no such transaction, finds the signed request by its body hash on
the payer's W5 wallet: a W5 transaction that emitted the Jetton transfer is pending `in-flight`, because an internal
message carries no expiry. W5 refuses the request once `valid_until <= now()`, so only a head read first and past
`validUntil` answers failed: `expired` when the W5 wallet holds no such transaction, `no-transfer` when one executed
and emitted nothing, `aborted` when every one aborted. A transaction on any other account is ignored. A failed or
malformed read, a malformed reference, or a reader for another network is pending `unreadable`. At most three calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`TvmRef`](#tvmref) |
| `reader` | [`TvmReader`](#tvmreader) |

#### Returns

`Promise`\<[`TvmStatus`](#tvmstatus)\>

***

### tvmTxId()

> **tvmTxId**(`tx`): `string`

A TON transaction hash in one spelling: lowercase hex without `0x` (x402's TON scheme gives `transaction` as
"Transaction hash (64-character hex string)"), whether it is given in hex, or in the base64 or base64url of its 32
bytes that TON Center answers. Any other string is returned unchanged.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `string` |

#### Returns

`string`
