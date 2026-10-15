---
title: "@integraledger/lcp/near"
description: "The exports of @integraledger/lcp/near."
---

# @integraledger/lcp/near

## Interfaces

### NearOutcome

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-delegate"></a> `delegate` | \{ `argsBase64`: `string`; `methodName`: `string`; `nonce`: `bigint`; `publicKey`: `string`; `receiverId`: `string`; `senderId`: `string`; \} \| `null` | The delegate action the relayed transaction carries: its `sender_id`, `public_key` and `nonce`, its `receiver_id`, and the `method_name` and base64 `args` of its first action's function call. The sender and the receiver are NEAR account ids, as nearcore's RPC writes them. |
| <a id="property-receipts"></a> `receipts` | readonly `object`[] | Each receipt's `executor_id`, a NEAR account id, and its outcome. |
| <a id="property-status"></a> `status` | `string` | `final_execution_status`. |

***

### NearReader

Bounded, read-only calls against one network's RPC. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable, except in `nearLapsed`, which answers false.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`NearNetwork`](#nearnetwork) | - |
| <a id="property-relayers"></a> `relayers` | `readonly` | readonly `string`[] | The relayer accounts the transaction is looked up under, the first four, each a NEAR account id. x402's NEAR scheme leaves relayer selection to the facilitator, which may list them under `/supported` `signers["near:*"]`. |

#### Methods

##### accessKeyNonce()

> **accessKeyNonce**(`account`, `publicKey`): `Promise`\<\{ `blockHeight`: `bigint`; `nonce`: `bigint`; \} \| `null`\>

`view_access_key` at "final" for the account and the key asked, which is written as nearcore's RPC writes a key: that
key's nonce and the `block_height` of the block whose state it reads; null: no such key.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `publicKey` | `string` |

###### Returns

`Promise`\<\{ `blockHeight`: `bigint`; `nonce`: `bigint`; \} \| `null`\>

##### finalHeight()

> **finalHeight**(): `Promise`\<`bigint`\>

`block` at finality "final": its header's height.

###### Returns

`Promise`\<`bigint`\>

##### txStatus()

> **txStatus**(`txHash`, `sender`): `Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

`EXPERIMENTAL_tx_status` with `wait_until` "NONE"; null: unknown.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txHash` | `string` |
| `sender` | `string` |

###### Returns

`Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

***

### NearRef

The read keys `reference` returns, JSON-serialisable: `nonce` and `maxBlockHeight` are decimal strings. `transaction`
is added when the facilitator names it.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-argsdigest"></a> `argsDigest` | `` `0x${string}` `` | SHA-256 of the signed `ft_transfer` arguments' bytes, `0x` and lowercase hex. |
| <a id="property-asset"></a> `asset` | `string` | - |
| <a id="property-maxblockheight"></a> `maxBlockHeight` | `string` | - |
| <a id="property-network-1"></a> `network` | [`NearNetwork`](#nearnetwork) | - |
| <a id="property-nonce"></a> `nonce` | `string` | - |
| <a id="property-payer"></a> `payer` | `string` | - |
| <a id="property-publickey"></a> `publicKey` | `string` | - |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

***

### NearUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | SHA-256 of the NEP-461-prefixed delegate action: what the key signs. |
| `request.hash` | `Uint8Array`\<`ArrayBuffer`\> | - |
| `request.kind` | `"near-delegate"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `NearPayment`

Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature. An Ed25519 signature whose last byte
is 0x20 or more is `x402/signature-malformed`: nearcore reads none, and a valid signature never has one.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | \{ `bytes`: `Uint8Array`; `keyType`: `0` \| `1`; \} |
| `signature.bytes` | `Uint8Array` |
| `signature.keyType` | `0` \| `1` |

###### Returns

