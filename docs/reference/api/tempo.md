---
title: "@integraledger/lcp/tempo"
description: "Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel reserve's descriptor and ids, and the account keychain's key authorizations."
---

# @integraledger/lcp/tempo

Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel
reserve's descriptor and ids, and the account keychain's key authorizations.

Tempo serves eip155 JSON-RPC, so the reader is `EvmReader`. Nothing here throws on a caller's value; refusals are
values.

## Interfaces

### KeyAuthorizationUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | `digest` is keccak256(rlp(authorization)); the root key signs it. |
| `request.authorization` | [`TempoKeyAuthorization`](#tempokeyauthorization) | - |
| `request.digest` | `` `0x${string}` `` | - |
| `request.kind` | `"tempo-key-authorization"` | - |

#### Methods

##### complete()

> **complete**(`rootSignature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](mpp.md#mppcredential)

The credential for the root key's signature over `digest`, checked in `bound`'s order: a credential over the
credential size bound, 64 KiB, its echoed challenge included, is `mpp/credential-malformed`, then a signed key
authorization over 8,192 bytes is `tempo/key-authorization-malformed`, as `bound` refuses each.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `rootSignature` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](mpp.md#mppcredential)

***

### TempoCall

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-input"></a> `input` | `Uint8Array`\<`ArrayBuffer`\> |
| <a id="property-to"></a> `to` | `` `0x${string}` `` \| `null` |
| <a id="property-value"></a> `value` | `bigint` |

***

### TempoDescriptor

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner` | `` `0x${string}` `` |
| <a id="property-expiringnoncehash"></a> `expiringNonceHash` | `` `0x${string}` `` |
| <a id="property-operator"></a> `operator` | `` `0x${string}` `` |
| <a id="property-payee"></a> `payee` | `` `0x${string}` `` |
| <a id="property-payer"></a> `payer` | `` `0x${string}` `` |
| <a id="property-salt"></a> `salt` | `` `0x${string}` `` |
| <a id="property-token"></a> `token` | `` `0x${string}` `` |

***

### TempoKeyAuthorization

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-allowedcalls"></a> `allowedCalls` | `object`[] |
| <a id="property-chainid"></a> `chainId` | `bigint` |
| <a id="property-expiry"></a> `expiry` | `bigint` |
| <a id="property-keyid"></a> `keyId` | `` `0x${string}` `` |
| <a id="property-keytype"></a> `keyType` | `0` \| `1` \| `2` |
| <a id="property-limits"></a> `limits` | `object`[] |
| <a id="property-witness"></a> `witness` | `` `0x${string}` `` |

***

### TempoSearchReader

A reader of a Tempo network: an `EvmSearchReader` that also reads a storage slot, an account's protocol nonce and the
transactions of a block, each in the state after the block named. Every failure rejects.

#### Extends

- [`EvmSearchReader`](mpp.md#evmsearchreader)

#### Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `eip155:${string}` `` \| [`HederaNetwork`](evm.md#hederanetwork) | [`EvmSearchReader`](mpp.md#evmsearchreader).[`network`](mpp.md#property-network-1) |

#### Methods

##### block()

> **block**(`at`): `Promise`\<\{ `number`: `bigint`; `timestamp`: `bigint`; \}\>

`eth_getBlockByNumber(at, false)`: the block's number and its timestamp, in seconds.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `at` | `bigint` \| `"safe"` \| `"finalized"` \| `"latest"` |

###### Returns

`Promise`\<\{ `number`: `bigint`; `timestamp`: `bigint`; \}\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`block`](mpp.md#block)

##### blockNumber()

> **blockNumber**(`tag`): `Promise`\<`bigint`\>

`eth_getBlockByNumber(tag, false).number`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tag` | `"safe"` \| `"finalized"` |

###### Returns

`Promise`\<`bigint`\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`blockNumber`](mpp.md#blocknumber)

##### blockTransactions()

> **blockTransactions**(`block`): `Promise`\<readonly `` `0x${string}` ``[]\>

`eth_getBlockByNumber(block, false)`'s `transactions`: the hashes of the block's transactions, in its order.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `block` | `bigint` |

###### Returns

`Promise`\<readonly `` `0x${string}` ``[]\>

##### call()

> **call**(`to`, `data`, `block`): `Promise`\<`` `0x${string}` ``\>

`eth_call` of `data` to the contract `to`, in the state after block `block`: the return data.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `to` | `` `0x${string}` `` |
| `data` | `` `0x${string}` `` |
| `block` | `bigint` |

###### Returns

`Promise`\<`` `0x${string}` ``\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`call`](mpp.md#call)

##### logs()

> **logs**(`filter`): `Promise`\<readonly [`EvmLogEntry`](mpp.md#evmlogentry)[]\>

`eth_getLogs` over `[fromBlock, toBlock]`: `address` absent reads every contract, and each topic is matched by its
position, `null` matching any.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `filter` | \{ `address?`: `` `0x${string}` ``; `fromBlock`: `bigint`; `toBlock`: `bigint`; `topics`: readonly (`` `0x${string}` `` \| `null`)[]; \} |
| `filter.address?` | `` `0x${string}` `` |
| `filter.fromBlock` | `bigint` |
| `filter.toBlock` | `bigint` |
| `filter.topics` | readonly (`` `0x${string}` `` \| `null`)[] |

###### Returns

`Promise`\<readonly [`EvmLogEntry`](mpp.md#evmlogentry)[]\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`logs`](mpp.md#logs)

##### nonceAt()

> **nonceAt**(`account`, `block`): `Promise`\<`bigint`\>

`eth_getTransactionCount(account, block)`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `` `0x${string}` `` |
| `block` | `bigint` |

###### Returns

`Promise`\<`bigint`\>

##### raw()

> **raw**(`tx`): `Promise`\<`` `0x${string}` `` \| `null`\>

`eth_getRawTransactionByHash`: the signed transaction's bytes; null when the node holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<`` `0x${string}` `` \| `null`\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`raw`](mpp.md#raw)

##### receipt()

> **receipt**(`tx`): `Promise`\<[`EvmReceipt`](evm.md#evmreceipt) \| `null`\>

`eth_getTransactionReceipt`; null when the node holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`EvmReceipt`](evm.md#evmreceipt) \| `null`\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`receipt`](mpp.md#receipt)

##### storageAt()

> **storageAt**(`address`, `slot`, `block`): `Promise`\<`` `0x${string}` ``\>

`eth_getStorageAt(address, slot, block)`: the 32-byte word.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `` `0x${string}` `` |
| `slot` | `` `0x${string}` `` |
| `block` | `bigint` |

###### Returns

`Promise`\<`` `0x${string}` ``\>

##### transaction()

> **transaction**(`tx`): `Promise`\<[`EvmTransaction`](evm.md#evmtransaction) \| `null`\>

`eth_getTransactionByHash`: the sender, the recipient (null for a contract creation) and the calldata; null when
none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`EvmTransaction`](evm.md#evmtransaction) \| `null`\>

###### Inherited from

[`EvmSearchReader`](mpp.md#evmsearchreader).[`transaction`](mpp.md#transaction)

## Variables

### ACCESS\_KEY\_SPEND\_TOPIC

> `const` **ACCESS\_KEY\_SPEND\_TOPIC**: `"0xe0815e3aaadddf4dd75bde97fc060f0c38afe18e87a169be86a3f5c28247f192"`

AccessKeySpend(address,address,address,uint256,uint256): the account, the key id and the token are topics 1 to 3; the
keychain emits it for each spend an access key with enforced limits makes against its limit.

***

### ACCOUNT\_KEYCHAIN

> `const` **ACCOUNT\_KEYCHAIN**: `"0xaaaaaaaa00000000000000000000000000000000"`

The account keychain precompile.

***

### CHANNEL\_CLOSED\_V1\_TOPIC

> `const` **CHANNEL\_CLOSED\_V1\_TOPIC**: `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"`

ChannelClosed(bytes32,address,address,uint256,uint256), the v1 escrow's event.

***

### CHANNEL\_CLOSED\_V2\_TOPIC

> `const` **CHANNEL\_CLOSED\_V2\_TOPIC**: `"0x5613aed96d5bf39f928408dbe1d4143490b9bb5957eac2dd8e69b5dc4b2206e6"`

ChannelClosed(bytes32,address,address,uint96,uint96)

***

### CHANNEL\_OPENED\_V1\_TOPIC

> `const` **CHANNEL\_OPENED\_V1\_TOPIC**: `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"`

ChannelOpened(bytes32,address,address,address,address,bytes32,uint256), the v1 escrow's event as it is deployed and as
`mppx`'s legacy escrow ABI has it (0.15.0 `dist/tempo/legacy/session/escrow.abi.js:517-561`): the channel id, the payer
and the payee indexed; the token, the authorized signer, the salt and the deposit, data words 0 to 3.

***

### CHANNEL\_OPENED\_V2\_TOPIC

> `const` **CHANNEL\_OPENED\_V2\_TOPIC**: `"0xdebaba36f0e9c7978f536fed432d9360b1f9646d7ca88531c34c3eae43f154a7"`

ChannelOpened(bytes32,address,address,address,address,address,bytes32,bytes32,uint96)

***

### KEY\_AUTHORIZATION\_WITNESS\_TOPIC

> `const` **KEY\_AUTHORIZATION\_WITNESS\_TOPIC**: `"0x1f09d8956d18ea185372a3f7f40aca24bb45f303920c37c5f0605f4871da41f6"`

KeyAuthorizationWitness(address,bytes32)

***

### KEY\_REVOKED\_TOPIC

> `const` **KEY\_REVOKED\_TOPIC**: `"0x14ce4f0c8c12936436b733974fb13d10fc13e8c41c06dc8e19d82001c93d7989"`

KeyRevoked(address,address)

***

### OPEN\_V1\_SELECTOR

> `const` **OPEN\_V1\_SELECTOR**: `"0xc79ea485"`

open(address,address,uint128,bytes32,address)

***

### OPEN\_V2\_SELECTOR

> `const` **OPEN\_V2\_SELECTOR**: `"0xedc53b00"`

open(address,address,address,uint96,bytes32,address)

***

### RECEIVE\_POLICY\_GUARD

> `const` **RECEIVE\_POLICY\_GUARD**: `"0xb10c000000000000000000000000000000000000"`

Where a Tempo receive policy sends a blocked transfer.

***

### TIP20\_CHANNEL\_RESERVE

> `const` **TIP20\_CHANNEL\_RESERVE**: `"0x4d50500000000000000000000000000000000000"`

The TIP-20 channel reserve precompile.

***

### TRANSFER\_WITH\_MEMO\_SELECTOR

> `const` **TRANSFER\_WITH\_MEMO\_SELECTOR**: `"0x95777d59"`

The first four bytes of keccak256("transferWithMemo(address,uint256,bytes32)").

***

### TRANSFER\_WITH\_MEMO\_TOPIC

> `const` **TRANSFER\_WITH\_MEMO\_TOPIC**: `"0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0"`

keccak256("TransferWithMemo(address,address,uint256,bytes32)")

## Functions

### decodeKeyAuthorization()

> **decodeKeyAuthorization**(`signed`): [`Refusal`](index.md#refusal) \| \{ `allowedCalls`: `object`[]; `digest`: `` `0x${string}` ``; `keyId`: `` `0x${string}` ``; `limits`: `object`[]; `witness?`: `` `0x${string}` ``; \}

Reads a signed key authorization: an RLP list of the authorization (3 to 9 items) and a byte-string signature. The
digest is keccak256 over the authorization's bytes as received. The witness is item 6, 32 bytes, when present. The
scope the payer signed is item 4, the limits (each a 20-byte token, a limit and, when non-zero, a period; an absent
period is 0), and item 5, the allowed calls (each a 20-byte target and its selector rules, each a 4-byte selector and
20-byte recipients). An absent item and an empty list both read as an empty list, though Tempo gives them opposite
meanings (absent: no limit or no call restriction; empty: no spending or no calls).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `allowedCalls`: `object`[]; `digest`: `` `0x${string}` ``; `keyId`: `` `0x${string}` ``; `limits`: `object`[]; `witness?`: `` `0x${string}` ``; \}

***

### decodeTempoTx()

> **decodeTempoTx**(`wire`): [`Refusal`](index.md#refusal) \| \{ `calls`: [`TempoCall`](#tempocall)[]; `chainId`: `bigint`; `validBefore`: `bigint` \| `null`; \}

The chain id, the calls and `valid_before` of a signed `0x76` transaction. Each call is `rlp([to, value, input])`,
with an empty `to` read as null and `input` a copy of `wire`'s bytes. `valid_before` written empty is null.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `calls`: [`TempoCall`](#tempocall)[]; `chainId`: `bigint`; `validBefore`: `bigint` \| `null`; \}

***

### encodeKeyAuthorization()

> **encodeKeyAuthorization**(`a`, `signature?`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

rlp([chain_id, key_type, key_id, expiry, limits, allowed_calls, witness]); with a signature,
rlp([that list, signature]). At most 16 limits and 16 scopes, 16 selector rules each and 16 recipients each. Every
item is written, the empty ones included: an `expiry` of 0 as `0x80`, which Tempo reads as no expiry, and an empty
`limits` or `allowedCalls` as an empty list, which Tempo reads as no spending or no calls, never as the absent item.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | [`TempoKeyAuthorization`](#tempokeyauthorization) |
| `signature?` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### expiringNonceHash()

> **expiringNonceHash**(`signedTx`, `sender`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

keccak256(`0x76` ‖ rlp(every envelope field before the sender's signature) ‖ sender). When a fee payer has signed,
`fee_token` is written as `0x80` and the fee payer's signature as `0x00`, as the sender signed them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedTx` | `Uint8Array` |
| `sender` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### keyAuthorizationDigest()

> **keyAuthorizationDigest**(`a`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The digest a key authorization's root key signs: keccak256 of `encodeKeyAuthorization(a)`, the authorization with no
signature, the `digest` of `KeyAuthorizationUnsigned`'s request. An authorization `encodeKeyAuthorization` refuses is
refused the same way.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | [`TempoKeyAuthorization`](#tempokeyauthorization) |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### memoCalldata()

> **memoCalldata**(`to`, `amount`, `memo`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

`transferWithMemo(to, amount, memo)` calldata: the selector, then the three 32-byte words.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `to` | `` `0x${string}` `` |
| `amount` | `bigint` |
| `memo` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### tempoChannelId()

> **tempoChannelId**(`d`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The TIP-20 channel reserve's channel id: keccak256(abi.encode(payer, payee, operator, token, salt,
authorizedSigner, expiringNonceHash, escrow, chainId)).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | [`TempoDescriptor`](#tempodescriptor) & `object` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### witnessRecover()

> **witnessRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Reads the transaction's receipt and returns topic 2 of its one `KeyAuthorizationWitness` log from the account
keychain: none is `tempo/no-witness`, and more than one `tempo/ambiguous`. A failed read is `tempo/unreadable`, no
receipt `tempo/not-found` and a revert `tempo/reverted`, as `readReceiptAtMark` answers. A revert,
`tempo/no-witness` and `tempo/ambiguous` are given only where the receipt's block is at or below the reader's
`finalized` mark: above it, or where that mark cannot be read, each is `tempo/not-final`, a read to repeat, since a
block above the mark can be replaced by one in which the transaction succeeds or holds other logs. The mark is read
only for those. The challenge is not read. An input or reader that is not an object, an input whose `tx` is not a
32-byte hash, or a reader for another network than the input names, is `tempo/wrong-reader`, with nothing read. At
most two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`string`, [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`EvmReader`](evm.md#evmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>
