---
title: "@integraledger/lcp/aptos"
description: "Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer carries the ATR hash, so the hash is advertised in the challenge and tied to the payment by the seller's claim."
---

# @integraledger/lcp/aptos

Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer
carries the ATR hash, so the hash is advertised in the challenge and tied to the payment by the seller's claim.

The hash is read back from the echoed extension. The settlement is found by the payer's sender and sequence number,
and identified by a digest of the transfer the payer signed and by the expiry it signed.

## Interfaces

### AptosAccount

The account's sequence number, at the ledger of that answer: its time, and its oldest version held.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-oldestversion"></a> `oldestVersion` | `bigint` | The answer's `X-Aptos-Ledger-Oldest-Version`. |
| <a id="property-sequencenumber"></a> `sequenceNumber` | `bigint` | The account's `sequence_number`; 0 where the node does not hold the account. |
| <a id="property-timestampusecs"></a> `timestampUsecs` | `bigint` | The answer's `X-Aptos-Ledger-TimestampUsec`. |

***

### AptosCommitted

A committed user transaction as the REST API returns it, with every member the read needs: its `events` and its
`changes` whole, as the node returns them. A reader that leaves either out returns an answer out of this form, which
the read answers `unreadable`, `unparseable`, and never reads as a transaction that deposited nothing.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changes"></a> `changes` | `object`[] | Every write-set change of the transaction: at a deposit's store address, `0x1::object::ObjectCore`'s `owner` and `0x1::fungible_asset::FungibleStore`'s `metadata`, each a `write_resource` whose `data` is `{type, data}`. |
| <a id="property-events"></a> `events` | `object`[] | Every event of the transaction, each with its type and data: a deposit is `0x1::fungible_asset::Deposit`, `{store, amount}`. |
| <a id="property-expiration_timestamp_secs"></a> `expiration_timestamp_secs` | `string` | - |
| <a id="property-gas_unit_price"></a> `gas_unit_price?` | `string` | - |
| <a id="property-hash"></a> `hash` | `string` | - |
| <a id="property-max_gas_amount"></a> `max_gas_amount?` | `string` | - |
| <a id="property-payload"></a> `payload` | `object` | The payload as signed: an entry function's `function`, `type_arguments` and `arguments`, or another kind's members. The read takes a transaction of any payload at the signed number for its deposits. |
| `payload.arguments?` | `unknown`[] | - |
| `payload.function?` | `string` | - |
| `payload.type` | `string` | - |
| `payload.type_arguments?` | `string`[] | - |
| <a id="property-sender"></a> `sender` | `string` | - |
| <a id="property-sequence_number"></a> `sequence_number` | `string` | - |
| <a id="property-success"></a> `success` | `boolean` | - |
| <a id="property-type"></a> `type` | `"user_transaction"` | - |
| <a id="property-version"></a> `version` | `string` | - |

***

### AptosInstrument

The transfer the payer signed, in one normal form shared by the signed bytes and the chain's REST answer.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-arguments"></a> `arguments` | readonly `string`[] | - |
| <a id="property-chainid"></a> `chainId` | `number` | - |
| <a id="property-expiresat"></a> `expiresAt` | `bigint` | - |
| <a id="property-function"></a> `function` | `string` | - |
| <a id="property-gasunitprice"></a> `gasUnitPrice?` | `bigint` | - |
| <a id="property-maxgasamount"></a> `maxGasAmount?` | `bigint` | The signed gas members; absent in a normal form read from a REST answer that does not show them. |
| <a id="property-sender-1"></a> `sender` | `` `0x${string}` `` | - |
| <a id="property-sequencenumber-1"></a> `sequenceNumber` | `bigint` | - |
| <a id="property-typearguments"></a> `typeArguments` | readonly `string`[] | - |

***

### AptosReader

Bounded, read-only calls against one network's REST endpoint. Every failure rejects, for example with `ReaderError`
from `@integraledger/lcp/evm`; any rejection reads as unreadable. A committed transaction is returned whole, with
its `events` and its `changes` (`AptosCommitted`); an answer without them is `unparseable`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `aptos:${number}` `` |

#### Methods

##### account()

> **account**(`sender`): `Promise`\<[`AptosAccount`](#aptosaccount)\>

`GET /v1/accounts/{sender}`: the account's sequence number with the ledger time and floor of that answer.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `sender` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`AptosAccount`](#aptosaccount)\>

##### byHash()

> **byHash**(`hash`): `Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `type`: `"pending_transaction"`; \} \| `null`\>

`GET /v1/transactions/by_hash/{hash}`; null on 404.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `type`: `"pending_transaction"`; \} \| `null`\>

##### bySequence()

> **bySequence**(`sender`, `n`): `Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `notFound`: `true`; `oldestVersion?`: `bigint`; `timestampUsecs`: `bigint`; \}\>

`GET /v1/accounts/{sender}/transactions?start=n&limit=1`, kept only when its `sequence_number` is n. When there is
none, `notFound` with `timestampUsecs`, the ledger timestamp of that answer, its `X-Aptos-Ledger-TimestampUsec`
header, and `oldestVersion`, its `X-Aptos-Ledger-Oldest-Version` header.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `sender` | `` `0x${string}` `` |
| `n` | `bigint` |

###### Returns

`Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `notFound`: `true`; `oldestVersion?`: `bigint`; `timestampUsecs`: `bigint`; \}\>

##### ledger()

> **ledger**(): `Promise`\<\{ `chainId`: `number`; `timestampUsecs`: `bigint`; \}\>

`GET /v1`.

###### Returns

`Promise`\<\{ `chainId`: `number`; `timestampUsecs`: `bigint`; \}\>

***

### AptosRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-expiresat-1"></a> `expiresAt` | `string` | - |
| <a id="property-gasunitprice-1"></a> `gasUnitPrice?` | `string` | - |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | - |
| <a id="property-maxgasamount-1"></a> `maxGasAmount?` | `string` | The signed gas members, decimal strings: with the members above, the payment presented. |
| <a id="property-network-1"></a> `network` | `` `aptos:${number}` `` | - |
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-sender-2"></a> `sender` | `` `0x${string}` `` | - |
| <a id="property-sequencenumber-2"></a> `sequenceNumber` | `string` | Decimal strings. |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` | The facilitator's transaction hash, once named: a hint, since a fee payer's signature changes it. |

***

### AptosUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.kind` | `"aptos-transaction"` |

#### Methods

##### complete()

> **complete**(`signed`): [`Refusal`](index.md#refusal) \| `AptosPaymentPayload`

The payment of the signed transaction, once `reference` reads its keys; a transaction `reference` refuses gets the
code `reference` gives it, such as `aptos/chain-mismatch` for a transaction signed for a chain other than the
option's network.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | \{ `transaction`: `string`; \} |
| `signed.transaction` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| `AptosPaymentPayload`

## Type Aliases

### AptosNetwork

> **AptosNetwork** = `` `aptos:${number}` ``

CAIP-2: `aptos:` and the numeric chain id.

***

### AptosStatus

> **AptosStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `"committed"`, `bigint`\>

The answer of `aptosStatus`: positions are ledger versions, and the one mark is `committed`, a transaction the REST
endpoint serves as committed, which is final.

## Variables

### exactAptos

> `const` **exactAptos**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AptosUnsigned`](#aptosunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/aptos"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AptosRef`](#aptosref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`AptosStatus`](#aptosstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/aptos`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
transaction the payer signed and names its hash; `status` finds it by that hash, else by the payer's sender and
sequence number.

***

### MAX\_APTOS\_READ\_ITEMS

> `const` **MAX\_APTOS\_READ\_ITEMS**: `4096` = `4096`

The most events, and the most write-set changes, the read takes of one committed transaction: lcp's own bound on the
work one reader's answer asks of it. Aptos sets no count a REST answer is held to; an answer over it is `unparseable`.

***

### MAX\_APTOS\_TX\_BYTES

> `const` **MAX\_APTOS\_TX\_BYTES**: `number`

The largest Aptos transaction lcp decodes, in bytes: the chain's `max_transaction_size_in_bytes`, 64 KiB, beyond which
the chain refuses a transaction. A larger one is `aptos/tx-too-large`.

## Functions

### aptosIdDigest()

> **aptosIdDigest**(`i`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

SHA-256 over the RFC 8785 form of `{sender, sequenceNumber, function, typeArguments, arguments}`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`AptosInstrument`](#aptosinstrument) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### aptosStatus()

> **aptosStatus**(`ref`, `reader`, `query`): `Promise`\<[`AptosStatus`](#aptosstatus)\>

The read of the payment as the profile `x402/exact/aptos` states it, answered by the profile `read-status` at
coverage `none`. The act is the sender's committed transaction at the signed sequence number, found by the sender and
that number; a named hash is a hint, read first, since a fee payer's signature changes it, and a transaction the node
holds uncommitted ends nothing. The transaction found is classified from what landed: its signer, the sender, against
the option's payee; the account it names, the owner of each fungible-asset store a `Deposit` event credits, read from
the transaction's `ObjectCore` change at that store, against the payee; and whether it is another act the caller gave,
by its reference's sender and sequence number. A `settled` answer states `presented`: whether the transaction's
signed members, the sender, sequence number, entry function and arguments, gas members and expiry, are those the
reference holds. Where nothing is at the number, the account's own sequence number is read with that answer's ledger
time and history floor: a number the account has passed is consumed, its transaction not returned; one it has not
passed is live until the ledger's time in whole seconds reaches the signed expiry (aptos-core's
`transaction_validation.move` takes a transaction only while `timestamp::now_seconds() < txn_expiration_time`), and
unused after it, but only where the floor of each answer is at or below the position given, else `history-gap`. A
reader for another network, or a ledger for another chain, is `chain-mismatch`; a rejected read is `transport`, or by a
`ReaderError`'s kind `too-large` or `unparseable`; an answer of another shape, or a deposit whose store's owner the
answer does not show, or a committed answer without its events or its changes, is `unparseable`, never a transaction
that deposited nothing; a ref or query that is not one is `unparseable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`AptosRef`](#aptosref) |
| `reader` | [`AptosReader`](#aptosreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`AptosRef`](#aptosref), `bigint`, `"committed"`, `bigint`\> |

#### Returns

`Promise`\<[`AptosStatus`](#aptosstatus)\>

***

### committedInstrument()

> **committedInstrument**(`t`, `chainId`): [`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

The REST answer in the normal form: every address as `0x` and 64 lowercase hex, `{"inner": a}` as `a`, and the
amount as its decimal string. The REST answer carries no chain id, so the caller supplies the ledger's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `t` | [`AptosCommitted`](#aptoscommitted) |
| `chainId` | `number` |

#### Returns

[`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

***

### decodeAptosTx()

> **decodeAptosTx**(`transaction`): [`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

Reads the `RawTransaction` prefix of a base64 transaction, in either wire form: the scheme's BCS bytes, or x402's
reference form, base64 of the JSON `{"transaction": [bytes], "senderAuthenticator": [bytes]}`. Only an entry
function call to a framework fungible-asset transfer is accepted. Module, function and struct names are read as
their exact bytes, a leading U+FEFF included, and each must be an ASCII letter or underscore followed by up to 254
ASCII letters, digits and underscores, else `aptos/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `transaction` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
