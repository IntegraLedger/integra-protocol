---
title: "@integraledger/lcp/near"
description: "NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it."
---

# @integraledger/lcp/near

NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose
`memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it.

The read finds the payer's act by the payer's access key, through a bounded reader, and searches every access key of
the payer's account for H.

## Interfaces

### NearChoice

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-accesskeynonce"></a> `accessKeyNonce` | `bigint` | `view_access_key`'s nonce for the key. |
| <a id="property-finalheight"></a> `finalHeight` | `bigint` | `block` at finality "final": its height. |
| <a id="property-payer"></a> `payer` | `string` | The payer's account: a NEAR account id, as nearcore reads a delegate action's sender, or `x402/option-malformed`. |
| <a id="property-publickey"></a> `publicKey` | `string` | The access key, read as nearcore's `PublicKey::from_str` reads it: the key type before the first `:`, `ed25519` or `secp256k1` in ASCII letters of either case, or no key type, which is Ed25519; then the base58 of exactly that type's key size, 32 bytes or 64. Any other text is `x402/option-malformed`. |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |

***

### NearFunctionCall

A function call of a delegate action: its method, its base64 arguments, its gas, and its deposit in yoctoNEAR.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-argsbase64"></a> `argsBase64` | `string` |
| <a id="property-deposit"></a> `deposit` | `bigint` |
| <a id="property-gas"></a> `gas` | `bigint` |
| <a id="property-methodname"></a> `methodName` | `string` |

***

### NearKeyChange

One change of an access key, as the RPC's `changes` answers it for `single_access_key_changes` and
`all_access_key_changes` (https://docs.near.org/api-reference/post-changes, read 2026-11-16): the height of the
block it is in; the key, written as the RPC writes one; the key's nonce after it, or null where it deleted the key
(`access_key_deletion`); and, where the reader can name them, the transaction that carried it and that
transaction's signer. The change's `cause` names a transaction (`transaction_processing`) or a receipt
(`receipt_processing`), which for a delegate action is the receipt the relayer's transaction made; the reader names
the transaction from it where it can, as a run on `near:testnet` showed (the profile `x402-exact-near-memo`, rule 9).

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-height"></a> `height` | `readonly` | `bigint` |
| <a id="property-nonce"></a> `nonce` | `readonly` | `bigint` \| `null` |
| <a id="property-publickey-1"></a> `publicKey` | `readonly` | `string` |
| <a id="property-transaction"></a> `transaction?` | `readonly` | `object` |
| `transaction.hash` | `readonly` | `string` |
| `transaction.signer` | `readonly` | `string` |

***

### NearOutcome

A transaction as nearcore's `EXPERIMENTAL_tx_status` answers it (NEAR RPC, `RpcTransactionResponse`,
https://docs.near.org/api-reference/post-experimental_tx_status, read 2026-11-16).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-delegate"></a> `delegate` | \{ `actions`: readonly ([`NearFunctionCall`](#nearfunctioncall) \| `null`)[]; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `publicKey`: `string`; `receiverId`: `string`; `senderId`: `string`; \} \| `null` | The delegate action the transaction carries, as the RPC writes a `Delegate` action's `delegate_action` (NEP-366): its `sender_id`, `public_key`, `nonce`, `max_block_height` and `receiver_id`, and its actions in order, each a `FunctionCall` or null for an action of any other kind. The sender and the receiver are NEAR account ids, and the key is written as the RPC writes one. Null: the transaction carries no delegate action. |
| <a id="property-receipts"></a> `receipts` | readonly `object`[] | Each receipt of `receipts_outcome`: its `id`, its `executor_id`, a NEAR account id, its outcome (`SuccessValue` or `SuccessReceiptId` as `success`, `Failure` as `failure`, `Unknown` as `pending`), and the height of the block it executed in, which the reader reads from the outcome's `block_hash`, absent while it has not executed. |
| <a id="property-status"></a> `status` | `string` | `final_execution_status`: `FINAL` once the transaction and all its receipts are in final blocks. |

***

### NearReader

Bounded, read-only calls against one network's RPC (https://docs.near.org/api/rpc/introduction, read 2026-11-16).
Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`: a `ReaderError` reads by its
kind (`too-large` as `too-large`, `malformed` as `unparseable`), any other rejection as `transport`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`NearNetwork`](#nearnetwork) |

#### Methods

##### accessKeyChanges()

> **accessKeyChanges**(`account`, `publicKey`, `from`, `to`): `Promise`\<[`NearKeyChanges`](#nearkeychanges)\>

`changes` `single_access_key_changes` for the account's one key, block by block from `from` to `to`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `publicKey` | `string` |
| `from` | `bigint` |
| `to` | `bigint` |

###### Returns

`Promise`\<[`NearKeyChanges`](#nearkeychanges)\>

##### accessKeyNonce()

> **accessKeyNonce**(`account`, `publicKey`, `finality`): `Promise`\<\{ `blockHeight`: `bigint`; `nonce`: `bigint` \| `null`; \}\>

`query` `view_access_key` at the finality asked, "final" or "optimistic" (the latest head), for the account and the
key, written as the RPC writes one: the key's nonce, or null where the account holds no such key, and the
`block_height` of the block whose state the answer reads, which the RPC gives in both answers.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `publicKey` | `string` |
| `finality` | [`NearMark`](#nearmark) |

###### Returns

`Promise`\<\{ `blockHeight`: `bigint`; `nonce`: `bigint` \| `null`; \}\>

##### accountKeyChanges()

> **accountKeyChanges**(`account`, `from`, `to`): `Promise`\<[`NearKeyChanges`](#nearkeychanges)\>

`changes` `all_access_key_changes` for every key of the account, block by block from `from` to `to`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `from` | `bigint` |
| `to` | `bigint` |

###### Returns

`Promise`\<[`NearKeyChanges`](#nearkeychanges)\>

##### finalHeight()

> **finalHeight**(): `Promise`\<`bigint`\>

`block` at finality "final": its header's height.

###### Returns

`Promise`\<`bigint`\>

##### txStatus()

> **txStatus**(`txHash`, `sender?`): `Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

`EXPERIMENTAL_tx_status` with `wait_until` "NONE", for the transaction's hash and its signer's account where the
read knows it (the RPC's `sender_account_id`); null: unknown. The RPC refuses a hash named without its signer,
so a reader resolves the signer itself, as a seller's reader can from the accounts that relayed its payments (the
profile `x402-exact-near-memo`, rule 9).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txHash` | `string` |
| `sender?` | `string` |

###### Returns

`Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

***

### NearRef

The read keys `reference` returns, JSON-serialisable: the option's payee (`payTo`), the key of the read's two party
tests; the network; and the delegate action the payer signed, whole, its signature apart: its sender (`payer`), its
receiver (`asset`), its key, `nonce` and `maxBlockHeight` as decimal strings, and its one function call, an
`ft_transfer` whose arguments are held by their SHA-256 (`argsDigest`, `0x` and lowercase hex) with its `gas` and
`deposit` as decimal strings; and `h`, the hash its memo carries. `transaction` is a hint where a settler names one: it
shortens the search and proves nothing.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-argsdigest"></a> `argsDigest` | `` `0x${string}` `` |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-deposit-1"></a> `deposit` | `string` |
| <a id="property-gas-1"></a> `gas` | `string` |
| <a id="property-h"></a> `h` | `` `0x${string}` `` |
| <a id="property-maxblockheight"></a> `maxBlockHeight` | `string` |
| <a id="property-network-1"></a> `network` | [`NearNetwork`](#nearnetwork) |
| <a id="property-nonce-1"></a> `nonce` | `string` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |
| <a id="property-publickey-2"></a> `publicKey` | `string` |
| <a id="property-transaction-1"></a> `transaction?` | `string` |

***

### NearUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | What the key signs. `delegateAction` is the borsh of the NEP-366 `DelegateAction`; `hash` is the SHA-256 of the NEP-461 prefix, `NEP461_DELEGATE` as a little-endian u32, followed by those bytes. `nearRequest` reads them. |
| `request.delegateAction` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.hash` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.kind` | `"near-delegate"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`NearPayment`](index.md#nearpayment)

Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature. An Ed25519 signature whose last byte
is 0x20 or more is `x402/signature-malformed`: nearcore reads none, and a valid signature never has one.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | \{ `bytes`: `Uint8Array`; `keyType`: `0` \| `1`; \} |
| `signature.bytes` | `Uint8Array` |
| `signature.keyType` | `0` \| `1` |

###### Returns

[`Refusal`](index.md#refusal) \| [`NearPayment`](index.md#nearpayment)

## Type Aliases

### Answer

> **Answer** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, [`NearMark`](#nearmark), `bigint`\>

***

### NearKeyChanges

> **NearKeyChanges** = \{ `changes`: readonly [`NearKeyChange`](#nearkeychange)[]; `through`: `bigint`; \} \| \{ `history`: `"missing"`; \}

A range read of access-key changes: every change in the blocks from `from` to `through`, the last height the reader
read, at most the range's end, a height with no block holding none; or `history: "missing"` where the node holds no
block at the range's start (the RPC's `GARBAGE_COLLECTED_BLOCK` or `UNKNOWN_BLOCK` for a height it should hold).

***

### NearMark

> **NearMark** = `"optimistic"` \| `"final"`

The marks of a NEAR read, lowest first: optimistic (the latest head) and `FINAL`, the final mark.

***

### NearNetwork

> **NearNetwork** = `"near:mainnet"` \| `"near:testnet"`

x402's NEAR network identifiers.

***

### NearQuery

> **NearQuery** = [`StatusQuery`](index.md#statusquery)\<[`NearRef`](#nearref), `bigint`, [`NearMark`](#nearmark), `bigint`\>

What `status` takes beside the reference and the reader, as the profile `read-status` states it: positions and the
search position are block heights.

***

### NearStatus

> **NearStatus** = [`Answer`](#answer)

The answer of `status`, as the profile `read-status` gives it, positions being block heights. A `settled` answer
states `presented`: `yes` where the delegate action it settled on is, member by member, the one the reference was
built from, `no` where a member differs, `unshown` where the read could not read the delegate. Each transfer it names
in `moved` is named by the transaction and, as `place`, the id of the receipt the token contract executed for it.

## Variables

### exactNear

> `const` **exactNear**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearUnsigned`](#nearunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/near"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearRef`](#nearref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`Answer`](#answer)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/near`. The payee broadcasts (`broadcaster` answers `"payee"`): a relayer of the seller's facilitator
submits the delegate action the payer signed; `status` finds it by the payer's access key and searches every key of
the payer's account for H.

***

### FT\_TRANSFER\_GAS

> `const` **FT\_TRANSFER\_GAS**: `30000000000000n` = `30_000_000_000_000n`

***

### MAX\_FT\_TRANSFER\_ARGS\_BYTES

> `const` **MAX\_FT\_TRANSFER\_ARGS\_BYTES**: `4096` = `4096`

The longest `ft_transfer` arguments lcp reads, in bytes: lcp's own resource bound. NEP-141 sets no size for a memo;
the bound holds the arguments lcp's client writes, a NEAR account id, a 128-bit amount and an LCP string, many times
over, and bounds the JSON every read of the arguments parses.

***

### MAX\_SIGNED\_DELEGATE\_BASE64

> `const` **MAX\_SIGNED\_DELEGATE\_BASE64**: `8192` = `8192`

The longest `signedDelegateAction` lcp decodes, in base64 characters: lcp's own resource bound. x402's NEAR scheme
sets no size for it; it bounds the text `bound`, `reference` and `nearCarrier` decode before anything is read, and
holds a delegate whose one `ft_transfer` carries arguments of `MAX_FT_TRANSFER_ARGS_BYTES`.

***

### NEP461\_DELEGATE

> `const` **NEP461\_DELEGATE**: `1073742190` = `1073742190`

The NEP-461 prefix for a delegate action: (1 << 30) + 366.

## Functions

### ftTransferArgs()

> **ftTransferArgs**(`payTo`, `amount`, `h`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

`ft_transfer`'s arguments: `receiver_id`, `amount` and `memo`, in that order, as `JSON.stringify` writes them. A
`payTo` that is not a NEAR account id, or an `amount` that is not the canonical decimal string of a positive integer
below 2^128, is `near/option-malformed`, as the option filter answers an option carrying it, since the token contract
reads `receiver_id` as an `AccountId` and `amount` as a `U128` and refuses anything else; then a value that is not a
32-byte hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payTo` | `string` |
| `amount` | `string` |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### nearCarrier()

> **nearCarrier**(`signedDelegateAction`): [`Refusal`](index.md#refusal) \| \{ `asset`: `string`; `h`: `` `0x${string}` ``; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `publicKey`: `string`; \}

Reads a base64 `SignedDelegateAction` whose one action is a `FunctionCall` of `ft_transfer` with a JSON object of
arguments whose `receiver_id` is a NEAR account id and whose `memo` is an LCP string. The bytes are read in the order
nearcore reads them: the sender and the receiver, where one that is not UTF-8, or not a NEAR account id, is
`near/sda-malformed`, then the count of actions, where a count other than one is `near/actions`, then the action's
variant index, where any index other than `FunctionCall`'s is `near/not-ft-transfer`, the bytes after it unread.
Otherwise the bytes must be exactly the borsh encoding of what is read, every string in it UTF-8, the key and the
signature each Ed25519 or secp256k1, and an Ed25519 signature's last byte below 0x20, as nearcore reads one, or they
are `near/sda-malformed`. The arguments are strict UTF-8 JSON text whose leading byte-order mark is kept as a
character, so arguments that begin with one are `near/args-malformed`. So are arguments the token contract refuses:
it reads them as near-sdk does, with serde's derived reader over `receiver_id: AccountId`, `amount: U128` and
`memo: Option<String>`. Those are arguments whose object names `receiver_id`, `amount` or `memo` more than once, each
key read with its escapes decoded, or has a key that decodes to a lone surrogate, or whose `receiver_id` is not a NEAR
account id, or whose `amount` is not a string of an optional `+` and one or more ASCII digits below 2^128, leading
zeros allowed (Rust's `u128::from_str`). Any other key is ignored, however often it repeats. Then a `memo` that is not
a string is `near/memo-missing`, and one that is not an LCP string `near/memo-not-lcp`. The amount is not compared
with the option's. A NEAR account id is 2 to 64 characters, each a lowercase ASCII letter, a digit, `-`, `_` or `.`,
where a separator (`-`, `_` or `.`) is never first, never last, and never follows another (near-account-id's
`AccountId`). borsh reads the bytes from the sender on, the action count and variant included. Without it, a value
that is not a string, is too long or is not base64 gets the code it gets with borsh, as those checks need no peer,
and any other value is `near/peer-missing`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedDelegateAction` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `asset`: `string`; `h`: `` `0x${string}` ``; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `publicKey`: `string`; \}

***

### nearRecover()

> **nearRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from a transaction: the `memo` in its delegate action's one `ft_transfer`. The input is
`{network, tx, option}`: the network, the transaction's hash, and the option the payment answers, an object, of which
the read needs no member; the transaction is read by its hash alone, its signer unknown. A transaction that carries no
delegate action, or whose delegate's one action is not a function call of `ft_transfer`, is `near/not-ft-transfer`,
and one with more than one action `near/actions`; one the reader does not know is `near/not-found`. A failed read, an
outcome that is not well formed, or a delegate whose arguments are not base64 in its canonical form (RFC 4648 §3.5) is
`near/unreadable`. An input that is not one, a reader for another network, a `tx` that is not a non-empty string, or
an option that is not an object, is `near/wrong-reader`, with nothing read. The arguments are read as `nearCarrier`
reads them, as the token contract reads them: arguments over the size bound, not UTF-8 JSON, not an object, or that
the contract refuses are `near/args-malformed`; then a `memo` that is not a string is `near/memo-missing`, and one
that is not an LCP string `near/memo-not-lcp`. The hash is recovered whatever the transfer's outcome.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`NearNetwork`](#nearnetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### nearRequest()

> **nearRequest**(`delegateAction`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `asset`: `string`; `deposit`: `bigint`; `gas`: `bigint`; `h`: `` `0x${string}` ``; `hash`: `Uint8Array`\<`ArrayBuffer`\>; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `payTo`: `string`; `publicKey`: `string`; \}\>

Reads the delegate action a `near-delegate` request carries, its borsh bytes, as `nearCarrier` reads the delegate
action of a signed one, with its codes, and gives `hash`, the SHA-256 of the NEP-461 prefix followed by those bytes,
which is the request's `hash` when the bytes are its `delegateAction`. It gives every member the bytes hold: the
sender (`payer`) and its access key, the token contract (`asset`, the receiver), the one function call's gas and
attached deposit in yoctoNEAR, the nonce, `maxBlockHeight`, the last block height at which the action can run, and
the `ft_transfer` arguments' `receiver_id` (`payTo`), `amount` and the hash in `memo`. A delegate action holds one
action, an `ft_transfer`, or it is refused, so nothing else runs under the signature. A value that is not a
`Uint8Array` is `near/sda-malformed`, and bytes longer than those of the longest signed delegate action lcp decodes
are `near/sda-too-large`; without borsh, bytes within the bound are `near/peer-missing`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `delegateAction` | `Uint8Array` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `amount`: `string`; `asset`: `string`; `deposit`: `bigint`; `gas`: `bigint`; `h`: `` `0x${string}` ``; `hash`: `Uint8Array`\<`ArrayBuffer`\>; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `payTo`: `string`; `publicKey`: `string`; \}\>

***

### nearStatus()

> **nearStatus**(`ref`, `reader`, `query`): `Promise`\<[`Answer`](#answer)\>

Answers `status` as the profile `read-status` gives it, from what the read observed. The read holds the single-use
value, the payer's access key's nonce, read at `final` and at the latest head; and, from the block after the
position the caller gives (the first block where it gives none):
- the access-key search: where the nonce is read at or past the signed one, the changes of that key up to the block it
  was read so at, for the change that carried the nonce to or past the signed one, and the transaction that carried it;
- the search for H: the changes of every access key of the payer's account up to the latest head the reader serves,
  each read through the transaction that carried it, from the search position an earlier answer returned where the
  caller gives one;
- the transaction the reference names as a hint, which proves nothing and stops no search.
A transaction read is a delegate of the payer's that carries H where one of its function calls is an `ft_transfer`
or `ft_transfer_call` whose memo is H's LCP string, read as the token contract reads the arguments; it is this
pairing's kind where it holds exactly one action, an `ft_transfer`. Its signer is the delegate's sender, compared with
the reference's payer and the option's payee; the account it names is its `receiver_id`, compared with the payee; it
consumed the single-use value where it carried the key's nonce to or past the signed one; it succeeded where the
payer's account ran the delegate and the token contract's receipt for it succeeded, and failed where either failed;
and one whose token receipt has not run is kept below the final mark. Its mark is `final` where the RPC's
`final_execution_status` is `FINAL` and its change is at or below the final height, `optimistic` otherwise. What it
moved is the transfer the token contract ran: the token, the amount the arguments name and the `receiver_id`, named
by the transaction and, as `place`, the id of the token contract's receipt. A transaction it is given as another act
under the same H is matched by its hash, or, given by its reference, by the delegate's sender, key and nonce. A
change whose transaction the reader cannot name stops the search at the block before it; a transaction it cannot
read is named as one the search could not decode, held at the block before it, and the search reads on (one the
caller gave is named `given`). The value is read at the final mark and at the latest head: consumed where the nonce
is at or past the signed one; lapsed where it is below the signed one at a block past `max_block_height`; a key that
is absent at either read leaves the value unread, and holds the search short of whole whatever it reads, since the
value may have been taken before the key went: such a read answers `pending`, `search-incomplete`, never `not-found`.
No run has yet shown the search across the account's keys whole, so the search is never read whole, and every
`failed` but `before-position` answers `pending`, `search-incomplete`.
A `settled` answer states `presented`: `yes` where the delegate is, member by member, the one the reference holds,
`no` otherwise. A read
that rejects is unreadable by its reason; an answer outside the reader's documented form, a change outside the range
asked among them, `unparseable`; a range the node holds no history for, `history-gap`; a reader for another network
than the reference's, `chain-mismatch`; a reference, reader or query that is not one, `unparseable`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`NearRef`](#nearref) |
| `reader` | [`NearReader`](#nearreader) |
| `query` | [`NearQuery`](#nearquery) |

#### Returns

`Promise`\<[`Answer`](#answer)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### NearPayment

Re-exports [NearPayment](index.md#nearpayment)

***

### X402Payment

Re-exports [X402Payment](index.md#x402payment)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)
