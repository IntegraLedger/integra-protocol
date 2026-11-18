---
title: "@integraledger/lcp/polkadot"
description: "Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one extrinsic that transfers an asset and remarks the ATR hash's LCP string."
---

# @integraledger/lcp/polkadot

Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one
extrinsic that transfers an asset and remarks the ATR hash's LCP string.

Its call is `utility.batch_all([assets.transfer_keep_alive, system.remark_with_event])`, the remark the hash's LCP
string; the settlement is read by the signer's account nonce through polkadot-rest-api. SCALE is encoded and decoded
here for these shapes only.

## Interfaces

### PolkadotCursor

The search's position, which a `pending` answer returns while the search has range left and the next call takes:
the next block to read, never above the finalized height's next, and the timepoints the search met at or below the
finalized height, which the next call reads again.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-hits"></a> `hits` | `readonly` | readonly `string`[] | - |
| <a id="property-next"></a> `next` | `readonly` | `bigint` | - |
| <a id="property-validated"></a> `validated?` | `readonly` | `bigint` | The head at which the chain's validation of the presented extrinsic answered valid, which proves the era's last block; kept in the position so that the next call takes it back. |

***

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

Bounded, read-only calls against one network's `polkadot-rest-api`, and its declared `json-rpc` side endpoint for the
validation of a presented extrinsic. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`PolkadotNetwork`](#polkadotnetwork) |

#### Methods

##### accountNonce()

> **accountNonce**(`account`, `at`): `Promise`\<`bigint`\>

`GET /accounts/{account}/balance-info?at=` → nonce: the account's nonce at the finalized block, or at the head.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `` `0x${string}` `` |
| `at` | `"head"` \| `"finalized"` |

###### Returns

`Promise`\<`bigint`\>

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

##### headHeight()

> **headHeight**(): `Promise`\<`bigint`\>

`GET /blocks/head/header?finalized=false` → number: the latest head the endpoint serves.

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

##### validate()

> **validate**(`extrinsic`): `Promise`\<\{ `head`: `bigint`; `valid`: `boolean`; \}\>

`TaggedTransactionQueue_validate_transaction` of the extrinsic at the best block, through the `json-rpc` endpoint:
whether it answered valid, and the height of the block the call ran at, `state_call`'s `at`, pinned before the call,
never a head read apart from it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `extrinsic` | `` `0x${string}` `` |

###### Returns

`Promise`\<\{ `head`: `bigint`; `valid`: `boolean`; \}\>

***

### PolkadotRef

The read keys of the presented extrinsic, from its signed bytes: the signer's 32-byte account, the account nonce and
the era it signed, and the extrinsic itself, which the read validates and compares with what landed; with the
accepted option's network and the payee, the `payTo` of the option the payment answers, the key of the two party
tests and no search key.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-era"></a> `era` | [`PolkadotEra`](#polkadotera) |
| <a id="property-extrinsic"></a> `extrinsic` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | [`PolkadotNetwork`](#polkadotnetwork) |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-signer"></a> `signer` | `` `0x${string}` `` |

***

### PolkadotUnsigned

The call the payer's signer wraps in an extrinsic, and how that extrinsic completes the payment.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.call` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.kind` | `"substrate-call"` |
| `request.network` | [`PolkadotNetwork`](#polkadotnetwork) |

#### Methods

##### complete()

> **complete**(`extrinsic`): [`Refusal`](index.md#refusal) \| `PolkadotPaymentPayload`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `extrinsic` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `PolkadotPaymentPayload`

***

### ProfileCall

The profile's call. `B` is what its bytes are backed by: `decodeProfileCall` gives `ProfileCall<ArrayBuffer>`, each
byte field in its own fresh `ArrayBuffer`, and `encodeProfileCall` takes any backing.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-assetid"></a> `assetId` | `number` |
| <a id="property-dest"></a> `dest` | `Uint8Array`\<`B`\> |
| <a id="property-remark"></a> `remark` | `Uint8Array`\<`B`\> |

## Type Aliases

### PolkadotEra

> **PolkadotEra** = \{ `period`: `number`; `phase`: `number`; \} \| `"immortal"`

A signed extrinsic's era: mortal, with its period and phase, or immortal.

***

### PolkadotLanded

> **PolkadotLanded** = [`PolkadotRef`](#polkadotref) & `object`

The reference with what the caller adds: H, and the timepoint a settler named, a hint.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `h` | [`AtrHash`](index.md#atrhash) |
| `transaction?` | `string` |

***

### PolkadotNetwork

> **PolkadotNetwork** = `"polkadot:68d56f15f85d3136970ec16946040bc1"` \| `"polkadot:67f9723393ef76214df0118c34bbbd3d"`

***

### PolkadotQuery

> **PolkadotQuery** = [`StatusQuery`](index.md#statusquery)\<[`PolkadotLanded`](#polkadotlanded), `bigint`, `PolkadotMark`, [`PolkadotCursor`](#polkadotcursor)\>

What `polkadotStatus` takes beside the reference and the reader: the profile `read-status`'s query.

***

### PolkadotStatus

> **PolkadotStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `PolkadotMark`, [`PolkadotCursor`](#polkadotcursor)\>

The answer of `polkadotStatus`, as the profile `read-status` gives it. Its marks are `head` and `finalized`, in that
order, and its position the block height. A transaction is named by its timepoint, `<block hash>-<index>`. A
`settled` answer states `presented`: `yes` where the landed extrinsic's signed body, its signature apart, is the
presented one's, `no` where it is not. Each transfer of what moved is named by the timepoint and its place: the
event's index among the extrinsic's events, or, for a transfer call of zero, which emits no event, `call` and the
index of each call on the path from the extrinsic's own call down to it (`call 0` for the profile's own). Its
`signer` is the extrinsic's signer, and its `authority` the wrapper it acted through for the payer, `proxy.proxy` or
`multisig.as_multi_threshold_1`, absent where it signed as the payer. A `pending` answer that holds the head at which the chain's validation of the presented
extrinsic answered valid keeps it in its search position, `validated`, for the next call.

## Variables

### CALL

> `const` **CALL**: `Readonly`\<\{ `batchAll`: readonly `number`[]; `remarkWithEvent`: readonly `number`[]; `transferKeepAlive`: readonly `number`[]; \}\>

Pallet and call indices, the same on both networks.

***

### exactPolkadotRemark

> `const` **exactPolkadotRemark**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`PolkadotUnsigned`](#polkadotunsigned)\>; `claims`: `true`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/polkadot/lcp-assets-remark"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`PolkadotRef`](#polkadotref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`PolkadotStatus`](#polkadotstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/polkadot/lcp-assets-remark`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
facilitator submits the extrinsic the payer signed and names where it landed; `status` reads it by the signer's
account nonce, the timepoint the facilitator named being a hint.

***

### LCP\_ASSETS\_REMARK

> `const` **LCP\_ASSETS\_REMARK**: `"lcp-assets-remark"` = `"lcp-assets-remark"`

The profile's `assetTransferMethod`.

***

### POLKADOT\_BOUNDS

> `const` **POLKADOT\_BOUNDS**: `Readonly`\<\{ `blockHashCount`: `4096`; `call`: `141`; `extrinsic`: `4096`; `remark`: `77`; `searchBlocks`: `64`; \}\>

The pairing's bounds, each lcp's own or the chain's, with its reason. `extrinsic`: lcp's bound on a signed extrinsic's
bytes, length prefix included, which the profile's extrinsic fits many times over and which bounds what is decoded.
`remark`: the 77 ASCII bytes `lcp:sha256:` and H. `call`: the longest profile call, both compacts in their widest
form, a `u32` asset id and a `u128` amount. `blockHashCount`: the chain's `BlockHashCount`, the number of block hashes
an extrinsic's era can name (the profile's rule 7). `searchBlocks`: lcp's resource bound, the blocks one call of
`polkadotStatus` reads of its search, so that each call's reads are bounded; the next call takes the search's
position. The search holds the signer's own items alone to `extrinsic`.

## Functions

### decodeProfileCall()

> **decodeProfileCall**(`call`): [`Refusal`](index.md#refusal) \| [`ProfileCall`](#profilecall)\<`ArrayBuffer`\>

The profile's call, exactly, with canonical compacts and no trailing byte. Its bytes are copies of `call`'s.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `call` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| [`ProfileCall`](#profilecall)\<`ArrayBuffer`\>

***

### encodeProfileCall()

> **encodeProfileCall**(`c`): `Uint8Array`\<`ArrayBuffer`\>

`batch_all([transfer_keep_alive(assetId, Id(dest), amount), remark_with_event(remark)])`, the inverse of
`decodeProfileCall`. Throws TypeError on a call that `decodeProfileCall` never gives: `assetId` must be an integer
from 0 to 2^32 − 1, `dest` 32 bytes, `amount` a bigint from 0 to 2^128 − 1, and `remark` 77 bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`ProfileCall`](#profilecall) |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### extrinsicHash()

> **extrinsicHash**(`xt`): `` `0x${string}` ``

BLAKE2b-256 of the extrinsic's bytes, its length prefix included. Throws TypeError when `xt` is not a
`Uint8Array`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xt` | `Uint8Array` |

#### Returns

`` `0x${string}` ``

***

### polkadotRecover()

> **polkadotRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from the landed extrinsic alone, for anyone holding its timepoint. It reads the block's raw extrinsics, then
the chain's record of the extrinsic at the index, and ties the two before anything else: the raw bytes' BLAKE2b-256
must be the record's hash. A block or a record the reader does not have is `polkadot/not-found`, and a block whose
extrinsics hold no entry at the index is `polkadot/not-located`. Extrinsics that are not an array, an entry that is
not a hex string, a record that is not an extrinsic's, or raw bytes whose hash is not the record's are
`polkadot/unreadable`. The bytes so tied must end with the profile call, after the signature, whose remark is the
hash's LCP string with lowercase hex. The record read is then chosen as `polkadotStatus` chooses it, and a named
block that the finalized chain does not hold, with no copy of the extrinsic at that index of the canonical block at
its height, is `polkadot/not-located`. That record must show the extrinsic dispatched with the `Remarked` event for
the remark, whatever it moved: one that does not is `polkadot/no-remark` once the finalized chain holds its block, and
`polkadot/not-final` while the block is above the finalized height, since that block can be replaced. The input's `tx` is the timepoint, and its `option` the option
the payment answers, an object, of which the read needs no member. An input whose `tx` is not a
`<block hash>-<index>` timepoint, or whose option is not an object, is `polkadot/wrong-reader`, with nothing read. At
most four calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`PolkadotNetwork`](#polkadotnetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`PolkadotReader`](#polkadotreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### polkadotStatus()

> **polkadotStatus**(`ref`, `reader`, `query`): `Promise`\<[`PolkadotStatus`](#polkadotstatus)\>

Answers the read of the act the query asks about as the profile `read-status` gives it, by the pairing's profile, rule
8: the payment is read by the signer's account nonce, never by the extrinsic's hash. The read takes the finalized
height, the latest head, and the account's nonce at each; then reads the timepoint a settler named, the hint, and the
search's earlier finds; then searches every block after the position the caller gave up to the latest head, at most
`POLKADOT_BOUNDS.searchBlocks` blocks a call, decoding each item's preamble: the signer's extrinsic at the signed nonce
is the instrument's, and every extrinsic whose bytes hold the remark of H is read for the search for H. An extrinsic
meets the profile's success where it dispatched (`success`) with `Remarked` for the remark; on the act `payment` it
names the payee's account where a transfer it made reaches `payTo`'s 32-byte account. The era's last block is proven
only by the chain's validation of the presented extrinsic answering valid, at the head it names (the search
position's `validated`), and
the lapse is the finalized height past it with the account nonce not past the signed one. A ref, a reader or a query
that is not one is unreadable `unparseable`, with nothing read; a reader for another network `chain-mismatch`; a read
that rejects `transport`; a block of the range at or below the finalized height that the endpoint does not hold
`history-gap`; an item of the signer's over `POLKADOT_BOUNDS.extrinsic` bytes `too-large`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`PolkadotLanded`](#polkadotlanded) |
| `reader` | [`PolkadotReader`](#polkadotreader) |
| `query` | [`PolkadotQuery`](#polkadotquery) |

#### Returns

`Promise`\<[`PolkadotStatus`](#polkadotstatus)\>

***

### splitSigned()

> **splitSigned**(`xt`): [`Refusal`](index.md#refusal) \| \{ `end`: `number`; `signer`: `Uint8Array`\<`ArrayBuffer`\>; \}

The preamble of a signed v4 extrinsic: the length prefix, `0x84`, `MultiAddress::Id` and a `MultiSignature`. Gives
the signer, a copy, and the index after the signature; the extension bytes that follow are not decoded.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xt` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `end`: `number`; `signer`: `Uint8Array`\<`ArrayBuffer`\>; \}

***

### ss58Decode()

> **ss58Decode**(`address`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

A simple-format SS58 address: one prefix byte 0–63, a 32-byte account, and a two-byte checksum.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
