---
title: "@integraledger/lcp/stellar"
description: "Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of its authorization entry, the signed-payload precondition over H, the search for a buyer's acts, and the read of the agreement `x402/exact/stellar/precondition`."
---

# @integraledger/lcp/stellar

Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of its authorization entry, the
signed-payload precondition over H, the search for a buyer's acts, and the read of the agreement
`x402/exact/stellar/precondition`.

It also holds the position P of a transaction and the muxed address `M(payee, P)`; the precondition's 40-byte
payload; and the events that show what moved. Every read goes through a bounded reader.

## Interfaces

### PayloadSigner

A signed-payload signer of a transaction's preconditions: its Ed25519 key as a `G…` strkey, and its payload.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-key"></a> `key` | `readonly` | `string` |
| <a id="property-payload"></a> `payload` | `readonly` | `Uint8Array` |

***

### StellarCandidate

A transaction the search found, read whole: its hash, its position P, its result, its envelope, and its events.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-envelopexdr"></a> `envelopeXdr` | `readonly` | `string` | - |
| <a id="property-events"></a> `events` | `readonly` | readonly [`StellarEvent`](#stellarevent) & `object`[] | The events of the transaction the search met, each with its id and its contract, in the RPC's order. |
| <a id="property-position"></a> `position` | `readonly` | `string` | - |
| <a id="property-result"></a> `result` | `readonly` | `"failed"` \| `"succeeded"` | - |
| <a id="property-transaction"></a> `transaction` | `readonly` | `string` | - |

***

### StellarEvent

What a Stellar Asset Contract event shows: its kind, its `from` and its `to` (non-muxed), `to_muxed_id`, and the amount.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `readonly` | `bigint` | - |
| <a id="property-from"></a> `from` | `readonly` | `string` \| `null` | The `from` topic: absent from a `mint`. |
| <a id="property-kind"></a> `kind` | `readonly` | `"transfer"` \| `"mint"` \| `"burn"` | - |
| <a id="property-tobase"></a> `toBase` | `readonly` | `string` \| `null` | The `to` topic, its base account: absent from a `burn`. |
| <a id="property-tomuxedid"></a> `toMuxedId` | `readonly` | `bigint` \| `null` | - |

***

### StellarEventRow

One event `getEvents` answers, as the reader gives it.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-contractid"></a> `contractId` | `readonly` | `string` | The contract that emitted it, a `C…` strkey. |
| <a id="property-id"></a> `id` | `readonly` | `string` | The RPC's event id: the operation's TOID in 19 decimal digits, `-`, and the event's index in 10. |
| <a id="property-ledger"></a> `ledger` | `readonly` | `number` | - |
| <a id="property-topic"></a> `topic` | `readonly` | readonly `string`[] | Its topics, each the base64 XDR of an ScVal. |
| <a id="property-txhash"></a> `txHash` | `readonly` | `string` | - |
| <a id="property-value"></a> `value` | `readonly` | `string` | Its data, the base64 XDR of an ScVal. |

***

### StellarLanded

What the caller adds to the reference for `stellarStatus`: `fromLedger`, the ledger the search starts from, the ledger recorded at issue.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-fromledger"></a> `fromLedger` | `number` |

***

### StellarPayment

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount-1"></a> `amount` | `bigint` |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-auth"></a> `auth` | `object` |
| `auth.address` | `string` |
| `auth.expiration` | `number` |
| `auth.nonce` | `bigint` |
| `auth.preimageHash` | `` `0x${string}` `` |
| `auth.v2` | `boolean` |
| <a id="property-from-1"></a> `from` | `string` |
| <a id="property-to"></a> `to` | `string` |
| <a id="property-tobase-1"></a> `toBase` | `string` |
| <a id="property-toid"></a> `toId` | `bigint` \| `null` |

***

### StellarReader

Bounded, read-only calls against one network's Stellar RPC. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`: a `ReaderError` reads by its kind (`too-large` as `too-large`, `malformed` as
`unparseable`), and any other rejection as `transport`. A throttled call is retried by the reader, never answered as
absence.

#### Methods

##### events()

