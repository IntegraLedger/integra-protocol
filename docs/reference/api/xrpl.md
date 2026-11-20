---
title: "@integraledger/lcp/xrpl"
description: "XRP Ledger rail pieces: the signed blob, its `InvoiceID` or memo carrying the ATR hash in each scheme's form, the transaction hash computed from the blob, the reads of a payment, an opening, a channel and a close through a bounded reader, and the payment channel's id and claim."
---

# @integraledger/lcp/xrpl

XRP Ledger rail pieces: the signed blob, its `InvoiceID` or memo carrying the ATR hash in each scheme's form, the
transaction hash computed from the blob, the reads of a payment, an opening, a channel and a close through a
bounded reader, and the payment channel's id and claim.

## Interfaces

### XrplChannelEntry

A `PayChannel` ledger entry.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-account"></a> `account` | `readonly` | `string` |
| <a id="property-amount"></a> `amount` | `readonly` | `string` |
| <a id="property-destination"></a> `destination` | `readonly` | `string` |

***

### XrplChannelRef

The read keys of a channel at coverage `none`: the network, the channel the presented payment names, in upper case,
the payer it names, the option's payee, and the ledger index the create must come after, which is the caller's.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | `string` |
| <a id="property-fromledger"></a> `fromLedger` | `number` |
| <a id="property-network"></a> `network` | `` `xrpl:${number}` `` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-payer"></a> `payer` | `string` |

***

### XrplLanded

