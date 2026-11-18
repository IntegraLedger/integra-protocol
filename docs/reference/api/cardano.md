---
title: "@integraledger/lcp/cardano"
description: "Cardano, and its two pairings: `x402/exact/cardano`, x402's address-to-address method, and `x402/exact/cardano/lock`, its two lock methods (`masumi` and `script`). Each carries the ATR hash as a CIP-20 message that the payer's signed body commits to."
---

# @integraledger/lcp/cardano

Cardano, and its two pairings: `x402/exact/cardano`, x402's address-to-address method, and `x402/exact/cardano/lock`,
its two lock methods (`masumi` and `script`). Each carries the ATR hash as a CIP-20 message that the payer's signed
body commits to.

The two are told apart by the option's `extra.assetTransferMethod`. The message has metadata label 674, and the body
commits to it through `auxiliary_data_hash`. The transaction id is the Blake2b-256 of the body as received, so a
payment is named by an id fixed before any money moves, and its single-use value is the input `payload.nonce` names,
which the body spends.

## Interfaces

### CardanoOnChain

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` | - |
| <a id="property-cbor"></a> `cbor?` | `Uint8Array`\<`ArrayBufferLike`\> | The transaction as included, when asked for. |
| <a id="property-slot"></a> `slot` | `bigint` | - |
| <a id="property-valid"></a> `valid` | `boolean` | db-sync's `tx.valid_contract`. |

***

### CardanoOutput

An output an input names, as the endpoint answers it: the address that holds it, in Bech32 (a Byron address in any
other spelling holds no payment credential); where it is spent, `spentBy`: the transaction that spent it, or null
where the endpoint cannot name it; and `slot`, as `transaction`'s not-found answer names it. An unspent output is
read at the latest head only where that slot is at or past the tip's read first.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-address"></a> `address` | `string` | - |
| <a id="property-slot-1"></a> `slot?` | `bigint` | The slot of the latest block the indexer that answered held, read before the output; absent where unread. |
| <a id="property-spentby"></a> `spentBy?` | `` `0x${string}` `` \| `null` | - |

***

### CardanoPage

One page of a payment credential's transactions: `through`, the height of the latest block the endpoint held,
named by it before the page; the transactions with block heights in the range asked, ordered by height and then by
id; and `more`, true where the range holds more after this page.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-more"></a> `more` | `boolean` |
| <a id="property-through"></a> `through` | `bigint` |
| <a id="property-transactions"></a> `transactions` | readonly `object`[] |

***

### CardanoPayload

The payload x402's Cardano scheme defines.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### CardanoReader

Bounded, read-only calls against one network's indexer. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable. `slotAt` answers the slot of the block at a height, or
null when the indexer holds no block at it. `transaction` answers `notFound` when the indexer does not hold the
transaction, with `slot`: the slot of the latest block the indexer that answered held, read from that same indexer
before the lookup, or null when the reader cannot read it from that indexer. A lookup naming no slot never reads
failed. `securityParam` is the ledger's security parameter from the endpoint's genesis, the count of confirmations
that is the final mark. `output` answers the output an input names (`<transaction id>#<index>`), or `notFound`
where the endpoint documents the transaction that created it as absent. `inputAddresses` answers the addresses that
hold a transaction's inputs, in its body's order. `credentialTransactions` answers one page of the transactions of a
payment credential (`key:` or `script:` and its 28 bytes in hex) with block heights from `from` through `to`. No run
has yet shown that any endpoint's listing holds every transaction that spends an output of the credential, or that
a page with `more` false is the last (the profile `x402-exact-cardano`), so no search through it is read whole.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`CardanoNetwork`](#cardanonetwork) |

#### Methods

##### credentialTransactions()

> **credentialTransactions**(`credential`, `from`, `to`, `offset`): `Promise`\<[`CardanoPage`](#cardanopage)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `credential` | `string` |
| `from` | `bigint` |
| `to` | `bigint` |
| `offset` | `number` |

###### Returns

`Promise`\<[`CardanoPage`](#cardanopage)\>

##### inputAddresses()

> **inputAddresses**(`txId`): `Promise`\<readonly `string`[]\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txId` | `` `0x${string}` `` |

###### Returns

`Promise`\<readonly `string`[]\>

##### output()

> **output**(`input`): `Promise`\<[`CardanoOutput`](#cardanooutput) \| \{ `notFound`: `true`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` |

###### Returns

`Promise`\<[`CardanoOutput`](#cardanooutput) \| \{ `notFound`: `true`; \}\>

##### securityParam()

> **securityParam**(): `Promise`\<`bigint`\>

###### Returns

`Promise`\<`bigint`\>

##### slotAt()

> **slotAt**(`blockHeight`): `Promise`\<`bigint` \| `null`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockHeight` | `bigint` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### tip()

> **tip**(): `Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

###### Returns

`Promise`\<\{ `blockHeight`: `bigint`; `slot`: `bigint`; \}\>

##### transaction()

> **transaction**(`txId`, `withCbor`): `Promise`\<[`CardanoOnChain`](#cardanoonchain) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txId` | `` `0x${string}` `` |
| `withCbor` | `boolean` |

###### Returns

`Promise`\<[`CardanoOnChain`](#cardanoonchain) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

***

### CardanoRef

The read keys of a presented payment. `txId` is the Blake2b-256 of the body the payer signed, which holds every
member of the payment presented, so a landed act is the payment presented exactly where its id is this one.
`ttlSlot` is the slot from which the body cannot land (body key 3, `invalid_hereafter`), absent for a body that sets
none. `input` is the input `payload.nonce` names, the single-use value. `payee` is the option's payee, the key of the
read's two party tests: its `payTo`, or on a Masumi lock the seller its `extra.terms.sellerAddress` names. `escrow`,
on a Masumi lock alone, is the option's `payTo`, the escrow every seller of the deployment shares: only a deposit
into it names, by its datum, the seller. `h` is the hash the body carries, the key of the search for H.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-escrow"></a> `escrow?` | `string` |
| <a id="property-h"></a> `h` | `` `0x${string}` `` |
| <a id="property-input"></a> `input` | `string` |
| <a id="property-method"></a> `method` | [`CardanoMethod`](#cardanomethod) |
| <a id="property-network-1"></a> `network` | [`CardanoNetwork`](#cardanonetwork) |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-ttlslot"></a> `ttlSlot?` | `string` |
| <a id="property-txid"></a> `txId` | `` `0x${string}` `` |

***

### CardanoTx

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-h-1"></a> `h` | [`Refusal`](index.md#refusal) \| `` `0x${string}` `` |
| <a id="property-ttlslot-1"></a> `ttlSlot` | `bigint` \| `null` |
| <a id="property-txid-1"></a> `txId` | `` `0x${string}` `` |

***

### CardanoUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.auxiliaryData` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.kind` | `"cardano-transaction"` |

#### Methods

##### complete()

> **complete**(`signed`): `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoPaymentPayload`](index.md#cardanopaymentpayload)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`CardanoPayload`](#cardanopayload) |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoPaymentPayload`](index.md#cardanopaymentpayload)\>

## Type Aliases

### CardanoMethod

> **CardanoMethod** = `"default"` \| `"masumi"` \| `"script"`

x402's Cardano asset transfer methods: `default` is the address method, `masumi` and `script` the two locks.

***

### CardanoNetwork

> **CardanoNetwork** = `"cardano:mainnet"` \| `"cardano:preprod"` \| `"cardano:preview"`

***

### CardanoQuery

> **CardanoQuery** = [`StatusQuery`](index.md#statusquery)\<[`CardanoRef`](#cardanoref), `bigint`, `bigint`, `bigint`\>

***

### CardanoStatus

> **CardanoStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `bigint`, `bigint`\>

The answer of `cardanoStatus`: positions and the search's position are block heights, and marks are counts of
confirmations, the newer blocks above the transaction's; the final mark is the ledger's security parameter. Each
transfer of what moved is named by its transaction's id and, as `place`, its output's index among the body's
outputs. A `settled` answer states `presented`: `yes` where the act is the body the reference was built from, `no`
where it is another.

## Variables

### CARDANO\_MAX\_TX\_BYTES

> `const` **CARDANO\_MAX\_TX\_BYTES**: `number`

lcp's bound on a presented or read transaction: 64 KiB. The ledger's own `maxTxSize` is 16,384 bytes on mainnet
and the public testnets; lcp reads up to four times that, so that a parameter change does not refuse a payment the
ledger takes, and refuses beyond it so that a stranger's bytes cost a bounded decode.

***

### CARDANO\_SEARCH\_BOUND

> `const` **CARDANO\_SEARCH\_BOUND**: `1000` = `1000`

lcp's bound on the work of one `status` call: at most 1,000 transactions of the payer's credential read whole by the
search for H, the size of one page of Koios's listing. A search with more to read answers `pending`,
`search-incomplete`, with its position, and the next call resumes from it.

***

### exactCardano

> `const` **exactCardano**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `coinsPerUtxoByte`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoUnsigned`](#cardanounsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/cardano"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoRef`](#cardanoref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CardanoStatus`](#cardanostatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/cardano`, the address method (`extra.assetTransferMethod` absent or `"default"`). The payee broadcasts
(`broadcaster` answers `"payee"`): the settler submits the transaction the payer signed; `status` reads it by the id
its body fixes and by the input it spends.

***

### exactCardanoLock

> `const` **exactCardanoLock**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoUnsigned`](#cardanounsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/cardano/lock"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoRef`](#cardanoref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CardanoStatus`](#cardanostatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/cardano/lock`, the two lock methods (`extra.assetTransferMethod` `"masumi"` or `"script"`): a deposit
into an escrow or a contract the seller defines, which is a charge and never an agreement. Its payee is the seller
the option's `extra.terms.sellerAddress` names on a Masumi lock, whose `payTo` is the escrow every seller of the
deployment shares, and `payTo` on a script lock.

***

### LCP\_MARKER

> `const` **LCP\_MARKER**: `"lcp:sha256:0x"` = `"lcp:sha256:0x"`

CIP-20 line 1 of the carrier; line 2 is the hash's 64 lowercase hex digits.

## Functions

### auxiliaryData()

> **auxiliaryData**(`h`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The exact auxiliary data the payer attaches: `#6.259({0: {674: {"msg": [LCP_MARKER, <64 hex>]}}})`. A value that is
not a 32-byte hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### cardanoFloor()

> **cardanoFloor**(`input`): `bigint` \| [`Refusal`](index.md#refusal)

The smallest lovelace an output to `payTo` can hold, the ledger's minimum (x402's Cardano scheme, *Minimum UTXO
Value*): `(160 + |serialized output|) × coinsPerUtxoByte`, the output being `{0: address, 1: value}` in the
post-Alonzo map form, its value the coin alone for a lovelace option, or the coin with one unit of the option's
native token (`<policy id hex>.<asset name hex>`). The coin's own encoding is part of the output, so the minimum is
the least coin whose output it covers. `coinsPerUtxoByte` is the protocol parameter, read live by the caller, since
governance can change it. An address that is not a Shelley address in Bech32, an asset not in that form, or a
parameter that is not a positive bigint is `cardano/floor-input`. An agreement's amount below it cannot be built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | \{ `asset`: `string`; `coinsPerUtxoByte`: `bigint`; `payTo`: `string`; \} |
| `input.asset` | `string` |
| `input.coinsPerUtxoByte` | `bigint` |
| `input.payTo` | `string` |

#### Returns

`bigint` \| [`Refusal`](index.md#refusal)

***

### cardanoRecover()

> **cardanoRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the hash back from the included transaction alone, by its id, `input.tx`. An input whose `tx` is not a 32-byte
hash, or whose option is not an object, is `cardano/wrong-reader`, with nothing read; the option is not read further. Bytes that are not one CBOR array whose first item, the body, has the id
as its Blake2b-256 are not the transaction the id names, and are `cardano/unreadable`, as a failed read is, whatever
the decoder answers for them; its refusals answer only for bytes whose body has the id. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`CardanoNetwork`](#cardanonetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`CardanoReader`](#cardanoreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### cardanoStatus()

> **cardanoStatus**(`ref`, `reader`, `query`): `Promise`\<[`CardanoStatus`](#cardanostatus)\>

The read of the act the query asks about, as the profile `read-status` answers it. Positions are block heights and
marks counts of confirmations, from 0, the transaction included at the tip, to the ledger's security parameter, the
final mark, read from the reader. It reads, in order: the security parameter; the tip, read first; the block at the
position the caller gives, where the endpoint answers no such block the answer being `unreadable`, `history-gap`
(where the caller gives none, the genesis block shows the history the act would be in); the output the reference's
input names, with the payment credential that holds it, the payer's, and the transaction that spent it; the
transaction the reference names, by its id; the spending transaction; and the search for H: the transactions of the
payer's payment credential from the block after the position given, or after the position an earlier answer
returned, to the tip read first, each read whole, at most `CARDANO_SEARCH_BOUND` of them. Each transaction met is
classified from what landed: it carries H where its label 674 holds the reference's H; it consumed the input where it
is valid and spends it, or is invalid and takes it as collateral; its signer is the option's payee where an input of
the payee's payment credential is among its inputs, the payer where one of the payer's is, and another account
otherwise; it is of another kind where it deposits into a contract (an output to a script credential with an inline datum)
and the reference is the address method, or deposits into none and the reference is a Masumi lock; and it names the payee's account where an output's address has the payee's
payment credential, whatever its stake part, an output naming its own payment credential except, on a Masumi lock, a
deposit into the reference's escrow, which names the `seller` its datum names and none where the datum does not
decode; and no account where no output other than to the payer's credential names one, read from the body whatever
its result.
What moved is each output to another credential than the payer's, as observed, compared with nothing, and none for a
transaction included with `valid_contract` false, which created no output; each is named by the transaction's id and
its output's index. A `settled` answer states `presented`, `yes` where the act's id is the reference's and `no` where it
is another. The search is never read whole: no run has yet shown that a listing holds every transaction of the
credential (the profile `x402-exact-cardano`), so every `failed` but `before-position` answers `pending`,
`search-incomplete`. Every page is read to the last; the search is held at the lowest height the endpoint named
before a page where that is below the tip, or before the first listed transaction it did not read where the bound or
an absent transaction stopped it. A listed transaction that does not decode is named, and the answer holds the search
there, no item past the position the search is held at; a search read to the tip gives no position.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CardanoRef`](#cardanoref) |
| `reader` | [`CardanoReader`](#cardanoreader) |
| `query` | [`CardanoQuery`](#cardanoquery) |

#### Returns

`Promise`\<[`CardanoStatus`](#cardanostatus)\>

***

### decodeCardanoTx()

> **decodeCardanoTx**(`base64`): `Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoTx`](#cardanotx)\>

Decodes a base64 transaction `[body, witness set, bool, auxiliary data / nil]`, keeping each item's bytes as
received. The id is the Blake2b-256 of the body's bytes; the auxiliary data must hash to the body's key 7.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `base64` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`CardanoTx`](#cardanotx)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### CardanoPaymentPayload

Re-exports [CardanoPaymentPayload](index.md#cardanopaymentpayload)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)
