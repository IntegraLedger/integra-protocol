---
title: "@integraledger/lcp/spend-permissions"
description: "The Spend Permission exchange and the pairing `spend-permissions/eip155`: an account's approval, on the SpendPermissionManager, of a Spend Permission whose `salt` is the ATR hash, as the sale's agreement."
---

# @integraledger/lcp/spend-permissions

The Spend Permission exchange and the pairing `spend-permissions/eip155`: an account's approval, on the
SpendPermissionManager, of a Spend Permission whose `salt` is the ATR hash, as the sale's agreement.

The offer in a `402` body, the typed data the account signs or the `approve` call it makes, the `Spend-Permission`
return header, the resource server's checks, the permission's hash as the manager computes it, and the read of the
approval by that hash, as the profile `spend-permissions/eip155` states them. No key is held, nothing is signed, and
nothing is read but through the reader a caller supplies.

## Interfaces

### SpendPermission

A Spend Permission as the exchange writes it: its nine members, each integer a string of decimal digits with no sign
and no leading zero, each address `0x` and 40 hex digits, `extraData` `0x` and an even number of hex digits.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-account"></a> `account` | `readonly` | `` `0x${string}` `` | - |
| <a id="property-allowance"></a> `allowance` | `readonly` | `string` | A uint160. |
| <a id="property-end"></a> `end` | `readonly` | `string` | A uint48, a Unix time in seconds. |
| <a id="property-extradata"></a> `extraData` | `readonly` | `` `0x${string}` `` | - |
| <a id="property-period"></a> `period` | `readonly` | `string` | A uint48, in seconds. |
| <a id="property-salt"></a> `salt` | `readonly` | `string` | A uint256: H, as a decimal. |
| <a id="property-spender"></a> `spender` | `readonly` | `` `0x${string}` `` | - |
| <a id="property-start"></a> `start` | `readonly` | `string` | A uint48, a Unix time in seconds. |
| <a id="property-token"></a> `token` | `readonly` | `` `0x${string}` `` | - |

***

### SpendPermissionBody