A transaction as the server answers it: its signed blob and what its metadata shows.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-blob"></a> `blob` | `readonly` | `string` | The signed transaction, hex (`tx_blob`); an inner `Batch` transaction's own serialization. |
| <a id="property-createdchannels"></a> `createdChannels?` | `readonly` | readonly `string`[] | The ids of the `PayChannel` entries the metadata creates. |
| <a id="property-deletedchannels"></a> `deletedChannels?` | `readonly` | readonly `string`[] | The ids of the `PayChannel` entries the metadata deletes. |
| <a id="property-delivered"></a> `delivered?` | `readonly` | [`XrplAmount`](#xrplamount) | `meta.delivered_amount` where the metadata gives one: drops, or an issued or MPT amount. |
| <a id="property-hash"></a> `hash` | `readonly` | `string` | The transaction's hash, 64 hex digits, as the server names it. |
| <a id="property-ledgerindex"></a> `ledgerIndex?` | `readonly` | `number` | The index of the ledger that holds it; absent where the server names none. |
| <a id="property-parent"></a> `parent?` | `readonly` | `string` | For an inner `Batch` transaction, the hash of the `Batch` that holds it (`meta.ParentBatchID`). |
| <a id="property-result"></a> `result` | `readonly` | `string` | `meta.TransactionResult`. |
| <a id="property-validated"></a> `validated` | `readonly` | `boolean` | Whether the ledger that holds it is validated. |

***

### XrplPage

One page of `account_tx`, forward, in binary form: the transactions, the ledgers it covered, and its marker.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-marker"></a> `marker?` | `readonly` | `unknown` | `marker`, where more of the range is left to read. |
| <a id="property-max"></a> `max` | `readonly` | `number` | - |
| <a id="property-min"></a> `min` | `readonly` | `number` | `ledger_index_min` and `ledger_index_max` as the server answers them: the ledgers the page's search covered. |
| <a id="property-transactions"></a> `transactions` | `readonly` | readonly [`XrplLanded`](#xrpllanded)[] | - |

***

### XrplReader

Bounded, read-only calls against one network's server. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable. A call the server refuses because it names ledgers the
server does not hold, as rippled on API version 2 refuses `account_tx` from a ledger below those it holds with
`lgrIdxMalformed`, rejects with `ReaderError` of kind `history`, which reads as `history-gap`. A call that names a
ledger answers with the index of the ledger it read.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | `readonly` | `` `xrpl:${number}` `` |

#### Methods

##### accountInfo()

> **accountInfo**(`account`, `ledger`): `Promise`\<\{ `ledgerIndex`: `number`; `sequence`: `number`; \} \| \{ `ledgerIndex`: `number`; `notFound`: `true`; \}\>

`account_info` at the ledger named: the account's `Sequence`, or no such account (`actNotFound`).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `ledger` | [`XrplLedgerName`](#xrplledgername) |

###### Returns

`Promise`\<\{ `ledgerIndex`: `number`; `sequence`: `number`; \} \| \{ `ledgerIndex`: `number`; `notFound`: `true`; \}\>

##### accountTx()

> **accountTx**(`account`, `range`, `marker?`): `Promise`\<[`XrplPage`](#xrplpage)\>

`account_tx` for `account`, forward, binary, over the range, resuming at `marker`: one page.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `range` | \{ `max`: `number`; `min`: `number`; \} |
| `range.max` | `number` |
| `range.min?` | `number` |
| `marker?` | `unknown` |

###### Returns

`Promise`\<[`XrplPage`](#xrplpage)\>

##### channel()

> **channel**(`id`, `ledger`): `Promise`\<[`XrplChannelEntry`](#xrplchannelentry) \| \{ `ledgerIndex`: `number`; `notFound`: `true`; \}\>

`ledger_entry` of a `PayChannel` at the ledger named, or no such entry (`entryNotFound`).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `ledger` | [`XrplLedgerName`](#xrplledgername) |

###### Returns

`Promise`\<[`XrplChannelEntry`](#xrplchannelentry) \| \{ `ledgerIndex`: `number`; `notFound`: `true`; \}\>

##### server()

> **server**(): `Promise`\<[`XrplServer`](#xrplserver)\>

`server_info`.

###### Returns

`Promise`\<[`XrplServer`](#xrplserver)\>

##### ticket()

> **ticket**(`account`, `ticketSequence`, `ledger`): `Promise`\<\{ `ledgerIndex`: `number`; `present`: `boolean`; \}\>

`ledger_entry` of the account's `Ticket` at the ledger named: whether it is present.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `ticketSequence` | `number` |
| `ledger` | [`XrplLedgerName`](#xrplledgername) |

###### Returns

`Promise`\<\{ `ledgerIndex`: `number`; `present`: `boolean`; \}\>

##### tx()

> **tx**(`hash`, `range`): `Promise`\<[`XrplLanded`](#xrpllanded) \| \{ `notFound`: `true`; `searchedAll`: `boolean`; \}\>

`tx` by hash, with `min_ledger` and `max_ledger` where a range is given: the transaction, or not found.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |
| `range` | \{ `max`: `number`; `min`: `number`; \} \| `null` |

###### Returns

`Promise`\<[`XrplLanded`](#xrpllanded) \| \{ `notFound`: `true`; `searchedAll`: `boolean`; \}\>

***

### XrplRef

The read keys `reference` returns: the network; the presented transaction's hash, a way to look and never the
identity; H; the option's payee, which `reference` takes from the option the payment answers; and, where the
payment presents its blob, the payer's instrument and signed body. `fromLedger`, the ledger index the search starts
from, the issue ledger, is the caller's.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-fromledger-1"></a> `fromLedger` | `number` |
| <a id="property-h"></a> `h` | `` `0x${string}` `` |
| <a id="property-network-2"></a> `network` | `` `xrpl:${number}` `` |
| <a id="property-payee-1"></a> `payee` | `string` |
| <a id="property-signed"></a> `signed?` | [`XrplSigned`](#xrplsigned) |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### XrplServer

What `server_info` states: the ledgers the server holds and serves, and the network it serves.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-completeledgers"></a> `completeLedgers` | `readonly` | `string` | `complete_ledgers`, as the server writes it: `"empty"`, or ranges `a-b` and single indexes joined by commas. |
| <a id="property-latest"></a> `latest` | `readonly` | `number` | The index of the latest ledger the server serves at the read, validated or not, to which a search reads. |
| <a id="property-networkid"></a> `networkId?` | `readonly` | `number` | `network_id`, where the server states one. |
| <a id="property-validated-1"></a> `validated` | `readonly` | `number` | `validated_ledger.seq`: the index of the latest validated ledger. |

***

### XrplSigned

The payer's instrument and the message it signed, read from a presented blob: the signed `Account`, its `Sequence`
or, where `Sequence` is 0, its `TicketSequence`, its `LastLedgerSequence` or null, and the signed body, the blob's
fields but `TxnSignature`, `SigningPubKey` and `Signers`, in the codec's canonical encoding, hex.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-account-1"></a> `account` | `readonly` | `string` |
| <a id="property-body"></a> `body` | `readonly` | `string` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `readonly` | `number` \| `null` |
| <a id="property-sequence"></a> `sequence` | `readonly` | `number` |
| <a id="property-ticket"></a> `ticket?` | `readonly` | `number` |

***

### XrplTxJson

#### Indexable

> \[`field`: `string`\]: `unknown`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account-2"></a> `Account` | `string` |
| <a id="property-invoiceid"></a> `InvoiceID?` | `string` |
| <a id="property-lastledgersequence-1"></a> `LastLedgerSequence?` | `number` |
| <a id="property-memos"></a> `Memos?` | `unknown` |
| <a id="property-transactiontype"></a> `TransactionType` | `string` |

***

### XrplUnsigned

What the wallet signs, and how its signed blob completes the payment.

#### Type Parameters

| Type Parameter |
| ------ |
| `P` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"xrpl-tx"` |
| `request.txJson` | [`XrplTxJson`](#xrpltxjson) |

#### Methods

##### complete()

> **complete**(`signedBlob`): `Promise`\<[`Refusal`](index.md#refusal) \| `P`\>

The payment of the wallet's signed blob, hex, read as `bound` reads it: a blob that does not decode, or is
multi-signed, gets the refusal `bound` gives it, and one whose `NetworkID` a node of the option's network does not
take, as rippled reads it, is `xrpl/network-mismatch`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedBlob` | `string` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `P`\>

## Type Aliases

### XrplAmount

> **XrplAmount** = `string` \| \{ `currency`: `string`; `issuer`: `string`; `value`: `string`; \} \| \{ `mpt_issuance_id`: `string`; `value`: `string`; \}

An amount as rippled writes it: drops of XRP, an issued currency's value, or an MPT's.

***

### XrplCloseRef

> **XrplCloseRef** = `object`

The read keys of a reported close: the network, the channel, the close's transaction and the option's payee.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel-1"></a> `channel` | `string` |
| <a id="property-network-3"></a> `network` | [`XrplNetwork`](#xrplnetwork) |
| <a id="property-payee-2"></a> `payee` | `string` |
| <a id="property-phase"></a> `phase` | `"close"` |
| <a id="property-transaction-1"></a> `transaction` | `string` |

***

### XrplCloseStatus

> **XrplCloseStatus** = [`XrplStatus`](#xrplstatus)

A reported close's read, as the profile `read-status` answers it: the answer `XrplStatus` names.

***

### XrplLedgerName

> **XrplLedgerName** = `"validated"` \| `"current"`

The ledger an `account_info` or `ledger_entry` call names: the latest validated one, or the current one.

***

### XrplMark

> **XrplMark** = `"validated"`

The XRP Ledger's one mark, `validated`: a state of a transaction its servers tell apart, the default and the final
mark, and the only finality a query names.

***

### XrplNetwork

> **XrplNetwork** = `` `xrpl:${number}` ``

CAIP-2: `xrpl:` and the chain's NetworkID, 0 to 4294967295.

***

### XrplReached

> **XrplReached** = [`XrplMark`](#xrplmark) \| `"current"`

What a read reached for a transaction it names: `validated`, the mark, or `current`, a ledger the server serves above
the latest validated one, up to the latest ledger the search for H reads on to. `current` is no mark a query names:
an act or a lapse read there is `pending`, `below-mark`.

***

### XrplStatus

> **XrplStatus** = [`StatusAnswer`](index.md#statusanswer)\<`number`, [`XrplReached`](#xrplreached)\>

An XRPL read, as the profile `read-status` answers it. The position is a ledger index, and so is the search's.

## Variables

### XRPL\_MAX\_BLOB\_BYTES

> `const` **XRPL\_MAX\_BLOB\_BYTES**: `16384` = `16_384`

The largest signed blob lcp decodes, in bytes: lcp's own bound, read by every XRPL pairing. It holds a Payment or a
PaymentChannelCreate signed by the 32 signers a signer list admits at most (rippled `3c72fb54`,
`include/xrpl/protocol/STTx.h:49`), with the paths a stock client finds and memos of rippled's 1,024 bytes
(`src/libxrpl/protocol/STTx.cpp:697`); rippled's own bound on a transaction, 1 MB (`include/xrpl/protocol/Protocol.h:38`),
is no payment's.

***

### XRPL\_MAX\_DEPTH

> `const` **XRPL\_MAX\_DEPTH**: `10` = `10`

The deepest level a field of a transaction sits at, rippled's limit: its deserializer refuses a field whose depth is
above 10 (rippled 3.4.1, `src/libxrpl/protocol/STVar.cpp` L104-108, the `STVar` constructor that reads a
`SerialIter`). A top-level field is at level 1, each field inside an STObject or STArray field one level below that
field, and an array's member object one level below the array. An end marker that closes its own object or array
sits at no level, so an object or array at this level holds no field.

***

### XRPL\_MAX\_PAGES

> `const` **XRPL\_MAX\_PAGES**: `16` = `16`

The most `account_tx` pages one read takes: lcp's own bound on the calls a read makes. A search with pages left
answers `pending`, `search-incomplete`, with the ledger the next read resumes from.

***

### xrplChargeStatus

> `const` **xrplChargeStatus**: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](#xrplstatus)\>

The read of `mpp/charge/xrpl`: `xrplPaymentStatus` of MPP's `InvoiceID`, H itself.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`XrplRef`](#xrplref) |
| `reader` | [`XrplReader`](#xrplreader) |
| `query` | [`XrplQuery`](mpp.md#xrplquery)\<[`XrplRef`](#xrplref)\> |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>

***

### xrplOpenStatus

> `const` **xrplOpenStatus**: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](#xrplstatus)\>

The read of an in-band opening, `mpp/session/xrpl`: `xrplPaymentStatus` of the opening's one LCP memo.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`XrplRef`](#xrplref) |
| `reader` | [`XrplReader`](#xrplreader) |
| `query` | [`XrplQuery`](mpp.md#xrplquery)\<[`XrplRef`](#xrplref)\> |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>

***

### xrplStatus

> `const` **xrplStatus**: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](#xrplstatus)\>

The read of `x402/exact/xrpl`: `xrplPaymentStatus` of x402's `InvoiceID`, the SHA-256 of H's LCP string.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`XrplRef`](#xrplref) |
| `reader` | [`XrplReader`](#xrplreader) |
| `query` | [`XrplQuery`](mpp.md#xrplquery)\<[`XrplRef`](#xrplref)\> |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>

## Functions

### decodeBlob()

> **decodeBlob**(`hex`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `hash`: `string`; `tx`: [`XrplTxJson`](#xrpltxjson); \}\>

Decodes a signed blob of at most `XRPL_MAX_BLOB_BYTES` bytes, and computes its transaction hash as the ledger
does: SHA-512Half over `54584E00` and the blob, in upper case. Before the codec decodes it, a single pass over its
fields refuses a blob with a field deeper than `XRPL_MAX_DEPTH`, or with an end marker in an object or array it does
not close, as rippled refuses either. The blob must be the canonical serialization of what it decodes to: the
codec's encoding of the decoded fields gives back the same bytes, so nothing follows a top-level end marker and every
array member is an object.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `hex` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `hash`: `string`; `tx`: [`XrplTxJson`](#xrpltxjson); \}\>

***

### mppInvoiceId()

> **mppInvoiceId**(`h`): `string`

The hash's 64 hex digits in upper case, without `0x`: MPP's `methodDetails.invoiceId`. Throws TypeError when `h` is
not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`string`

***

### x402InvoiceId()

> **x402InvoiceId**(`h`): `Promise`\<`string`\>

Uppercase hex of SHA-256 over the UTF-8 bytes of the hash's LCP string: x402's `InvoiceID` for `extra.invoiceId`.
Rejects with a TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Promise`\<`string`\>

***

### xrplChannelId()

> **xrplChannelId**(`account`, `destination`, `sequence`): `string` \| [`Refusal`](index.md#refusal)

The PayChannel id: SHA-512Half of `0x0078` ‖ the source's AccountID ‖ the destination's AccountID ‖ the creating
transaction's sequence (or ticket sequence), big-endian; upper-case hex. An address that is not a classic address,
or a sequence that is not a UInt32, is `mpp/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `destination` | `string` |
| `sequence` | `number` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### xrplChannelStatus()

> **xrplChannelStatus**(`ref`, `reader`, `query`): `Promise`\<[`XrplStatus`](#xrplstatus)\>

The read of a channel at coverage `none`, as the profile `read-status` answers it: the `PayChannel` at the validated
ledger (`ledger_entry`); then the `account_tx` of the channel's `Account`, or, where the validated ledger does not
show the channel, of the payer the presented payment names, from the ledger the create must come after, or the
search position the query gives, to the latest ledger the server serves, for the `PaymentChannelCreate` whose
metadata creates the channel's entry, or, where the metadata names none, whose `Account`, `Destination` and sequence
or ticket give the channel's id. That create is the act where its `Account` is the payer and its `Destination` the
payee; one another account opened, or one to another account, took the channel and answers `failed`,
`instrument-consumed`; one at or before the query's `after`, `failed`, `before-position`. A channel the validated
ledger shows whose create the search, read whole, does not hold is `unreadable`, `history-gap` where the server does
not hold the range; where it holds it, the create was made at or before the search's start, so at or before the
query's `after` where the search began no later than the ledger after it, `failed`, `before-position`, since
`account_tx` lists every transaction of the opener's account, a delegated create and an inner `Batch` create among
them. A channel it does not show whose create the search does not hold is
`pending`, `not-found`, where the history holds, and `unreadable`, `history-gap` where it does not. `presented` is
`yes` where the create's `Account` is the payer the payment names, the create being the one whose metadata made the
channel's entry, so on every `settled` answer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`XrplChannelRef`](#xrplchannelref) |
| `reader` | [`XrplReader`](#xrplreader) |
| `query` | [`XrplQuery`](mpp.md#xrplquery)\<[`XrplChannelRef`](#xrplchannelref)\> |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>

***

### xrplClaim()

> **xrplClaim**(`channelId`, `drops`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The bytes a channel claim signs: `CLM\0` ‖ channel id (32 bytes) ‖ drops as u64 big-endian. A channel id that is not
64 hex digits, or drops that are not a `bigint` UInt64, is `mpp/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `drops` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

## References

### XrplQuery

Re-exports [XrplQuery](mpp.md#xrplquery)