> **events**(`f`): `Promise`\<\{ `cursor?`: `string`; `events`: readonly [`StellarEventRow`](#stellareventrow)[]; `latestLedger`: `number`; `oldestLedger`: `number`; \}\>

One page of `getEvents` of contract events on every contract, by a filter that names no contract and holds
`topics`, each a topic filter of base64 XDR segments, `*` and `**`, from `fromLedger` through `toLedger`, both
inclusive. `cursor` is present while more pages remain: until the RPC has scanned through `toLedger`, or through its
own `latestLedger` where that is lower. Stellar RPC's `getEvents` treats `endLedger` as exclusive and takes a cursor
or a ledger range but not both, so a reader over it sends `startLedger: fromLedger` and `endLedger: toLedger + 1` on
the first page and only the cursor on later pages, and keeps only the events through `toLedger`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `f` | \{ `cursor?`: `string`; `fromLedger`: `number`; `toLedger`: `number`; `topics`: readonly readonly `string`[][]; \} |
| `f.cursor?` | `string` |
| `f.fromLedger` | `number` |
| `f.toLedger` | `number` |
| `f.topics` | readonly readonly `string`[][] |

###### Returns

`Promise`\<\{ `cursor?`: `string`; `events`: readonly [`StellarEventRow`](#stellareventrow)[]; `latestLedger`: `number`; `oldestLedger`: `number`; \}\>

##### latestLedger()

> **latestLedger**(): `Promise`\<\{ `closeTime?`: `number`; `sequence`: `number`; \}\>

`getLatestLedger`: the latest closed ledger's sequence, and its close time in Unix seconds where the RPC gives it.

###### Returns

`Promise`\<\{ `closeTime?`: `number`; `sequence`: `number`; \}\>

##### passphrase()

> **passphrase**(): `Promise`\<`string`\>

`getNetwork`: the network's passphrase.

###### Returns

`Promise`\<`string`\>

##### sequence()?

> `optional` **sequence**(`account`): `Promise`\<`bigint` \| `null`\>

`getLedgerEntries` of an account: its sequence number, or null where the account does not exist.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### transaction()

> **transaction**(`hash`): `Promise`\<\{ `applicationOrder?`: `number`; `envelopeXdr?`: `string`; `latestLedger`: `number`; `ledger?`: `number`; `oldestLedger`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"NOT_FOUND"`; \}\>

`getTransaction`: its status, and, where it was included, its envelope, its ledger and its application order in
that ledger; with the oldest and latest ledgers the RPC holds.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<\{ `applicationOrder?`: `number`; `envelopeXdr?`: `string`; `latestLedger`: `number`; `ledger?`: `number`; `oldestLedger`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"NOT_FOUND"`; \}\>

***

### StellarRef

The read keys `reference` returns for `x402/exact/stellar/precondition`: the
network; the option's payee (`payTo`), the key of the read's two party tests; the buyer; the asset and the `to` base
account of the transfer the buyer's entry signs; that entry's nonce (an `int64` in decimal), its expiration ledger and
the SHA-256 of its `HashIDPreimage` (`authDigest`, `0x` and 64 lowercase hex digits), which names the entry under any
envelope; and the 40-byte payload as presented (`0x` and 80 lowercase hex digits), whose first 32 bytes are H.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset-1"></a> `asset` | `string` |
| <a id="property-authdigest"></a> `authDigest` | `` `0x${string}` `` |
| <a id="property-buyer"></a> `buyer` | `string` |
| <a id="property-expiration"></a> `expiration` | `number` |
| <a id="property-network"></a> `network` | [`StellarNetwork`](#stellarnetwork) |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-payload-1"></a> `payload` | `string` |
| <a id="property-tobase-2"></a> `toBase` | `string` |

***

### StellarSearch

What a search found: the candidates read whole; the items it could not decode, each with the position held at it;
whether it read through to the latest closed ledger at the read within its bounds; the position the next call resumes
at where it did not; and that ledger.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-at"></a> `at?` | `readonly` | `string` |
| <a id="property-candidates"></a> `candidates` | `readonly` | readonly [`StellarCandidate`](#stellarcandidate)[] |
| <a id="property-latest"></a> `latest` | `readonly` | `number` |
| <a id="property-through"></a> `through` | `readonly` | `boolean` |
| <a id="property-undecoded"></a> `undecoded` | `readonly` | readonly `object`[] |

***

### StellarUnsigned

What the buyer signs for `x402/exact/stellar/precondition`, with one key: SHA-256 of `preimage`, the authorization
entry's `HashIDPreimage`, and `payload` itself, the 40 bytes of the signed-payload precondition (CAP-40); and how the
two signatures complete the payment.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"stellar-precondition"` |
| `request.payload` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.preimage` | `Uint8Array`\<`ArrayBuffer`\> |

#### Methods

##### complete()

> **complete**(`signatures`): [`Refusal`](index.md#refusal) \| `StellarPaymentPayload`

The x402 payment: the entry's signature written as a Stellar account's, the payload's as a decorated signature of
the envelope. A signature that is not 64 bytes is `stellar/tx-malformed`, and a signed envelope over 8,192
characters `stellar/tx-too-large`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signatures` | \{ `entry`: `Uint8Array`; `payload`: `Uint8Array`; \} |
| `signatures.entry` | `Uint8Array` |
| `signatures.payload` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `StellarPaymentPayload`

## Type Aliases

### StellarMark

> **StellarMark** = `"finalized"`

The one mark: a transaction in a closed ledger, which is final.

***

### StellarNetwork

> **StellarNetwork** = `"stellar:pubnet"` \| `"stellar:testnet"`

***

### StellarQuery

> **StellarQuery** = `Omit`\<[`StatusQuery`](index.md#statusquery)\<[`StellarRef`](#stellarref), `string`, [`StellarMark`](#stellarmark), `string`\>, `"after"`\> & `object`

What `stellarStatus` takes beside the reference and the reader: the act, the finality, and, where the caller gives
them, `after`, the ledger sequence a transaction must come after (one in that ledger or below answers
`before-position`), `search`, the position an earlier answer returned, and the other acts under the same H.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `after?` | `number` |

***

### StellarStatus

> **StellarStatus** = [`StatusAnswer`](index.md#statusanswer)\<`string`, [`StellarMark`](#stellarmark), `string`\>

The answer of `stellarStatus`: positions, and the search position, are positions P (`stellar-position.ts`), and the
one mark is `finalized`.

## Variables

### MAX\_CANDIDATES

> `const` **MAX\_CANDIDATES**: `50` = `50`

The candidate transactions one search reads in one call. Any contract can emit an event naming the buyer, so a
stranger can fill it; a search that reaches it is not read through, and resumes at the position it returns.

***

### MAX\_ORDER

> `const` **MAX\_ORDER**: `1048575` = `0xfffff`

The largest application order a position holds: 20 bits.

***

### MAX\_PAGES

> `const` **MAX\_PAGES**: `10` = `10`

The events pages one search reads in one call.

***

### PASSPHRASE

> `const` **PASSPHRASE**: `Readonly`\<`Record`\<[`StellarNetwork`](#stellarnetwork), `string`\>\>

Each network's passphrase; its SHA-256 is the network id.

***

### PAYLOAD\_BYTES

> `const` **PAYLOAD\_BYTES**: `40` = `40`

The length of the signed-payload precondition's payload: H's 32 bytes, then an `int64`'s 8.

***

### SCVAL\_MAX\_DEPTH

> `const` **SCVAL\_MAX\_DEPTH**: `64` = `64`

The deepest nesting of ScVal vectors and maps (a contract instance's storage counting as a map) within one ScVal,
the outermost container being level 1, and of authorized invocations within one authorization entry, the root
invocation being level 1. It bounds what is read of an envelope, the operation and the payer's authorization entry,
and an event's topics and data. It does not apply to the rest of an envelope (another authorization entry, a
delegate, the footprint, another operation), which is decoded whatever its depth, so nesting there does not make the
envelope unreadable.

## Functions

### decodeStellarTx()

> **decodeStellarTx**(`xdrB64`, `network`): [`Refusal`](index.md#refusal) \| [`StellarPayment`](#stellarpayment)

Decodes a base64 `TransactionEnvelope` (v1, or a fee bump's inner v1) of at most 8,192 base64 characters (6 KiB of
XDR) holding exactly one
`invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract, and the one authorization entry
with address credentials (`sorobanCredentialsAddress` or `sorobanCredentialsAddressV2`) whose address is `from`.
The entry's `rootInvocation` must be that same `transfer`, byte for byte, with no sub-invocations; the payment's
contract, `to` and amount are the signed invocation's. The base64 is read strictly (RFC 4648 §4, zero padding bits),
and the XDR must be consumed whole. The operation and that entry nest ScVals and authorized invocations at most
`SCVAL_MAX_DEPTH` levels (`stellar/tx-malformed` past it); the cap does not apply to the rest of the envelope
(another entry, a delegate, the footprint, another operation), which is decoded whatever its depth, so its nesting
does not refuse the envelope. `preimageHash` is SHA-256 of that entry's `HashIDPreimage` under the network's
passphrase: the V1 form, or for V2 the form with the address. An entry with source-account credentials is not one:
without an address entry of `from` the envelope is `stellar/no-address-auth`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `xdrB64` | `string` |
| `network` | [`StellarNetwork`](#stellarnetwork) |

#### Returns

[`Refusal`](index.md#refusal) \| [`StellarPayment`](#stellarpayment)

***

### muxedFor()

> **muxedFor**(`payee`, `position`): `string` \| [`Refusal`](index.md#refusal)

The `M…` strkey of the account `payee` and the id P, the position of a transaction. A `payee` that is not a `G…`
strkey is `stellar/option-malformed`, the code of a recipient that cannot take a muxed id; a P the position's codec
refuses is `stellar/position-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payee` | `string` |
| `position` | `string` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### parseStellarPosition()

> **parseStellarPosition**(`p`): [`Refusal`](index.md#refusal) \| \{ `ledger`: `number`; `order`: `number`; \}

The ledger and the application order of a position. A value that is not a decimal string with no sign and no
leading zero below 2^64, one whose low 12 bits are not zero, or one whose order is 0, is `stellar/position-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `ledger`: `number`; `order`: `number`; \}

***

### readSignedPayload()

> **readSignedPayload**(`bytes`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `value`: `bigint`; \}

H and the `int64` of a 40-byte payload: bytes of any other length, trailing bytes among them, are
`stellar/carrier-mismatch`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `bytes` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `value`: `bigint`; \}

***

### signedPayload()

> **signedPayload**(`h`, `value`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The 40-byte payload of the signed-payload precondition: H's 32 bytes, then `value`, an `int64` (the authorization
entry's nonce, or a transaction's sequence number), 8 bytes big-endian two's complement. An `h` that is not a 32-byte
hash is `x402/payload-malformed`, as the other rails' carrier writers answer one; a `value` that is not a bigint in
the `int64` range `stellar/carrier-mismatch`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |
| `value` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### stellarLocate()

> **stellarLocate**(`q`, `reader`): `Promise`\<[`StellarSearch`](#stellarsearch) \| \{ `unreadable`: [`UnreadableReason`](index.md#unreadablereason); \}\>

The search for a buyer's acts: `getEvents` on every contract with `transferEventTopics(buyer)`, from `fromLedger`
(or, given `search`, the position an earlier search returned, from which it resumes) through the latest closed ledger
at the read, and each candidate transaction read whole by `getTransaction`. An event's transaction is placed by its
id's position, the operation's TOID with its low 12 bits cleared, which must be the position `getTransaction` gives
it (its ledger and application order); an event that does not decode, or whose transaction is not found, does not
decode or sits at another position, is an item the search could not decode, held at that position. At most
`MAX_PAGES` pages and `MAX_CANDIDATES` candidates: a search that reaches either, or whose events index answers below
the latest closed ledger read first, is not read through, and gives the position the next call resumes at. A network
whose passphrase is not the reference's is `chain-mismatch`; an RPC whose oldest ledger is above the ledger the search
starts from, `history-gap`; an answer out of the reader's form, `unparseable`; a rejected read by its reason. The
search needs @stellar/stellar-sdk to write its filter and decode events: without it, it is `unparseable`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `q` | \{ `buyer`: `string`; `fromLedger`: `number`; `network`: [`StellarNetwork`](#stellarnetwork); `search?`: `string`; \} |
| `q.buyer` | `string` |
| `q.fromLedger` | `number` |
| `q.network` | [`StellarNetwork`](#stellarnetwork) |
| `q.search?` | `string` |
| `reader` | [`StellarReader`](#stellarreader) |

#### Returns

`Promise`\<[`StellarSearch`](#stellarsearch) \| \{ `unreadable`: [`UnreadableReason`](index.md#unreadablereason); \}\>

***

### stellarPosition()

> **stellarPosition**(`ledger`, `order`): `string` \| [`Refusal`](index.md#refusal)

The position of the transaction at application order `order` of ledger `ledger`, as its decimal string. A `ledger`
that is not a ledger sequence, or an `order` that is not an integer from 1 to 2^20 − 1, is `stellar/position-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ledger` | `number` |
| `order` | `number` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### stellarRecover()

> **stellarRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

H as the landed transaction `tx` carries it: the first 32 bytes of the one signed-payload signer of its
preconditions, whose payload is 40 bytes. A transaction with none or more than one is `stellar/no-carrier`, and a
payload of another length `stellar/carrier-mismatch`; a transaction the reader does not know is `stellar/not-found`;
a rejected read, or an answer out of the reader's form, is `stellar/unreadable`. An input that is not one, a `tx`
that is not 64 hex digits, or a reader whose passphrase is not the network's, is `stellar/wrong-reader`. The
envelope is read as `scanEnvelope` reads it. H is recovered whatever the transaction's result.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`StellarNetwork`](#stellarnetwork), `unknown`\> |
| `reader` | [`StellarReader`](#stellarreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### stellarStatus()

> **stellarStatus**(`ref`, `reader`, `query`): `Promise`\<[`StellarStatus`](#stellarstatus)\>

The read of `x402/exact/stellar/precondition`, as the profile `read-status` answers it, through `stellarLocate`'s
search from the reference's `fromLedger`. A candidate that succeeded and is of the form (its one operation the
`transfer` the buyer's entry signs) is the agreement where the five checks hold for H and the buyer: its
preconditions hold exactly one signed-payload signer, whose payload is H then the nonce of the entry the transaction
consumed; that payload's key is a key whose signature the entry carries; the transfer's `from` is not the option's
payee; and the buyer is an account whose entry has address credentials. A candidate whose payload key is the payee's,
or whose `from` is the payee, is the payee's; one whose payload key the entry did not sign carries H under another
account's signature; one of the form that fails the payload's layout is of another kind. A candidate that consumed
the entry's nonce is its consumer; one not of the form that holds an entry of the buyer's over that nonce is an item
the search could not decode, since the read cannot tell whether the host used that entry. The nonce is read only by
the search read through, which shows it consumed where a candidate consumed it, and its validity passed where the
latest closed ledger is above the entry's expiration ledger; a search not read through, or that met an item it could
not decode, reads it neither consumed nor unconsumed. The search proves no absence until a run shows that the event
search with no contract named holds every act of the buyer, so the read never reports it read whole, and every
answer it decides but `before-position` is `pending`, `search-incomplete`. `presented` is `yes` where the landed
entry's digest and payload are the reference's, `no` otherwise. Each transfer is named by its transaction and its
event's id. A reference, reader or query that is not one is `unparseable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StellarRef`](#stellarref) & [`StellarLanded`](#stellarlanded) |
| `reader` | [`StellarReader`](#stellarreader) |
| `query` | [`StellarQuery`](#stellarquery) |

#### Returns

`Promise`\<[`StellarStatus`](#stellarstatus)\>

***

### transferEventOf()

> **transferEventOf**(`topic`, `value`): [`Refusal`](index.md#refusal) \| [`StellarEvent`](#stellarevent)

A Stellar Asset Contract event, as CAP-67 writes it: `transfer` (`from`, `to`, then any trailing topic), `burn`
(`from`), or `mint` (`to`; or `admin` then `to`, where the third topic is an address); its data the `i128` amount, or
a map holding `amount` and, for a muxed recipient, `to_muxed_id` (read where it is a `u64`). The first topic and the
map's keys are symbols, compared byte for byte. Every refusal is `stellar/event-malformed`. The topics' and the
value's form (2 to 4 topics, each one and the value base64 of at most 1,024 characters) is checked before the SDK is
needed, which reads the XDR.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `topic` | readonly `string`[] |
| `value` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`StellarEvent`](#stellarevent)

***

### transferEventTopics()

> **transferEventTopics**(`buyer`): [`Refusal`](index.md#refusal) \| readonly readonly `string`[][]

The `getEvents` topic filters of the buyer's acts, as base64 XDR segments: `transfer` events whose `from` topic is
the buyer, and `burn` events whose `from` topic is the buyer, each with any trailing topics. A `mint` event names no
`from` (CAP-67 removed the admin from its topics), so no filter of `mint` names the buyer. A buyer that is not an
account or contract strkey is `stellar/option-malformed`, which needs no SDK: the SDK is needed after it, to write
the XDR.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `buyer` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| readonly readonly `string`[][]