[`Refusal`](index.md#refusal) \| `NearPayment`

## Type Aliases

### NearNetwork

> **NearNetwork** = `"near:mainnet"` \| `"near:testnet"`

x402's NEAR network identifiers.

***

### NearStatus

> **NearStatus** = \{ `finality`: `"final"` \| `"optimistic"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"in-flight"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"not-this-instrument"` \| `"transfer-failed"`; \}

## Variables

### exactNear

> `const` **exactNear**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearUnsigned`](#nearunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/near"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearRef`](#nearref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`NearStatus`](#nearstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### FT\_TRANSFER\_GAS

> `const` **FT\_TRANSFER\_GAS**: `30000000000000n` = `30_000_000_000_000n`

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
`AccountId`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedDelegateAction` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `asset`: `string`; `h`: `` `0x${string}` ``; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `publicKey`: `string`; \}

***

### nearLapsed()

> **nearLapsed**(`ref`, `reader`): `Promise`\<`boolean`\>

True only when the delegate action can never execute: the final height, read first, is past `maxBlockHeight`, and
the key's nonce, read at a block height at or past that final height, is below the action's. A key read that lags
the final height read first is false. A key that does not exist is false, because a key deleted after the delegate
executed gives the same answer. Two calls; a failed or malformed read, or a ref or reader that is not an object, is
false. The key is read only for the delegate's own key, the ref's `publicKey` in the form nearcore's RPC writes it
and `reference` copies from the delegate (`ed25519:` and the base58 of 32 bytes, or `secp256k1:` and of 64), since
the reader's answer names no key: it is the answer for the key asked. A ref whose public key is in any other form,
another spelling of a key included, or names no key, is false with nothing read, as `nearStatus` reads it as
unreadable; so is a ref whose payer is not a NEAR account id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`NearRef`](#nearref) |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<`boolean`\>

***

### nearRecover()

> **nearRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Recovers the hash from the settlement transaction: the `memo` in its delegated `ft_transfer` arguments. A transaction
that carries no delegate action, or whose delegate calls another method, is `near/not-ft-transfer`, as `nearStatus`
answers it failed `not-this-instrument`; one that no relayer the reader lists knows is `near/not-found`. A failed
read, an outcome that is not well formed (a delegate sender or receiver, or a receipt's executor, that is not a NEAR
account id among them), or a delegate whose arguments are not base64 in its canonical form (RFC 4648 §3.5), an answer
out of the reader's documented form, is `near/unreadable`, as `nearStatus` answers it pending. A ref that names no
`transaction` string is `near/wrong-reader`, and a relayer list that is empty or whose first four are not each a NEAR
account id is `near/no-relayer`, each with nothing read. The arguments are read for their `memo` alone: the hash a
transaction carries is recovered whatever its transfer's outcome.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: [`NearNetwork`](#nearnetwork); `transaction`: `string`; \} |
| `ref.network` | [`NearNetwork`](#nearnetwork) |
| `ref.transaction` | `string` |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### nearStatus()

> **nearStatus**(`ref`, `reader`): `Promise`\<[`NearStatus`](#nearstatus)\>

Finds the relayed transaction under each relayer the reader lists (at most four), then requires its delegate to be
the instrument the ref names, and reads the receipts the token contract executed: a failure is failed, a success
is settled. The delegate is that instrument when its sender, key and nonce are the ref's, it calls `ft_transfer` on
`ref.asset`, and the SHA-256 of its arguments is `ref.argsDigest`; any other delegate, a second one the payer signed
on the same nonce included, is failed `not-this-instrument`. The digest identifies the signed instrument; nothing in
the arguments is compared with the ATR's content. Settled is `final` only when `final_execution_status` is `FINAL`,
every receipt's block then being final; any other status, `EXECUTED` included, is `optimistic`. A failed read, a
reader for another network, an outcome that is not well formed (a delegate sender or receiver, or a receipt's
executor, that is not a NEAR account id among them), or a delegate whose arguments are not base64 in its canonical
form (RFC 4648 §3.5) is pending. A ref whose nonce, asset, payer, public key or digest is malformed, or a relayer list
that is empty or whose first four are not each a NEAR account id, is pending `unreadable`, with nothing read: the
asset and the payer must be NEAR account ids, and the public key `ed25519:` and the base58 of 32 bytes or
`secp256k1:` and of 64. A NEAR account id is 2 to 64 characters, each a lowercase ASCII letter, a digit, `-`, `_` or
`.`, where a separator (`-`, `_` or `.`) is never first, never last, and never follows another (near-account-id's
`AccountId`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`NearRef`](#nearref) & `object` |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<[`NearStatus`](#nearstatus)\>