The `402` body: the offer, and on a refused return the code that refused it.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `readonly` | [`SpendPermissionError`](#spendpermissionerror) |
| <a id="property-spendpermission"></a> `spendPermission` | `readonly` | [`SpendPermissionOffer`](#spendpermissionoffer) |

***

### SpendPermissionChoice

The buyer's inputs to `build`: the offer as `read` gave it, and the account that approves.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-account-1"></a> `account` | `readonly` | `` `0x${string}` `` |
| <a id="property-offer"></a> `offer` | `readonly` | [`SpendPermissionOffer`](#spendpermissionoffer) |

***

### SpendPermissionOffer

The offer the `402` body's `spendPermission` member holds.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-accepts"></a> `accepts` | `readonly` | readonly [`SpendPermissionRoute`](#spendpermissionroute)[] | The routes the resource server takes, each once. |
| <a id="property-legalcontext"></a> `legalContext` | `readonly` | `object` | - |
| `legalContext.legalContextUrl` | `readonly` | `string` | - |
| `legalContext.type` | `readonly` | `"sha256"` | - |
| `legalContext.value` | `readonly` | `` `0x${string}` `` | - |
| <a id="property-manager"></a> `manager` | `readonly` | `` `0x${string}` `` | The SpendPermissionManager's address on `network`. |
| <a id="property-network"></a> `network` | `readonly` | `` `eip155:${string}` `` | - |
| <a id="property-permission"></a> `permission` | `readonly` | [`OfferedPermission`](#offeredpermission) | Every member of the permission but `account`, `salt` being H. |

***

### SpendPermissionOfferInput

What the resource server offers before H is placed: the offer without `legalContext`, and `salt` absent or H.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-accepts-1"></a> `accepts` | `readonly` | readonly [`SpendPermissionRoute`](#spendpermissionroute)[] |
| <a id="property-manager-1"></a> `manager` | `readonly` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | `readonly` | `` `eip155:${string}` `` |
| <a id="property-permission-1"></a> `permission` | `readonly` | `Omit`\<[`OfferedPermission`](#offeredpermission), `"salt"`\> & `object` |

***

### SpendPermissionRef

The reference the read takes: the option's payee is the permission's `spender`.

#### Extends

- [`EvmReadRefBase`](evm.md#evmreadrefbase)

#### Properties

| Property | Modifier | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-h"></a> `h` | `readonly` | `` `0x${string}` `` | H, the permission's `salt`. | - | - |
| <a id="property-hash"></a> `hash` | `readonly` | `` `0x${string}` `` | The permission's hash, the search key. | - | - |
| <a id="property-manager-2"></a> `manager` | `readonly` | `` `0x${string}` `` | The SpendPermissionManager the permission is approved on. | - | - |
| <a id="property-network-2"></a> `network` | `readonly` | `` `eip155:${string}` `` | - | [`EvmReadRefBase`](evm.md#evmreadrefbase).[`network`](evm.md#property-network-5) | - |
| <a id="property-payee"></a> `payee` | `readonly` | `string` | - | - | [`EvmReadRefBase`](evm.md#evmreadrefbase).[`payee`](evm.md#property-payee-4) |
| <a id="property-permission-2"></a> `permission` | `readonly` | [`SpendPermission`](#spendpermission) | The permission whole, as presented: the members `presented` compares, and the argument of the value's two reads. | - | - |
| <a id="property-transaction"></a> `transaction?` | `readonly` | `` `0x${string}` `` | A transaction a settler or the caller named, read beside the search; never needed. | - | [`EvmReadRefBase`](evm.md#evmreadrefbase).[`transaction`](evm.md#property-transaction-4) |

***

### SpendPermissionTypedData

The EIP-712 typed data of the permission in the manager's domain, as a signer takes it.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-domain"></a> `domain` | `readonly` | `object` |
| `domain.chainId` | `readonly` | `number` |
| `domain.name` | `readonly` | `string` |
| `domain.verifyingContract` | `readonly` | `` `0x${string}` `` |
| `domain.version` | `readonly` | `string` |
| <a id="property-message"></a> `message` | `readonly` | `object` |
| `message.account` | `readonly` | `` `0x${string}` `` |
| `message.allowance` | `readonly` | `bigint` |
| `message.end` | `readonly` | `bigint` |
| `message.extraData` | `readonly` | `` `0x${string}` `` |
| `message.period` | `readonly` | `bigint` |
| `message.salt` | `readonly` | `bigint` |
| `message.spender` | `readonly` | `` `0x${string}` `` |
| `message.start` | `readonly` | `bigint` |
| `message.token` | `readonly` | `` `0x${string}` `` |
| <a id="property-primarytype"></a> `primaryType` | `readonly` | `"SpendPermission"` |
| <a id="property-types"></a> `types` | `readonly` | `object` |
| `types.SpendPermission` | `readonly` | readonly `object`[] |

***

### SpendPermissionUnsigned

What `build` gives the account: the whole permission, its hash, the typed data it signs on `"signature"`, and the
manager's `approve` call it makes on `"transaction"`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-approve"></a> `approve` | `readonly` | `object` |
| `approve.data` | `readonly` | `` `0x${string}` `` |
| `approve.to` | `readonly` | `` `0x${string}` `` |
| <a id="property-hash-1"></a> `hash` | `readonly` | `` `0x${string}` `` |
| <a id="property-permission-3"></a> `permission` | `readonly` | [`SpendPermission`](#spendpermission) |
| <a id="property-typeddata"></a> `typedData` | `readonly` | [`SpendPermissionTypedData`](#spendpermissiontypeddata) |

## Type Aliases

### OfferedPermission

> **OfferedPermission** = `Omit`\<[`SpendPermission`](#spendpermission), `"account"`\>

The permission as the offer writes it: every member but `account`.

***

### SpendPermissionError

> **SpendPermissionError** = `"spend-permissions/not-bound"` \| `"spend-permissions/signature-invalid"` \| `"spend-permissions/not-approved"` \| `"spend-permissions/revoked"` \| `"spend-permissions/ended"` \| `"spend-permissions/header-malformed"` \| `"spend-permissions/route-not-accepted"` \| `"spend-permissions/account-is-spender"`

The codes a refused return is answered with, in the `402` body's `error` member.

***

### SpendPermissionReturn

> **SpendPermissionReturn** = `object` & \{ `signature`: [`Hex`](evm.md#hex); `transaction?`: `never`; \} \| \{ `signature?`: `never`; `transaction`: [`Hex`](evm.md#hex); \}

The return a `Spend-Permission` header carries: the whole permission, and the account's signature or transaction.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `manager` | [`Hex`](evm.md#hex) |
| `network` | [`Eip155`](evm.md#eip155) |
| `permission` | [`SpendPermission`](#spendpermission) |

***

### SpendPermissionRoute

> **SpendPermissionRoute** = `"signature"` \| `"transaction"`

The route the account's act took: its signature, or its own transaction.

## Variables

### APPROVE\_SELECTOR

> `const` **APPROVE\_SELECTOR**: `` `0x${string}` ``

`approve(SpendPermission)`.

***

### APPROVE\_WITH\_SIGNATURE\_SELECTOR

> `const` **APPROVE\_WITH\_SIGNATURE\_SELECTOR**: `` `0x${string}` ``

`approveWithSignature(SpendPermission,bytes)`.

***

### IS\_APPROVED\_SELECTOR

> `const` **IS\_APPROVED\_SELECTOR**: `` `0x${string}` ``

`isApproved(SpendPermission)`.

***

### IS\_REVOKED\_SELECTOR

> `const` **IS\_REVOKED\_SELECTOR**: `` `0x${string}` ``

`isRevoked(SpendPermission)`.

***

### SPEND\_PERMISSION\_APPROVED\_TOPIC

> `const` **SPEND\_PERMISSION\_APPROVED\_TOPIC**: `` `0x${string}` ``

`SpendPermissionApproved(bytes32,SpendPermission)`'s topic.

***

### SPEND\_PERMISSION\_DOMAIN

> `const` **SPEND\_PERMISSION\_DOMAIN**: `Readonly`\<\{ `name`: `"Spend Permission Manager"`; `version`: `"1"`; \}\>

The manager's EIP-712 domain name and version.

***

### SPEND\_PERMISSION\_HEADER

> `const` **SPEND\_PERMISSION\_HEADER**: `"Spend-Permission"` = `"Spend-Permission"`

The request header field that carries the return.

***

### SPEND\_PERMISSION\_REVOKED\_TOPIC

> `const` **SPEND\_PERMISSION\_REVOKED\_TOPIC**: `` `0x${string}` ``

`SpendPermissionRevoked(bytes32,SpendPermission)`'s topic.

***

### SPEND\_PERMISSION\_TYPEHASH

> `const` **SPEND\_PERMISSION\_TYPEHASH**: `` `0x${string}` ``

keccak256 of the manager's `SpendPermission` type (`SPEND_PERMISSION_TYPEHASH`).

***

### spendPermissionsEip155

> `const` **spendPermissionsEip155**: `Readonly`\<\{ `advertise`: (`_doc`, `h`, `link`, `offer`, `error?`) => [`Refusal`](index.md#refusal) \| [`SpendPermissionBody`](#spendpermissionbody); `bound`: (`presented`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SpendPermissionUnsigned`](#spendpermissionunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"spend-permissions/eip155"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `error?`: [`SpendPermissionError`](#spendpermissionerror); `h`: `` `0x${string}` ``; `link`: `string`; `offer`: [`SpendPermissionOffer`](#spendpermissionoffer); \}; `reference`: (`presented`, `option`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SpendPermissionRef`](#spendpermissionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmStatus`](evm.md#evmstatus)\>; `tie`: (`offer`) => \[`"spendPermission"`, [`SpendPermissionOffer`](#spendpermissionoffer)\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`SpendPermissionOffer`](#spendpermissionoffer) \| [`SpendPermissionOfferInput`](#spendpermissionofferinput); \}\>

`spend-permissions/eip155`. On `"signature"` the resource server submits the approval (`broadcaster` answers
`"payee"`); on `"transaction"` the account has already made it (`"payer"`). `status` reads the approval by the
permission's hash; `approvedIn` reads the transaction that should hold it.

## Functions

### approvedIn()

> **approvedIn**(`presented`, `reader`, `transaction?`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `block`: `bigint`; `transaction`: `` `0x${string}` ``; \}\>

The read of the transaction that should hold the approval: on `"transaction"` the one the return names, and on
`"signature"` the resource server's own submission of `approveWithSignature`, given as `transaction`. It gives the
block of a transaction whose receipt's `status` is 1 and that holds the manager's `SpendPermissionApproved` for the
permission's hash, the permission whole; otherwise `spend-permissions/revoked` where the manager reads the permission
revoked in the state after its block, and `spend-permissions/not-approved`. The return is read as rule 8 takes it.
`evm/wrong-reader` for a reader of another network, `evm/not-found` where the reader holds no receipt yet and
`evm/unreadable` where a read failed or answered out of its form, each before anything is decided.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |
| `reader` | [`EvmReader`](evm.md#evmreader) |
| `transaction?` | `` `0x${string}` `` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `block`: `bigint`; `transaction`: `` `0x${string}` ``; \}\>

***

### checkReturn()

> **checkReturn**(`presented`, `offer`, `now`): [`Refusal`](index.md#refusal) \| [`SpendPermissionReturn`](#spendpermissionreturn)

The resource server's checks of a return before it submits or serves, in the profile's order (rule 9): the return
as rule 8 takes it (`header-malformed`, `signature-invalid`); `network`, `manager` and every offered member of the
permission equal to the offer's, `salt` being H (`not-bound`); a route the offer accepts (`route-not-accepted`);
`account` not `spender` (`account-is-spender`); and `end` later than `now`, the caller's clock in Unix seconds
(`ended`). The offer is the `spendPermission` the resource server issued (`offer-malformed`, or as `read` refuses its
legal context, where it is not one); a `now` that is not a non-negative safe integer is `choice-malformed`. Whether
`salt` is an H the resource server issued for this request and has not seen used is its own record's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |
| `offer` | [`SpendPermissionOffer`](#spendpermissionoffer) |
| `now` | `number` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SpendPermissionReturn`](#spendpermissionreturn)

***

### decodeSpendPermissionHeader()

> **decodeSpendPermissionHeader**(`header`): [`Refusal`](index.md#refusal) \| [`SpendPermissionReturn`](#spendpermissionreturn)

The return a `Spend-Permission` header's value carries: base64url without padding in its canonical form (RFC 4648
§5), of at most `MAX_HEADER_BYTES` bytes, that are well-formed UTF-8 of one JSON object and nothing after it, at most
64 levels deep, holding the members rule 8 names and no other; else `spend-permissions/header-malformed`, or
`spend-permissions/signature-invalid` where only its signature is malformed. Addresses and hex come back lowercase.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `header` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SpendPermissionReturn`](#spendpermissionreturn)

***

### encodeSpendPermissionHeader()

> **encodeSpendPermissionHeader**(`value`): `string` \| [`Refusal`](index.md#refusal)

The `Spend-Permission` header's value: base64url without padding of the UTF-8 of `JSON.stringify` of the return,
which must be a return the profile's rule 8 takes, of at most `MAX_HEADER_BYTES` bytes; else
`spend-permissions/header-malformed`, or `spend-permissions/signature-invalid` for a malformed signature.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | [`SpendPermissionReturn`](#spendpermissionreturn) |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### permissionHash()

> **permissionHash**(`permission`, `network`, `manager`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The permission's hash as the SpendPermissionManager's `getHash` computes it: the EIP-712 digest of the whole
permission in the manager's domain on the network, the digest the account signs and the approval event's topic.
`spend-permissions/header-malformed` where the permission, the network or the manager is not in the wire form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `permission` | [`SpendPermission`](#spendpermission) |
| `network` | `` `eip155:${string}` `` |
| `manager` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### tie()

> **tie**(`offer`): \[`"spendPermission"`, [`SpendPermissionOffer`](#spendpermissionoffer)\]

The ATR's binding slot: the offer exactly as issued.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `offer` | [`SpendPermissionOffer`](#spendpermissionoffer) |

#### Returns

\[`"spendPermission"`, [`SpendPermissionOffer`](#spendpermissionoffer)\]

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### EvmMark

Re-exports [EvmMark](ap2.md#evmmark)

***

### EvmQuery

Re-exports [EvmQuery](ap2.md#evmquery)

***

### EvmReadRefBase

Re-exports [EvmReadRefBase](evm.md#evmreadrefbase)
