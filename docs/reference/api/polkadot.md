---
title: "@integraledger/lcp/polkadot"
description: "The exports of @integraledger/lcp/polkadot."
---

# @integraledger/lcp/polkadot

## Interfaces

### PolkadotExtrinsic

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-at"></a> `at` | `object` |
| `at.hash` | `` `0x${string}` `` |
| `at.height` | `bigint` |
| <a id="property-events"></a> `events` | readonly `object`[] |
| <a id="property-hash"></a> `hash` | `` `0x${string}` `` |
| <a id="property-success"></a> `success` | `boolean` |

***

### PolkadotReader

Bounded, read-only calls against one network's Sidecar. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`PolkadotNetwork`](#polkadotnetwork) |

#### Methods

##### extrinsic()

> **extrinsic**(`block`, `index`): `Promise`\<[`PolkadotExtrinsic`](#polkadotextrinsic) \| `null`\>

`GET /blocks/{block}/extrinsics/{index}`; null when the block or extrinsic does not exist.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `block` | `bigint` \| `` `0x${string}` `` |
| `index` | `number` |

###### Returns

`Promise`\<[`PolkadotExtrinsic`](#polkadotextrinsic) \| `null`\>

##### finalizedHeight()

> **finalizedHeight**(): `Promise`\<`bigint`\>

`GET /blocks/head/header` → number: the most recently finalized height.

###### Returns

`Promise`\<`bigint`\>

##### rawExtrinsics()

> **rawExtrinsics**(`block`): `Promise`\<readonly `` `0x${string}` ``[] \| `null`\>

`GET /blocks/{block}/extrinsics-raw`; null when the block does not exist.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `block` | `bigint` \| `` `0x${string}` `` |

###### Returns

`Promise`\<readonly `` `0x${string}` ``[] \| `null`\>

***

### PolkadotRef

The read keys recorded at claim, computed from the signed bytes.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-assetid"></a> `assetId` | `number` |
| <a id="property-extrinsichash"></a> `extrinsicHash` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | [`PolkadotNetwork`](#polkadotnetwork) |

***

### PolkadotUnsigned

The call the payer's signer wraps in an extrinsic, and how that extrinsic completes the payment.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.call` | `Uint8Array` |
| `request.kind` | `"substrate-call"` |
| `request.network` | [`PolkadotNetwork`](#polkadotnetwork) |

#### Methods

##### complete()

> **complete**(`extrinsic`): [`Refusal`](index.md#refusal) \| [`PolkadotPaymentPayload`](#polkadotpaymentpayload)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `extrinsic` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`PolkadotPaymentPayload`](#polkadotpaymentpayload)

***

### ProfileCall

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-assetid-1"></a> `assetId` | `number` |
| <a id="property-dest"></a> `dest` | `Uint8Array` |
| <a id="property-remark"></a> `remark` | `Uint8Array` |

## Type Aliases

### PolkadotNetwork

> **PolkadotNetwork** = `"polkadot:68d56f15f85d3136970ec16946040bc1"` \| `"polkadot:67f9723393ef76214df0118c34bbbd3d"`

***

### PolkadotPayload

> **PolkadotPayload** = `object`

The x402 payload: the signed extrinsic and its call, lowercase hex.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-call"></a> `call` | [`Hex`](evm.md#hex) |
| <a id="property-extrinsic"></a> `extrinsic` | [`Hex`](evm.md#hex) |

***

### PolkadotPaymentPayload

> **PolkadotPaymentPayload** = [`X402Payment`](x402.md#x402payment)\<[`PolkadotPayload`](#polkadotpayload)\>

***

### PolkadotStatus

> **PolkadotStatus** = \{ `finality`: `"finalized"` \| `"head"`; `height`: `bigint`; `state`: `"settled"`; `transaction`: `string`; \} \| \{ `state`: `"pending"`; `why`: `"not-located"` \| `"not-found"` \| `"unreadable"`; \} \| \{ `finality`: `"finalized"` \| `"head"`; `height`: `bigint`; `state`: `"failed"`; `transaction`: `string`; `why`: `"not-this-extrinsic"` \| `"dispatch-failed"` \| `"no-remark"` \| `"no-transfer"`; \}

A settlement or failure names the timepoint it read, `<block hash>-<index>`: the one given, or the canonical one when
the given block left the chain and the canonical block at that height holds the same extrinsic at that index.
Pending `not-located` asks for the payment to be located from the claim position.

## Variables

### CALL

> `const` **CALL**: `Readonly`\<\{ `batchAll`: readonly `number`[]; `remarkWithEvent`: readonly `number`[]; `transferKeepAlive`: readonly `number`[]; \}\>

Pallet and call indices, the same on both networks.

***

### exactPolkadotRemark

> `const` **exactPolkadotRemark**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`PolkadotUnsigned`](#polkadotunsigned)\>; `carrier`: `null`; `claims`: `true`; `id`: `"x402/exact/polkadot/lcp-assets-remark"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`PolkadotRef`](#polkadotref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`PolkadotStatus`](#polkadotstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### LCP\_ASSETS\_REMARK

> `const` **LCP\_ASSETS\_REMARK**: `"lcp-assets-remark"` = `"lcp-assets-remark"`

The profile's `assetTransferMethod`.

***

### POLKADOT\_NETWORKS

> `const` **POLKADOT\_NETWORKS**: readonly [`PolkadotNetwork`](#polkadotnetwork)[]

## Functions

### decodeProfileCall()

> **decodeProfileCall**(`call`): [`Refusal`](index.md#refusal) \| [`ProfileCall`](#profilecall)

The profile's call, exactly, with canonical compacts and no trailing byte.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `call` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| [`ProfileCall`](#profilecall)

***

### encodeProfileCall()

> **encodeProfileCall**(`c`): `Uint8Array`

`batch_all([transfer_keep_alive(assetId, Id(dest), amount), remark_with_event(remark)])`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`ProfileCall`](#profilecall) |

#### Returns

`Uint8Array`

***

### extrinsicHash()

> **extrinsicHash**(`xt`): `` `0x${string}` ``

BLAKE2b-256 of the extrinsic's bytes, its length prefix included.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xt` | `Uint8Array` |

#### Returns

`` `0x${string}` ``

***

### polkadotLocate()

> **polkadotLocate**(`ref`, `reader`, `from`, `to`): `Promise`\<`string` \| [`Refusal`](index.md#refusal) \| `null`\>

Finds a payment nobody named, by hashing every extrinsic of each block from `from` to `to` (at most 256 blocks).
The first match gives its timepoint; a block that does not exist ends the scan with null.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`PolkadotRef`](#polkadotref) |
| `reader` | [`PolkadotReader`](#polkadotreader) |
| `from` | `bigint` |
| `to` | `bigint` |

#### Returns

`Promise`\<`string` \| [`Refusal`](index.md#refusal) \| `null`\>

***

### polkadotPairingOf()

> **polkadotPairingOf**(`o`): `"x402/exact/polkadot/lcp-assets-remark"` \| `undefined`

The pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/polkadot/lcp-assets-remark"` \| `undefined`

***

### polkadotRecover()

> **polkadotRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

The hash from the landed extrinsic alone, for anyone holding its timepoint: its raw bytes end with the remark call,
and the chain's record of it has the same hash, dispatched, with the `Remarked` event. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: [`PolkadotNetwork`](#polkadotnetwork); `transaction`: `string`; \} |
| `ref.network` | [`PolkadotNetwork`](#polkadotnetwork) |
| `ref.transaction` | `string` |
| `reader` | [`PolkadotReader`](#polkadotreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### polkadotStatus()

> **polkadotStatus**(`ref`, `reader`): `Promise`\<[`PolkadotStatus`](#polkadotstatus)\>

Reads the extrinsic at its timepoint `<block hash>-<index>`. It must have the recorded hash, have dispatched, and
carry the `Remarked` event for this hash's remark and a `Transferred` event of the recorded asset. A settlement and a
failure alike carry the finality of the read: `finalized` when the finalized chain holds that block, `head` when it
is above the finalized height. When the finalized chain holds another block at that height, the extrinsic at the
same index of the canonical block is read instead if its hash is the recorded one; otherwise the answer is pending
`not-located`. A block the reader does not have is pending `not-found`. A failed read, a bare broadcast hash or a
reader for another network is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`PolkadotRef`](#polkadotref) & `object` |
| `reader` | [`PolkadotReader`](#polkadotreader) |

#### Returns

`Promise`\<[`PolkadotStatus`](#polkadotstatus)\>

***

### splitSigned()

> **splitSigned**(`xt`): [`Refusal`](index.md#refusal) \| \{ `end`: `number`; `signer`: `Uint8Array`; \}

The preamble of a signed v4 extrinsic: the length prefix, `0x84`, `MultiAddress::Id` and a `MultiSignature`. Gives
the signer and the index after the signature; the extension bytes that follow are not decoded.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xt` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `end`: `number`; `signer`: `Uint8Array`; \}

***

### ss58Decode()

> **ss58Decode**(`address`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

A simple-format SS58 address: one prefix byte 0–63, a 32-byte account, and a two-byte checksum.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)
