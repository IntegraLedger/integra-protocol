---
title: "@integraledger/lcp/avm"
description: "The exports of @integraledger/lcp/avm."
---

# @integraledger/lcp/avm

## Interfaces

### AvmAssetTransfer

An asset transfer's members, as the Indexer reports them under `asset-transfer-transaction`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` | `aamt`: `amount`. |
| <a id="property-assetid"></a> `assetId` | `bigint` | `xaid`: `asset-id`. |
| <a id="property-assetsender"></a> `assetSender` | `string` \| `null` | `asnd`: the asset transfer's `sender`, set only on a clawback; null where unset. |
| <a id="property-closeamount"></a> `closeAmount` | `bigint` | `close-amount`: what the close moved to `closeTo`; 0 where there is no close. |
| <a id="property-closeto"></a> `closeTo` | `string` \| `null` | `aclose`: `close-to`; null where unset. |
| <a id="property-receiver"></a> `receiver` | `string` | `arcv`: `receiver`. |

***

### AvmIndexed

A transaction as the Indexer reports it, with the members the read needs.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authaddr"></a> `authAddr` | `string` \| `null` | `auth-addr`: `sgnr`, the signer where it is not the sender; null where the signer is the sender. |
| <a id="property-confirmedround"></a> `confirmedRound` | `bigint` | `confirmed-round`. |
| <a id="property-id"></a> `id` | `string` | `id`, the transaction id. An inner transaction carries its root's. |
| <a id="property-inner"></a> `inner` | readonly [`AvmIndexed`](#avmindexed)[] | `inner-txns`. |
| <a id="property-note"></a> `note` | `Uint8Array` | `note`, decoded from its base64. |
| <a id="property-sender"></a> `sender` | `string` | `sender`: `snd`. |
| <a id="property-signature"></a> `signature` | `"none"` \| `"sig"` \| `"multisig"` \| `"pqsig"` \| `"logicsig"` | The member of `signature` that is set: `sig`, `multisig`, `logicsig` or `pqsig`; `none` on an inner transaction. |
| <a id="property-transfer"></a> `transfer` | [`AvmAssetTransfer`](#avmassettransfer) \| `null` | `asset-transfer-transaction`, where `type` is `axfer`; null otherwise. |
| <a id="property-type"></a> `type` | `string` | `tx-type`: `axfer` for an asset transfer. |

***

### AvmPage

One page of an account's transactions, as the Indexer answers it.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-currentround"></a> `currentRound` | `bigint` | The answer's `current-round`. |
| <a id="property-next"></a> `next?` | `string` | `next-token`; absent on the page that holds no transaction. |
| <a id="property-transactions"></a> `transactions` | readonly ([`AvmIndexed`](#avmindexed) \| \{ `id`: `string`; `unparseable`: `true`; \})[] | The page's transactions, newest first; one the reader cannot parse is `{ unparseable: true, id }`, by its id. |

***

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

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-archival"></a> `archival?` | `readonly` | `boolean` | True where the Indexer is declared archival: it holds every round, so the history is shown without a read. |
| <a id="property-network"></a> `network` | `readonly` | `` `algorand:${string}` `` | - |

#### Methods

##### accountPage()

> **accountPage**(`account`, `q`): `Promise`\<[`AvmPage`](#avmpage)\>

`GET /v2/accounts/{account}/transactions` with `min-round`, and `max-round` and `next` where given.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `q` | \{ `maxRound?`: `bigint`; `minRound`: `bigint`; `next?`: `string`; \} |
| `q.maxRound?` | `bigint` |
| `q.minRound` | `bigint` |
| `q.next?` | `string` |

###### Returns

`Promise`\<[`AvmPage`](#avmpage)\>

##### header()

> **header**(`round`): `Promise`\<`boolean`\>

`GET /v2/blocks/{round}?header-only=true`: true where it answers the block's header, false where it holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `round` | `bigint` |

###### Returns

`Promise`\<`boolean`\>

##### transaction()

> **transaction**(`txid`): `Promise`\<\{ `currentRound`: `bigint`; `found`: [`AvmIndexed`](#avmindexed) \| `null`; \}\>

`GET /v2/transactions?txid=…`: the answer's `current-round`, and the transaction, or null where it holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `string` |

###### Returns

`Promise`\<\{ `currentRound`: `bigint`; `found`: [`AvmIndexed`](#avmindexed) \| `null`; \}\>

***

### AvmRef

The read keys `reference` returns, computed from the signed bytes with no network: the network, the transaction id,
its last valid round as a decimal string, H, the payer `snd`, the signer the payment entry names (`sgnr` where set,
else `snd`), and the option's payee.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-h"></a> `h` | `` `0x${string}` `` | The hash the payment's note carries: the search for H's key. |
| <a id="property-lastvalid"></a> `lastValid` | `string` | - |
| <a id="property-network-1"></a> `network` | `` `algorand:${string}` `` | - |
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-sender-1"></a> `sender` | `string` | The payer, `snd`: the account whose transactions the search for H reads. |
| <a id="property-signer"></a> `signer` | `string` | The signer the presented entry names: `sgnr` where set, else `snd`. |
| <a id="property-txid"></a> `txid` | `string` | - |

***

### AvmSearch

The search's position: the round through which it is read whole, and, for a sub-range under way, its top and the
`next` token of the last page read.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-next-1"></a> `next?` | `string` |
| <a id="property-through"></a> `through` | `bigint` |
| <a id="property-top"></a> `top?` | `bigint` |

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

> **AvmStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `"final"`, [`AvmSearch`](#avmsearch)\>

The answer of `avmStatus`: positions are confirmed rounds, the one mark is `final`, and the search's position is
`AvmSearch`. A `settled` answer states `presented`: `yes` where the act is the transaction the reference was built
from, `no` where it is another. Each transfer of what moved is named by its transaction id and its place, the member
naming the account it reached (`arcv`, or `aclose` for a holding closed to it).

## Variables

### AVM\_MAX\_ENTRY

> `const` **AVM\_MAX\_ENTRY**: `8192` = `8192`

lcp's own resource bound on one payment entry: at most 8,192 base64 characters, so that no entry costs more to read
than a signed asset transfer with the largest note the chain admits and a multisignature of many keys.

***

### AVM\_MAX\_GROUP

> `const` **AVM\_MAX\_GROUP**: `16` = `16`

The most transactions a payment group holds: x402's Algorand scheme's bound, the chain's own group size.

***

### AVM\_MAX\_LIFE

> `const` **AVM\_MAX\_LIFE**: `1000` = `1000`

The longest a signed transaction stays payable, in rounds after its first valid round: the chain's maximum
transaction life, which lcp's client never exceeds when it sets the last valid round.

***

### AVM\_MAX\_NOTE

> `const` **AVM\_MAX\_NOTE**: `4096` = `4096`

lcp's own resource bound on a payment entry's note, 4,096 bytes, above the chain's 1,024, so that the reader refuses
no note algod could take and reads no unbounded one.

***

### AVM\_SEARCH\_PAGES

> `const` **AVM\_SEARCH\_PAGES**: `32` = `32`

lcp's own resource bound on one read: the search for H reads at most 32 pages of the payer's transactions in one
call, and an answer that stops there carries the search's position, from which the next call resumes.

***

### exactAvm

> `const` **exactAvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmUnsigned`](#avmunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/algorand"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmRef`](#avmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`AvmStatus`](#avmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

> **avmCarrier**(`p`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `sender`: `string`; `signer`: `string`; `txid`: `string`; \}

The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, read as a signed asset transfer
whose note is an LCP string. Gives the hash, the transaction id and the last valid round. On the x402 path the entry
has two readers: the facilitator decodes it, and algod decodes the bytes the facilitator submits, which are the
entry's own. The entry is read only when it is one msgpack value nesting at most `MSGPACK_MAX_DEPTH` deep, algod's
decoder takes it as a signed transaction of a type algod knows with no member of another type set, the
facilitator's decoder takes it as an asset transfer, and both read the same signed transaction: their canonical
encodings are equal, and the facilitator can compute its id (it has a genesis hash). An entry a Falcon signature
(`pqsig`) authorises, which the facilitator's decoder does not read, is read by algod's decoder alone, where `pqsig` is
its one signature, Falcon-1024's, within go-codec's bounds. Any other entry is `avm/txn-malformed`, and one algod reads
as another type is `avm/not-axfer`. So a repeated scalar key, keys out of
order, a member written at its default, an integer or length in a longer format than it needs, a nil member, or a
binary and a string in each other's place reads as algod reads it, and the transaction id is the one algod computes,
from the transaction's canonical encoding. Where the two read different transactions the entry is refused: a
repeated struct whose earlier occurrences set a member the last one does not, which algod merges in and the
facilitator does not read, a repeated list whose elements algod decodes into those an earlier list left, and a
fixed-length byte member of another length. A byte member written as a msgpack string is read as its
bytes, whatever they are; a string member (`type`, `gen`) is refused when its bytes are not UTF-8, which the
facilitator reads as other text. Each answer is a function of the entry's bytes alone. Both readers are the package's
own (`readEntry`), so nothing here needs algosdk: every answer is the same without it. Then, the note carrying H, an
entry a logic signature authorises is `avm/logic-signature` and one that names an asset sender, `asnd`, is
`avm/clawback`: under a logic signature no key signs the transaction, and a transfer that names `asnd` is the act of
the asset's clawback address, so neither is the payer's signed act. Gives H, the transaction id, the last valid
round, the sender `snd` and the signer, `sgnr` where the payment entry names one and `snd` otherwise.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | [`AvmPresented`](#avmpresented) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `sender`: `string`; `signer`: `string`; `txid`: `string`; \}

***

### avmRecover()

> **avmRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from the landed payment's note, for anyone holding the transaction id. An input whose `tx` is not the 52
base32 characters of a 32-byte hash, or whose option is not an object, is `avm/wrong-reader`, with nothing read; the
option is not read further. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `algorand:${string}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`AvmReader`](#avmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### avmStatus()

> **avmStatus**(`ref`, `reader`, `query`): `Promise`\<[`AvmStatus`](#avmstatus)\>

The read of the payment by the transaction id and, where it decides, the search for H, as the profiles
`read-status` and `x402/exact/algorand/note` answer it. The facts the search rests on are not yet shown by a run, so
a search read whole answers `pending`, `search-incomplete`, where it would answer `failed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`AvmRef`](#avmref) |
| `reader` | [`AvmReader`](#avmreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`AvmRef`](#avmref), `bigint`, `"final"`, [`AvmSearch`](#avmsearch)\> |

#### Returns

`Promise`\<[`AvmStatus`](#avmstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
