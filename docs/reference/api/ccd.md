---
title: "@integraledger/lcp/ccd"
description: "Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer event."
---

# @integraledger/lcp/ccd

Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo
of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer
event.

The signed transaction is read in x402's wire form, the JSON-serialized V1 sponsored transaction: with
`@concordium/web-sdk`, `JSON.parse(Transaction.toJSONString(tx))`. Any other value, such as the SDK's object
before serialization, whose header holds bigints, is `ccd/transaction-malformed`.

## Interfaces

### CcdReader

Bounded, read-only calls against one network's node (gRPC v2). Every failure rejects, for example with
`ReaderError` from `@integraledger/lcp/evm`: a `ReaderError` reads by its kind (`too-large` as `too-large`,
`malformed` as `unparseable`), and any other rejection as `transport`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `ccd:${string}` `` |

#### Methods

##### block()

> **block**(`height`): `Promise`\<\{ `slotTime`: `bigint`; \} \| `null`\>

`GetBlockInfo` at a finalized height: its `slot_time`, in milliseconds; null where the node does not hold it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |

###### Returns

`Promise`\<\{ `slotTime`: `bigint`; \} \| `null`\>

##### item()

> **item**(`hash`): `Promise`\<[`CcdItem`](#ccditem) \| `null`\>

`GetBlockItemStatus`; null when the node does not know the item.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<[`CcdItem`](#ccditem) \| `null`\>

##### items()

> **items**(`height`): `Promise`\<readonly [`CcdBlockItem`](#ccdblockitem)[]\>

`GetBlockItems` on a finalized height, every item of the block.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |

###### Returns

`Promise`\<readonly [`CcdBlockItem`](#ccdblockitem)[]\>

##### lastFinal()

> **lastFinal**(): `Promise`\<`bigint`\>

`GetConsensusInfo`'s last finalized block height.

###### Returns

`Promise`\<`bigint`\>

##### nextNonce()

> **nextNonce**(`account`, `at`): `Promise`\<`bigint` \| `null`\>

`GetAccountInfo(account, block).sequence_number`, the account's next sequence number, at a finalized height or at
the latest head (`best`); null where the node answers that it has no such account at that block, or no such block,
which the read tells apart with `block`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `at` | `bigint` \| `"best"` |

###### Returns

`Promise`\<`bigint` \| `null`\>

***

### CcdRef

The read keys `reference` returns: the network, H, the header's sender and its signed sequence number (a decimal
string), the signed `expiry` in seconds, the option's `payTo`, and the digest of what the sender signed. The caller
may add `transaction`, a hash a settler named, which the read takes as a hint.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-expiry"></a> `expiry` | `number` | - |
| <a id="property-h"></a> `h` | `` `0x${string}` `` | - |
| <a id="property-network-1"></a> `network` | `` `ccd:${string}` `` | - |
| <a id="property-nonce"></a> `nonce` | `string` | - |
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-sender"></a> `sender` | `string` | - |
| <a id="property-signed"></a> `signed` | `` `0x${string}` `` | SHA-256 over the members the sender signed (the profile's rule 14). |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

***

### CcdSearch

The search's position: the next of the sender's sequence numbers to locate.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-next"></a> `next` | `bigint` |

***

### CcdTransfer

One transfer an item's effects or events list: CCD, its amount in microCCD (concordium-grpc-api
`v2/concordium/types.proto` L328, `Amount`), or a PLT by its token id, its amount the `value` of the event's
`TokenAmount` and `decimals` that amount's own (`v2/concordium/protocol-level-tokens.proto` L43-50 at 30c79ca0).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` | - |
| <a id="property-decimals"></a> `decimals?` | `number` | A PLT's: the `decimals` of its `TokenAmount`. A CCD transfer gives none, microCCD being six. |
| <a id="property-kind"></a> `kind` | `"ccd"` \| `"plt"` | - |
| <a id="property-memo"></a> `memo` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` | - |
| <a id="property-receiver"></a> `receiver` | `Uint8Array` | - |
| <a id="property-tokenid"></a> `tokenId?` | `string` | - |

***

### CcdUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.amount` | `string` |
| `request.asset` | `string` |
| `request.expiresBy` | `number` |
| `request.kind` | `"ccd-transfer"` |
| `request.memo` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.network` | `` `ccd:${string}` `` |
| `request.sponsor` | `string` |
| `request.toAddress` | `string` |

#### Methods

##### complete()

> **complete**(`signedTransaction`): [`Refusal`](index.md#refusal) \| `CcdPaymentPayload`

Takes the sender-signed V1 sponsored transaction in x402's wire form: with `@concordium/web-sdk`,
`JSON.parse(Transaction.toJSONString(tx))`. A value that is not a JSON object is `ccd/transaction-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedTransaction` | `unknown` |

###### Returns

[`Refusal`](index.md#refusal) \| `CcdPaymentPayload`

## Type Aliases

### CcdBlockItem

> **CcdBlockItem** = \{ `energy`: `bigint`; `expiry`: `bigint`; `hash`: `string`; `nonce`: `bigint`; `payload`: `Uint8Array`; `sender`: `Uint8Array`; `sponsor`: `Uint8Array` \| `null`; \} \| \{ `hash`: `string`; `undecoded`: `true`; \}

One item of gRPC v2 `GetBlockItems` on a finalized block, as the reader gives it: an account transaction's hash, its
signed header (the sender's 32 bytes, its sequence number, `expiry` in seconds, the energy and, on a sponsored
transaction, the sponsor's 32 bytes) and its payload in the protocol's binary form, `raw_payload`, which lcp decodes;
or an item the reader cannot read as one, by its hash.

***

### CcdItem

> **CcdItem** = \{ `state`: `"received"`; \} \| \{ `height?`: `bigint`; `nonce?`: `bigint`; `sender`: `Uint8Array` \| `null`; `state`: `"committed"` \| `"finalized"`; `success`: `boolean`; `transfers`: readonly [`CcdTransfer`](#ccdtransfer)[]; `unknown?`: `boolean`; \}

An answer of gRPC v2 `GetBlockItemStatus` in the reader's form: received; or in a block, `committed` or `finalized`,
with its outcome: whether it succeeded, its sender, each transfer its effects or events list in their order, and
`unknown`, set where an effect or event kind is one the reader does not know (never read as "no transfer"). For an
item in a block the reader may add the height of the block that holds it and its header's sequence number, read
with `GetBlockInfo` and `GetBlockItems` on that block; `status` takes an item a hint names only with its height.

***

### CcdNetwork

> **CcdNetwork** = `` `ccd:${string}` ``

CAIP-2: `ccd:` and the first 32 lowercase hex digits of the genesis block hash.

***

### CcdStatus

> **CcdStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `CcdMark`, [`CcdSearch`](#ccdsearch)\>

The answer of `ccdStatus`. Positions are finalized block heights; the one mark is `finalized`, and an item read
above the last finalized block is at `committed`, below it; the search's position is `CcdSearch`.

## Variables

### CCD\_EXPIRY\_MARGIN

> `const` **CCD\_EXPIRY\_MARGIN**: `5` = `5`

The margin the stock client takes off an expiry, in seconds: it signs `now` plus `maxTimeoutSeconds` less this, so
that the stock facilitator, which refuses an expiry past its own clock plus `maxTimeoutSeconds`, takes the payment.

***

### CCD\_MAX\_ADDRESS

> `const` **CCD\_MAX\_ADDRESS**: `64` = `64`

lcp's own resource bound on an account address's text, in characters: a base58check account address is 50.

***

### CCD\_MAX\_MEMO

> `const` **CCD\_MAX\_MEMO**: `256` = `256`

The longest memo the chain takes, in bytes: Concordium's `Memo` holds at most 256.

***

### CCD\_MAX\_OPERATIONS

> `const` **CCD\_MAX\_OPERATIONS**: `4096` = `4096`

lcp's own resource bound on a PLT `tokenUpdate`'s operations, in bytes: one `transfer` operation with a memo at the
chain's bound is far below it.

***

### CCD\_MAX\_TRANSACTION

> `const` **CCD\_MAX\_TRANSACTION**: `16384` = `16384`

lcp's own resource bound on the presented signed transaction's canonical JSON, in bytes: one transfer with a memo
at the chain's bound and its signatures is far below it.

***

### CCD\_SEARCH\_NUMBERS

> `const` **CCD\_SEARCH\_NUMBERS**: `16` = `16`

lcp's own resource bound on one read: the search for H locates at most 16 of the sender's sequence numbers in one
call, and an answer that stops there carries the next number to locate, from which the next call resumes.

***

### exactCcd

> `const` **exactCcd**: `Readonly`\<\{ `advertise`: `X402Advertise`; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdUnsigned`](#ccdunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/ccd"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdRef`](#ccdref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CcdStatus`](#ccdstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/ccd`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the sponsor,
signs and submits the sponsored transaction the payer signed; `status` reads the finalized transfer.

## Functions

### accountBytes()

> **accountBytes**(`address`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The 32 bytes of a base58check account address whose version byte is 1: its last four bytes are the first four of
the double SHA-256 of the 33 before them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### ccdMemo()

> **ccdMemo**(`h`): `Uint8Array`\<`ArrayBuffer`\>

The CBOR text string of `toLcpString(h)`: `78 4d` and the 77 ASCII bytes. Throws TypeError when `h` is not a 32-byte
hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### ccdRecover()

> **ccdRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from a settlement block item alone, when it is finalized and successful: the memo of its one transfer whose
memo `memoCarrier` reads (a PLT memo with tag 24 unwrapped), as `status` counts the transfers whose memo carries
`ref.h`. A transfer without a memo, or whose memo `memoCarrier` refuses, is passed over; no such transfer, or more
than one, is `ccd/no-carrier`. An input whose `tx` is not 64 hex digits, or whose option is not an object, is
`ccd/wrong-reader`, with nothing read; the option is not read further.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `ccd:${string}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`CcdReader`](#ccdreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### ccdStatus()

> **ccdStatus**(`ref`, `reader`, `query`): `Promise`\<[`CcdStatus`](#ccdstatus)\>

The read of the act asked about, as the profiles `read-status` and `x402/exact/ccd` answer it: by the sender's signed
sequence number, the item that consumed it, and the search for H over the sender's numbers (the profile's rules 8 to
15). A hash the reference names is a hint.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CcdRef`](#ccdref) |
| `reader` | [`CcdReader`](#ccdreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`CcdRef`](#ccdref), `bigint`, `"finalized"`, [`CcdSearch`](#ccdsearch)\> |

#### Returns

`Promise`\<[`CcdStatus`](#ccdstatus)\>

***

### memoCarrier()

> **memoCarrier**(`memo`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The hash a memo carries: exactly one CBOR text string, nothing after it, whose bytes are `ccdMemo` of the hash it
names (LCP's string form with lowercase hex, under the preferred two-byte head). `bound`, `status` and `recover` all
read a memo through this one function.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `memo` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### pltMemo()

> **pltMemo**(`h`): `Uint8Array`\<`ArrayBuffer`\>

CBOR tag 24 around a byte string holding `ccdMemo(h)`: `d8 18 58 4f` and the 79 bytes. Throws as `ccdMemo` does.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
