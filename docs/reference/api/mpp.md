---
title: "@integraledger/lcp/mpp"
description: "The exports of @integraledger/lcp/mpp."
---

# @integraledger/lcp/mpp

## Interfaces

### EvmLogEntry

A log as `eth_getLogs` gives it: the log, the transaction that emitted it, its block and its index in that block.

#### Extends

- [`EvmLog`](evm.md#evmlog)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-address"></a> `address` | `` `0x${string}` `` | [`EvmLog`](evm.md#evmlog).[`address`](evm.md#property-address) |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` | - |
| <a id="property-data"></a> `data` | `` `0x${string}` `` | [`EvmLog`](evm.md#evmlog).[`data`](evm.md#property-data) |
| <a id="property-logindex"></a> `logIndex` | `number` | - |
| <a id="property-topics"></a> `topics` | readonly `` `0x${string}` ``[] | [`EvmLog`](evm.md#evmlog).[`topics`](evm.md#property-topics) |
| <a id="property-transactionhash"></a> `transactionHash` | `` `0x${string}` `` | - |

***

### EvmSearchReader

An `EvmReader` that also answers a log query, a block by mark or number, and a transaction's signed bytes. Every
failure rejects, as `EvmReader`'s do: a range the endpoint refuses rejects, and is never read as an empty answer.

#### Extends

- [`EvmReader`](evm.md#evmreader)

#### Extended by

- [`TempoSearchReader`](tempo.md#temposearchreader)

#### Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `eip155:${string}` `` \| `HederaNetwork` | [`EvmReader`](evm.md#evmreader).[`network`](evm.md#property-network-4) |

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

###### Overrides

[`EvmReader`](evm.md#evmreader).[`block`](evm.md#block)

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

[`EvmReader`](evm.md#evmreader).[`blockNumber`](evm.md#blocknumber)

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

[`EvmReader`](evm.md#evmreader).[`call`](evm.md#call)

##### logs()

> **logs**(`filter`): `Promise`\<readonly [`EvmLogEntry`](#evmlogentry)[]\>

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

`Promise`\<readonly [`EvmLogEntry`](#evmlogentry)[]\>

###### Overrides

[`EvmReader`](evm.md#evmreader).[`logs`](evm.md#logs)

##### raw()

> **raw**(`tx`): `Promise`\<`` `0x${string}` `` \| `null`\>

`eth_getRawTransactionByHash`: the signed transaction's bytes; null when the node holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<`` `0x${string}` `` \| `null`\>

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

[`EvmReader`](evm.md#evmreader).[`receipt`](evm.md#receipt)

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

[`EvmReader`](evm.md#evmreader).[`transaction`](evm.md#transaction)

***

### GatewaySaltInput

The inputs of `usdc`'s Gateway salt, every one a string.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `string` |
| <a id="property-destinationnetwork"></a> `destinationNetwork` | `string` |
| <a id="property-destinationrecipient"></a> `destinationRecipient` | `string` |
| <a id="property-id"></a> `id` | `string` |
| <a id="property-maxfee"></a> `maxFee` | `string` |
| <a id="property-realm"></a> `realm` | `string` |
| <a id="property-recipient"></a> `recipient` | `string` |
| <a id="property-requesthash"></a> `requestHash` | `` `0x${string}` `` |
| <a id="property-sourcedepositor"></a> `sourceDepositor` | `string` |
| <a id="property-sourcenetwork"></a> `sourceNetwork` | `string` |
| <a id="property-sourcesigner"></a> `sourceSigner` | `string` |

***

### HederaStockReader

The reader of a stock session: the network's JSON-RPC relay, and three reads of its mirror. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | `readonly` | `HederaNetwork` |

#### Methods

##### account()

> **account**(`address`): `Promise`\<`string` \| `null`\>

`GET /api/v1/accounts/{address}` of the mirror: the account id its `account` member names, `shard.realm.num`; null
on the mirror's 404.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `` `0x${string}` `` |

###### Returns

`Promise`\<`string` \| `null`\>

##### contractResult()

> **contractResult**(`tx`): `Promise`\<`string` \| `null`\>

`GET /api/v1/contracts/results/{transactionIdOrHash}` of the mirror for the transaction hash: the answer's `result`,
the transaction's result as the network records it, `CONTRACT_REVERT_EXECUTED` for a revert executed in the EVM;
null on the mirror's 404.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<`string` \| `null`\>

##### oldestBlock()

> **oldestBlock**(): `Promise`\<`bigint` \| `"archival"`\>

The number of the oldest block the mirror holds, from which the relay answers, `number` of
`GET /api/v1/blocks?order=asc&limit=1`, or `archival` where the endpoint is declared archival.

###### Returns

`Promise`\<`bigint` \| `"archival"`\>

##### receipt()

> **receipt**(`tx`): `Promise`\<[`EvmReceipt`](evm.md#evmreceipt) \| `null`\>

`eth_getTransactionReceipt` through the relay; null when it holds none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`EvmReceipt`](evm.md#evmreceipt) \| `null`\>

##### transaction()

> **transaction**(`tx`): `Promise`\<\{ `input`: `` `0x${string}` ``; `to`: `` `0x${string}` `` \| `null`; \} \| `null`\>

`eth_getTransactionByHash` through the relay: the recipient and the calldata the sender signed; null when none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<\{ `input`: `` `0x${string}` ``; `to`: `` `0x${string}` `` \| `null`; \} \| `null`\>

***

### HederaStockRef

The read keys of a stock opening: the network, the opening's transaction hash its credential names, the escrow the
challenge names, the channel the credential names, and the challenge's `recipient`, the payee. Addresses and hashes
are lowercase. The position the opening must come after, the relay's block number read when the agreement settled,
is the caller's.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | `` `0x${string}` `` |
| <a id="property-escrow"></a> `escrow` | `` `0x${string}` `` |
| <a id="property-network-2"></a> `network` | `HederaNetwork` |
| <a id="property-payee"></a> `payee` | `` `0x${string}` `` |
| <a id="property-transaction"></a> `transaction` | `` `0x${string}` `` |

***

### LandedCredential

A push credential with a landed EVM transaction, its block and its receipt's logs under `FETCHED`. No pairing's
`fetchPresented` in this package writes it.

#### Extends

- [`MppCredential`](#mppcredential)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-fetched"></a> `[FETCHED]` | `object` | - |
| `[FETCHED].blockNumber` | `bigint` | - |
| `[FETCHED].logs` | readonly [`EvmLog`](evm.md#evmlog)[] | - |
| `[FETCHED].transaction` | `` `0x${string}` `` | - |
| <a id="property-challenge"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | [`MppCredential`](#mppcredential).[`challenge`](#property-challenge-2) |
| <a id="property-payload"></a> `payload` | `object` | [`MppCredential`](#mppcredential).[`payload`](#property-payload-1) |
| <a id="property-source"></a> `source?` | `string` | [`MppCredential`](#mppcredential).[`source`](#property-source-1) |

***

### MppChallenge

A challenge's auth-params after quoted-string unescaping. `request` and `opaque` are base64url-nopad JSON.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-description"></a> `description?` | `string` |
| <a id="property-digest"></a> `digest?` | `string` |
| <a id="property-expires"></a> `expires?` | `string` |
| <a id="property-header"></a> `header?` | `string` |
| <a id="property-id-1"></a> `id?` | `string` |
| <a id="property-intent"></a> `intent` | `string` |
| <a id="property-method"></a> `method` | `string` |
| <a id="property-opaque"></a> `opaque?` | `string` |
| <a id="property-realm-1"></a> `realm` | `string` |
| <a id="property-request"></a> `request` | `string` |

***

### MppChoice

The buyer's inputs to `build`. `build` holds the chosen challenge as `bound` holds an echoed one (`chosenHeld`),
from a snapshot of its own members that the credential carries, checks the other inputs' form and that the
challenge's id carries H; it compares no deal value.

#### Extended by

- [`SessionChoice`](#sessionchoice)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-challenge-1"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - |
| <a id="property-from"></a> `from` | `` `0x${string}` `` | - |
| <a id="property-now"></a> `now` | `number` | - |
| <a id="property-spender"></a> `spender?` | `` `0x${string}` `` | permit2 only: the seller server's submitting address. |
| <a id="property-tokendomain"></a> `tokenDomain?` | `object` | authorization only: the token's EIP-712 name and version. |
| `tokenDomain.name` | `string` | - |
| `tokenDomain.version` | `string` | - |

***

### MppCredential

#### Extended by

- [`LandedCredential`](#landedcredential)
- [`TempoLandedCredential`](#tempolandedcredential)
- [`SolanaTablesCredential`](#solanatablescredential)

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-2"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-payload-1"></a> `payload` | `object` |
| <a id="property-source-1"></a> `source?` | `string` |

***

### MppEip3009Ref

The reference an MPP EIP-3009 charge's read takes; the pairing's `reference` writes it.

#### Extends

- `ChargeRefBase`

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-authorization"></a> `authorization` | `readonly` | `object` | The challenge's `currency`, the token under whose domain the payer signed, which records the nonce's use. | - |
| `authorization.at` | `readonly` | `` `0x${string}` `` | - | - |
| `authorization.deadline` | `readonly` | `string` | - | - |
| `authorization.nonce` | `readonly` | `` `0x${string}` `` | - | - |
| <a id="property-network-3"></a> `network` | `readonly` | `` `eip155:${string}` `` | - | `ChargeRefBase.network` |
| <a id="property-payee-1"></a> `payee` | `readonly` | `string` | - | `ChargeRefBase.payee` |
| <a id="property-payer"></a> `payer` | `readonly` | `` `0x${string}` `` | - | `ChargeRefBase.payer` |
| <a id="property-presented"></a> `presented` | `readonly` | `Signed` | The members of the payment presented: the token, `from`, `to`, `value` and `nonce`, lowercase, `value` in decimal. | - |
| <a id="property-transaction-1"></a> `transaction?` | `readonly` | `` `0x${string}` `` | A transaction a settler or the caller named, read beside the search, as the landed form gives it; never needed. | `ChargeRefBase.transaction` |

***

### MppNamedRef

The reference the named-transaction read takes: the transaction the credential carries or names, its payer, the payee.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-network-4"></a> `network` | `readonly` | `` `eip155:${string}` `` | - |
| <a id="property-payee-2"></a> `payee` | `readonly` | `string` | - |
| <a id="property-payer-1"></a> `payer` | `readonly` | `` `0x${string}` `` | - |
| <a id="property-transaction-2"></a> `transaction` | `readonly` | `` `0x${string}` `` | The transaction the credential names (`hash`) or carries (`transaction`, by the hash of its signed bytes). |

***

### MppPermit2Ref

The reference the MPP Permit2 charge's read takes; the pairing's `reference` writes it.

#### Extends

- `ChargeRefBase`

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-authorization-1"></a> `authorization` | `readonly` | `object` | The Permit2 deployment that records the owner's nonce, the nonce, and the permit's `deadline`. | - |
| `authorization.at` | `readonly` | `` `0x${string}` `` | - | - |
| `authorization.deadline` | `readonly` | `string` | - | - |
| `authorization.nonce` | `readonly` | `` `0x${string}` `` | - | - |
| <a id="property-network-5"></a> `network` | `readonly` | `` `eip155:${string}` `` | - | `ChargeRefBase.network` |
| <a id="property-payee-3"></a> `payee` | `readonly` | `string` | - | `ChargeRefBase.payee` |
| <a id="property-payer-2"></a> `payer` | `readonly` | `` `0x${string}` `` | - | `ChargeRefBase.payer` |
| <a id="property-presented-1"></a> `presented` | `readonly` | `Signed` | The members of the payment presented: the permit's `permitted` list (`token:amount`, comma-separated), `nonce` and `deadline`, the `owner`, the transfer details (`to:requestedAmount`, comma-separated) and the witness's hash. | - |
| <a id="property-transaction-3"></a> `transaction?` | `readonly` | `` `0x${string}` `` | A transaction a settler or the caller named, read beside the search, as the landed form gives it; never needed. | `ChargeRefBase.transaction` |
| <a id="property-witnesses"></a> `witnesses?` | `readonly` | readonly `` `0x${string}` ``[] | The witness words the search counts: the chosen challenge's, and each of the other challenges of the sale's issue on this pairing and chain that `reference` was given. Absent, the presented `witness` alone. | - |

***

### SessionChoice

The buyer's inputs to `build`. `build` checks their form and that the chosen challenge's id carries H; it compares no
deal value.

#### Extends

- [`MppChoice`](#mppchoice)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner?` | `` `0x${string}` `` | sessions: default the zero address, which means the payer. | - |
| <a id="property-challenge-3"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - | [`MppChoice`](#mppchoice).[`challenge`](#property-challenge-1) |
| <a id="property-credentialtype"></a> `credentialType?` | `"permit2"` \| `"authorization"` | EVM: default the first listed type. | - |
| <a id="property-deposit"></a> `deposit?` | `bigint` | sessions: the buyer's deposit; `suggestedDeposit` is advice. | - |
| <a id="property-from-1"></a> `from` | `` `0x${string}` `` | - | [`MppChoice`](#mppchoice).[`from`](#property-from) |
| <a id="property-now-1"></a> `now` | `number` | - | [`MppChoice`](#mppchoice).[`now`](#property-now) |
| <a id="property-spender-1"></a> `spender?` | `` `0x${string}` `` | permit2 only: the seller server's submitting address. | [`MppChoice`](#mppchoice).[`spender`](#property-spender) |
| <a id="property-tokendomain-1"></a> `tokenDomain?` | `object` | authorization only: the token's EIP-712 name and version. | [`MppChoice`](#mppchoice).[`tokenDomain`](#property-tokendomain) |
| `tokenDomain.name` | `string` | - | - |
| `tokenDomain.version` | `string` | - | - |

***

### SessionRef

The settlement read keys of these pairings.

#### Extends

- [`EvmRef`](evm.md#evmref)

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-accesskey"></a> `accessKey?` | `public` | `object` | The subscription's access key: its id, the token it spends, and `transferDigest({to: recipient})`; `expiry`, the key authorization's signed expiry in decimal Unix seconds, absent where it signs none. With `account`, the read keys of a transfer made under the key for that account. | - |
| `accessKey.account?` | `public` | `` `0x${string}` `` | - | - |
| `accessKey.expiry?` | `public` | `string` | - | - |
| `accessKey.keyId` | `public` | `` `0x${string}` `` | - | - |
| `accessKey.to` | `public` | `` `0x${string}` `` | - | - |
| `accessKey.token` | `public` | `` `0x${string}` `` | - | - |
| <a id="property-authorization-2"></a> `authorization?` | `public` | [`PullAuthorization`](evm.md#pullauthorization) | The signed pull authorization and where the chain records its use, where the pairing's reference records one. | [`EvmRef`](evm.md#evmref).[`authorization`](evm.md#property-authorization) |
| <a id="property-bindinglog"></a> `bindingLog?` | `public` | \{ address: \`0x$\{string\}\`; topic0: \`0x$\{string\}\`; value: \`0x$\{string\}\`; \} & (\{ index: 2 \| 1 \| 3; \} \| \{ dataWord: number; \}) | The log carrying H or its commitment: in topic `index`, or in 32-byte data word `dataWord`. | [`EvmRef`](evm.md#evmref).[`bindingLog`](evm.md#property-bindinglog) |
| <a id="property-closes"></a> `closes?` | `public` | `object` | The close of an EVM session: a call to `escrow` of one of `EVM_CLOSE_SELECTORS` naming `channel`. | - |
| `closes.channel` | `public` | `` `0x${string}` `` | - | - |
| `closes.escrow` | `public` | `` `0x${string}` `` | - | - |
| <a id="property-funding"></a> `funding?` | `public` | `object` | The EVM opening's funding, as `MppSessionOpeningRef` names it: its type, token, value's keeper, nonce and bound. | - |
| `funding.at` | `readonly` | `` `0x${string}` `` | - | - |
| `funding.deadline` | `readonly` | `string` | - | - |
| `funding.nonce` | `readonly` | `` `0x${string}` `` | - | - |
| `funding.token` | `readonly` | `` `0x${string}` `` | - | - |
| `funding.type` | `readonly` | `"permit2"` \| `"authorization"` | - | - |
| <a id="property-network-6"></a> `network` | `public` | `` `eip155:${string}` `` \| `HederaNetwork` | - | [`EvmRef`](evm.md#evmref).[`network`](evm.md#property-network-5) |
| <a id="property-nonce"></a> `nonce?` | `public` | `object` | On a Tempo session, the opening transaction's single-use value: its nonce key and nonce, in decimal, and its signed `validBefore` in decimal Unix seconds, absent where it signs none. `status` reads the value by its key at the final mark and at the latest head, through a reader that reads a block's state (`TempoSearchReader`). | - |
| `nonce.key` | `public` | `string` | - | - |
| `nonce.value` | `public` | `string` | - | - |
| <a id="property-opened"></a> `opened?` | `public` | `object` | - | - |
| `opened.address` | `public` | `` `0x${string}` `` | - | - |
| `opened.chainId` | `public` | `number` | - | - |
| `opened.channel` | `public` | `` `0x${string}` `` | - | - |
| `opened.h` | `public` | `` `0x${string}` `` | - | - |
| `opened.version` | `public` | `"v1"` \| `"v2"` | - | - |
| <a id="property-opens"></a> `opens?` | `public` | `object` | The opening of an EVM session: the escrow's open call whose salt is `h`, and whose payer, payee, token and authorized signer, with `h`, the escrow and `chainId`, give `channel`. With `payer`, `funding` and `presented`, `status` reads the opening by its funding (`mppSessionOpeningStatus`). | - |
| `opens.chainId` | `public` | `number` | - | - |
| `opens.channel` | `public` | `` `0x${string}` `` | - | - |
| `opens.escrow` | `public` | `` `0x${string}` `` | - | - |
| `opens.h` | `public` | `` `0x${string}` `` | - | - |
| <a id="property-payee-4"></a> `payee` | `public` | `string` | The option's payee, which `reference` takes from the option the payment answers. | [`EvmRef`](evm.md#evmref).[`payee`](evm.md#property-payee-4) |
| <a id="property-payer-3"></a> `payer?` | `public` | `` `0x${string}` `` | The payer: on a Tempo session the sender of the opening's transaction, recovered from its `0x76` form, on an EVM session the account its authorization or permit is signed by, and on a subscription the account whose root key signed the key authorization (`keyAuthorizationSigner`). With `opened`, `status` reads the Tempo opening by the search for its `ChannelOpened` (`tempoOpeningStatus`); with a binding log under `KeyAuthorizationWitness`, the activation by the search for that log (`activationStatus`). | - |
| <a id="property-presented-2"></a> `presented?` | `public` | `Readonly`\<`Record`\<`string`, `string`\>\> | The members of the EVM opening's payment presented, as `MppSessionOpeningRef` names them. | - |
| <a id="property-revokes"></a> `revokes?` | `public` | `object` | The close of a subscription: the account keychain's `KeyRevoked` whose topic 1 is `account` and topic 2 `keyId`. | - |
| `revokes.account` | `public` | `` `0x${string}` `` | - | - |
| `revokes.keyId` | `public` | `` `0x${string}` `` | - | - |
| <a id="property-search"></a> `search?` | `public` | `object` | The log filter that finds the transaction when none is named; absent, only a named transaction is read. | [`EvmRef`](evm.md#evmref).[`search`](evm.md#property-search) |
| `search.address` | `public` | `` `0x${string}` `` | - | - |
| `search.topics` | `public` | readonly (`` `0x${string}` `` \| `null`)[] | - | - |
| <a id="property-settleby"></a> `settleBy?` | `public` | `string` | Decimal Unix seconds after which the payment can no longer execute. | [`EvmRef`](evm.md#evmref).[`settleBy`](evm.md#property-settleby-1) |
| <a id="property-signed"></a> `signed?` | `public` | `` `0x${string}` `` | What the payer signed, as presented: on a Tempo session `expiringNonceHash` over the opening transaction's sender-signed fields, in the `0x76` form whatever envelope carried it, under its sender; on a subscription keccak-256 over the signed key authorization's bytes, the authorization and its root signature whole. A reference that `status` reads by the search, with `payer`, holds it, and one without it is `unparseable`. | - |
| <a id="property-transaction-4"></a> `transaction?` | `public` | `` `0x${string}` `` | The transaction the credential presents, where the payer broadcast the opening before presenting it. | - |
| <a id="property-transferlog"></a> `transferLog?` | `public` | [`TransferLog`](evm.md#transferlog) | The token transfer this payment made, identified by the digest of the named fields. | [`EvmRef`](evm.md#evmref).[`transferLog`](evm.md#property-transferlog) |
| <a id="property-validbefore"></a> `validBefore?` | `public` | `string` | - | - |

***

### SessionWithin

The buyer's inputs to an in-channel payment: the within 402's challenge, which the in-channel credential echoes as
`buildWithin` reads it, a snapshot of its own members (`withinChecks`); the held opening, exactly as signed; the
cumulative amount to sign; and the action.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-action"></a> `action` | `"close"` \| `"voucher"` |
| <a id="property-challenge-4"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-cumulativeamount"></a> `cumulativeAmount` | `bigint` |
| <a id="property-opening"></a> `opening` | [`MppCredential`](#mppcredential) |

***

### SolanaSessionChoice

The buyer's inputs to the memo session's `build`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authorizedsigner-1"></a> `authorizedSigner` | `string` | The session key that signs vouchers. |
| <a id="property-challenge-5"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - |
| <a id="property-deposit-1"></a> `deposit?` | `bigint` | The deposit; the request's `cap` where absent. |
| <a id="property-graceperiod"></a> `gracePeriod?` | `number` | The close's grace period in seconds; 900 where absent, as the stock client opens. |
| <a id="property-mint"></a> `mint?` | `string` | The mint the request's `currency` names: the currency itself where it is a key, else the caller's resolution. |
| <a id="property-openslot"></a> `openSlot?` | `bigint` | The channel's `openSlot`; the request's `recentSlot` wins when present. |
| <a id="property-payer-4"></a> `payer` | `string` | The payer, whose token account funds the deposit. |
| <a id="property-recentblockhash"></a> `recentBlockhash?` | `string` | The request's `recentBlockhash` wins when present. |
| <a id="property-salt"></a> `salt` | `bigint` | The PDA salt; lcp draws nothing. |
| <a id="property-tokenprogram"></a> `tokenProgram?` | `string` | Token where absent. |

***

### SolanaSessionUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request-1"></a> `request` | `object` | - |
| `request.channel` | `string` | - |
| `request.kind` | `"solana-session-open"` | - |
| `request.message` | `Uint8Array`\<`ArrayBuffer`\> | The message the payer signs: the stock `open` with one Memo instruction carrying H's LCP string. |
| `request.size` | `number` | The composed transaction's size in bytes, its two signatures included, at most 1,232. |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

The open credential for the payer's 64-byte Ed25519 signature over `message`, the operator's slot left zero.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### SolanaTablesCredential

A Solana channel opening with its message's address lookup tables under `FETCHED`. No pairing in this package writes
or reads it.

#### Extends

- [`MppCredential`](#mppcredential)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-fetched-1"></a> `[FETCHED]` | `object` | - | - |
| `[FETCHED].tables` | readonly `object`[] | For each address table lookup of the opening's message, in order: the table's address, and the table's entries at the lookup's writable and read-only indexes, in order, each a base58 key. Empty for a message without lookups. | - |
| <a id="property-challenge-6"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - | [`MppCredential`](#mppcredential).[`challenge`](#property-challenge-2) |
| <a id="property-payload-2"></a> `payload` | `object` | - | [`MppCredential`](#mppcredential).[`payload`](#property-payload-1) |
| <a id="property-source-2"></a> `source?` | `string` | - | [`MppCredential`](#mppcredential).[`source`](#property-source-1) |

***

### StripeSubscriptionReceipt

The Stripe subscription's activation receipt: the `Payment-Receipt` payload the seller's server answered the opening
with, decoded from its base64url JSON (or the MCP transport's receipt object as given). `channel.ref` takes it with
the opening.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-externalid"></a> `externalId?` | `string` | - |
| <a id="property-method-1"></a> `method` | `"stripe"` | - |
| <a id="property-reference"></a> `reference` | `string` | The Stripe invoice whose payment activated the subscription. |
| <a id="property-status"></a> `status` | `"success"` | - |
| <a id="property-stripesubscription"></a> `stripeSubscription` | `string` | The Stripe subscription ID. |
| <a id="property-subscriptionid"></a> `subscriptionId` | `string` | The seller's own identifier for the subscription. |
| <a id="property-timestamp"></a> `timestamp` | `string` | - |

***

### TempoLandedCredential

A push credential with the named transaction's receipt and signed bytes under `FETCHED`.

#### Extends

- [`MppCredential`](#mppcredential)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-fetched-2"></a> `[FETCHED]` | `object` | - |
| `[FETCHED].blockNumber` | `bigint` | - |
| `[FETCHED].logs` | readonly [`EvmLog`](evm.md#evmlog)[] | - |
| `[FETCHED].raw` | `` `0x${string}` `` | - |
| `[FETCHED].transaction` | `` `0x${string}` `` | - |
| <a id="property-challenge-7"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | [`MppCredential`](#mppcredential).[`challenge`](#property-challenge-2) |
| <a id="property-payload-3"></a> `payload` | `object` | [`MppCredential`](#mppcredential).[`payload`](#property-payload-1) |
| <a id="property-source-3"></a> `source?` | `string` | [`MppCredential`](#mppcredential).[`source`](#property-source-1) |

***

### TempoSplitLanded

What the caller adds to the reference: the act's own transaction where it knows it, on pull the one it broadcast.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-transaction-5"></a> `transaction?` | `` `0x${string}` `` |

***

### TempoSplitRef

The read keys of a split-memo payment: the network, the payer (the transaction's sender), the option's payee (the
request's `recipient`), the token the split names (`currency`), H, the signed `validBefore` in decimal Unix seconds
(absent where the transaction signs none), the transaction's own nonce, its key and value in decimal, and the payment
presented: `signed`, the hash over the fields the sender signed, in the `0x76` form whatever envelope carried them,
as `expiringNonceHash` computes it; on push also `named`, the transaction the credential names.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-currency"></a> `currency` | `` `0x${string}` `` |
| <a id="property-h"></a> `h` | `` `0x${string}` `` |
| <a id="property-named"></a> `named?` | `` `0x${string}` `` |
| <a id="property-network-7"></a> `network` | `` `eip155:${number}` `` |
| <a id="property-nonce-1"></a> `nonce` | `object` |
| `nonce.key` | `string` |
| `nonce.value` | `string` |
| <a id="property-payee-5"></a> `payee` | `` `0x${string}` `` |
| <a id="property-payer-5"></a> `payer` | `` `0x${string}` `` |
| <a id="property-signed-1"></a> `signed` | `` `0x${string}` `` |
| <a id="property-validbefore-1"></a> `validBefore?` | `string` |

***

### TokenDomain

The token's EIP-712 domain `name` and `version`, which x402's verification reads from `extra` and no MPP challenge carries.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-name"></a> `name` | `string` |
| <a id="property-version"></a> `version` | `string` |

***

### VoucherTypedData

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` |
| `domain.chainId` | `number` |
| `domain.name` | `"EVM Payment Channel"` \| `"Tempo Stream Channel"` \| `"TIP20 Channel Reserve"` |
| `domain.verifyingContract` | `` `0x${string}` `` |
| `domain.version` | `"1"` |
| <a id="property-message"></a> `message` | `object` |
| `message.channelId` | `` `0x${string}` `` |
| `message.cumulativeAmount` | `bigint` |
| <a id="property-primarytype"></a> `primaryType` | `"Voucher"` |
| <a id="property-types"></a> `types` | `object` |
| `types.Voucher` | \[\{ `name`: `"channelId"`; `type`: `"bytes32"`; \}, \{ `name`: `"cumulativeAmount"`; `type`: `"uint128"` \| `"uint96"`; \}\] |

***

### X402Mapped

x402's `exact` EIP-3009 payment and the requirements it answers, from one MPP credential.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-paymentpayload"></a> `paymentPayload` | [`PaymentPayload`](x402.md#paymentpayload) |
| <a id="property-paymentrequirements"></a> `paymentRequirements` | [`PaymentRequirements`](x402.md#paymentrequirements) |

***

### XrplChargeChoice

The buyer's inputs to `build`: the paying account and the buyer's own reads of fee, sequence and ledger.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-challenge-8"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-fee"></a> `fee` | `string` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `number` |
| <a id="property-sequence"></a> `sequence` | `number` |

***

### XrplChargeUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-2"></a> `request` | `object` |
| `request.kind` | `"xrpl-tx"` |
| `request.txJson` | [`XrplTxJson`](xrpl.md#xrpltxjson) |

#### Methods

##### complete()

> **complete**(`signedBlob`): `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>

The wallet's signed blob, hex, as a credential that names its payer by `source`, `did:pkh:xrpl:{network}:{account}`,
the challenge's network name and the account `build` was given, as the stock client writes it and the stock server
reads it first (`xrpl-mpp-sdk` 0.1.0-beta.4, `dist/client/index.js:376-385`, `dist/chunk-ZKD7D3D6.js:149-170`). It
is read as `bound` reads the credential, in its order: a credential over the credential size bound, 64 KiB, its
echoed challenge and `source` included, is `mpp/credential-malformed`; a blob that does not decode gets the refusal
`bound` gives it (one over 8,192 hex digits, the stock server's bound, is `xrpl/blob-too-large`, and one that is
not hex bytes `xrpl/blob-malformed`); and one whose `NetworkID` the challenge's network does not take is
`xrpl/network-mismatch`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedBlob` | `string` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>

## Type Aliases

### EvmMoved

> **EvmMoved** = [`Moved`](index.md#moved) & `object`

One transfer an act made, named by its transaction and its `Transfer` log's position among the receipt's logs.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `place` | `number` |
| `transaction` | [`Hex`](evm.md#hex) |

***

### GatewayPreimage

> **GatewayPreimage** = `Pick`\<[`GatewaySaltInput`](#gatewaysaltinput), `"id"` \| `"realm"` \| `"requestHash"` \| `"recipient"`\>

The salt's inputs a Gateway signing request carries from the chosen challenge.

***

### HederaStockStatus

> **HederaStockStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `"finalized"`, `bigint`\>

What `status` answers: positions are the relay's block numbers, and its one mark `finalized`, which is final.

***

### MppEvmReader

> **MppEvmReader** = [`EvmSearchReader`](#evmsearchreader) & `object`

The reader of an MPP EVM charge's read: `EvmSearchReader`, and `archival`, set where the seller declares the endpoint
archival, by which a lookup at coverage `none` shows that it holds the history its transaction would be in.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `archival?` | `boolean` |

***

### MppEvmStatus

> **MppEvmStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>

What an MPP EVM charge's `status` answers: `read-status`'s answer, with `presented` on `settled`.

***

### MppMethod

> **MppMethod** = `"evm"` \| `"tempo"` \| `"solana"` \| `"lightning"` \| `"card"` \| `"stripe"` \| `"usdc"` \| `"nearintents"` \| `"stellar"` \| `"xrpl"` \| `"hedera"`

***

### MppPairingId

> **MppPairingId** = `"mpp/charge/evm/permit2"` \| `"mpp/charge/evm/authorization"` \| `"mpp/charge/evm/transaction"` \| `"mpp/charge/evm/hash"` \| `"mpp/session/evm"` \| `"mpp/charge/tempo/split-memo"` \| `"mpp/charge/tempo/split-memo/push"` \| `"mpp/session/tempo"` \| `"mpp/subscription/tempo"` \| `"mpp/charge/lightning"` \| `"mpp/session/lightning"` \| `"mpp/charge/solana"` \| `"mpp/charge/solana/unsponsored"` \| `"mpp/subscription/solana"` \| `"mpp/session/solana/memo"` \| `"mpp/session/solana/stock"` \| `"mpp/charge/xrpl"` \| `"mpp/charge/nearintents"` \| `"mpp/session/xrpl"` \| `"mpp/session/xrpl/stock"` \| `"mpp/session/hedera/stock"` \| `"mpp/charge/card"` \| `"mpp/charge/stripe"` \| `"mpp/subscription/stripe"` \| `"mpp/charge/usdc/evm"` \| `"mpp/charge/usdc/solana"` \| `"mpp/charge/usdc/stacks"` \| `"mpp/charge/usdc/gateway"`

The id of each MPP pairing `pairingsOf` can name.

***

### MppUnsigned

> **MppUnsigned** = \{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"evm-call"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

What the buyer's signer is handed for each EVM charge, and how its answer completes the credential. Each
`complete` measures the credential it would return as `bound` measures every credential, its echoed challenge
included, and refuses one over the credential size bound, 64 KiB, with `mpp/credential-malformed`, the code `bound`
gives it.

#### Union Members

##### Type Literal

\{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

***

##### Type Literal

\{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"evm-call"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | An EIP-1559 transaction of the call, or its hash once broadcast. Unbroadcast, `complete` takes the signed transaction: one that is not 1 to 65,536 bytes of hex, or whose credential is over the credential size bound, is `mpp/credential-malformed`, the code `bound` gives that credential before its verdict, `mpp/no-signed-place`; then one that is not an EIP-1559 transaction (`0x02` and the RLP list of its twelve fields) is `mpp/credential-malformed`, and one signed for a chain other than `chainId` is `evm/chain-mismatch`. |
| `request.broadcast` | `boolean` | - |
| `request.call` | `object` | - |
| `request.call.data` | [`Hex`](evm.md#hex) | - |
| `request.call.to` | [`Hex`](evm.md#hex) | - |
| `request.chainId` | `number` | - |
| `request.kind` | `"evm-call"` | - |
| `complete()` | (`signedTxOrHash`) => [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) | - |

***

### Presentation

> **Presentation** = `Seen`\<`bigint`, `EvmMark`\>\[`"presented"`\]

Whether an act is the payment the reference was built from, `Seen.presented`.

***

### RailSessionUnsigned

> **RailSessionUnsigned** = `HederaSessionUnsigned` \| [`SolanaSessionUnsigned`](#solanasessionunsigned) \| `XrplSessionUnsigned`

***

### ReceiveTypedData

> **ReceiveTypedData** = `Omit`\<[`Eip3009TypedData`](evm.md#eip3009typeddata), `"primaryType"` \| `"types"`\> & `object`

EIP-3009's `ReceiveWithAuthorization`: the same fields as `TransferWithAuthorization`, for a payee contract.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `primaryType` | `"ReceiveWithAuthorization"` |
| `types` | `object` |
| `types.EIP712Domain` | [`Field`](evm.md#field)[] |
| `types.ReceiveWithAuthorization` | [`Field`](evm.md#field)[] |

***

### SessionStatus

> **SessionStatus** = [`EvmBreadthStatus`](evm.md#evmbreadthstatus)

What these pairings' `status` answers, in the terms of `EvmBreadthStatus`.

***

### SessionUnsigned

> **SessionUnsigned** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-funding-1"></a> `funding` | \{ `kind`: `"eip712"`; `typedData`: [`ReceiveTypedData`](#receivetypeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \} \| \{ `broadcast`: `false`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \} |

#### Methods

##### complete()

> **complete**(`funded`, `voucherSignature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

The opening's credential for `funded` and the voucher signature. On every funding it is measured as `bound`
measures every credential, its echoed challenge included: one over the credential size bound, 64 KiB, is
`mpp/credential-malformed`, the code `bound` gives it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `funded` | `` `0x${string}` `` |
| `voucherSignature` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

##### voucher()

> **voucher**(`funded`): [`Refusal`](index.md#refusal) \| [`VoucherTypedData`](#vouchertypeddata)

`funded`: the funding signature, transaction hash or signed `0x76` transaction. A `tempo-call` funding's `complete`
returns no credential `bound` refuses: it gives the code `bound` gives the credential it would give for the signed
transaction, and `voucher` refuses the same transactions, with the shortest voucher signature `complete` takes, one
byte. So both refuse a transaction that does not decode, an empty one among them, is signed for a chain other than
`funding.chainId`, whose signature gives no sender (a keychain signature of type `0x03` among them), or whose
`aa_authorization_list` holds an entry that is not a list of four items ending in a signature or one signed with
a keychain signature of type `0x03` (`tempo/tx-malformed`); one without the `open` call `funding.call` describes,
to its escrow with H as its salt; one whose sender is not the build's `from`, or whose `open` call names another
payee, operator, token or authorizedSigner, which the credential's descriptor or channel id names; and one whose
credential is over the credential size bound (`mpp/credential-malformed`). On an `eip712` funding,
`voucher` likewise gives what `complete` gives `funded` with a one-byte voucher signature where that is a refusal:
a funding signature or hash not in the form `complete` takes, or a credential over the credential size bound,
each `mpp/credential-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `funded` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`VoucherTypedData`](#vouchertypeddata)

***

### TempoSplitQuery

> **TempoSplitQuery** = `EvmQuery`\<[`TempoSplitRef`](#temposplitref)\>

What `status` takes beside the reference and the reader: its search position is a block number.

***

### TempoSplitStatus

> **TempoSplitStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>

What `status` answers: block numbers, EVM marks, the search position a block number.

***

### UsdcUnsigned

> **UsdcUnsigned** = \{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: [`AtrHash`](index.md#atrhash); `recipient`: `string`; `sender`: `string`; \}; `chainId`: `number`; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

What the signer is handed for each `usdc` profile, and how its answer completes the credential. Each `complete`
measures the credential it would return as `bound` measures every credential, its echoed challenge included, and
refuses one over the credential size bound, 64 KiB, with `mpp/credential-malformed`, the code `bound` gives it.

#### Union Members

##### Type Literal

\{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

***

##### Type Literal

\{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: [`AtrHash`](index.md#atrhash); `recipient`: `string`; `sender`: `string`; \}; `chainId`: `number`; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | The transfer to sign for the challenge's chain, `chainId`, at that network's version: 0x00 on chain 1, mainnet, and 0x80 on any other. `complete` takes the signed transaction's bytes, and refuses a value that is not a `Uint8Array` with `mpp/credential-malformed`. It then checks in `bound`'s order: a credential over the credential size bound, its echoed challenge included, is `mpp/credential-malformed`, read first; then bytes that are empty, over 16,384 bytes or that a Stacks node does not decode are `mpp/stacks-tx-malformed`, and a transaction of another chain id or version is `stacks/chain-mismatch`, as `bound` refuses them. |
| `request.anchorMode` | `"onChainOnly"` | - |
| `request.args` | `object` | - |
| `request.args.amount` | `string` | - |
| `request.args.memo` | [`AtrHash`](index.md#atrhash) | - |
| `request.args.recipient` | `string` | - |
| `request.args.sender` | `string` | - |
| `request.chainId` | `number` | - |
| `request.contract` | `string` | - |
| `request.functionName` | `"transfer"` | - |
| `request.kind` | `"stacks-contract-call"` | - |
| `request.postCondition` | `"SentEq"` | - |
| `request.postConditionMode` | `"deny"` | - |
| `complete()` | (`serializedTx`) => [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) | - |

***

##### Type Literal

\{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

***

### WithinSigningRequest

> **WithinSigningRequest** = \{ `kind`: `"eip712"`; `typedData`: [`VoucherTypedData`](#vouchertypeddata) \| `HederaVoucherTypedData`; \} \| \{ `kind`: `"ed25519-raw"`; `message`: `Uint8Array`\<`ArrayBuffer`\>; `signer`: `string`; \} \| \{ `bytes`: `Uint8Array`\<`ArrayBuffer`\>; `channelId`: `string`; `drops`: `bigint`; `kind`: `"xrpl-claim"`; \}

A request to the buyer's signer for an in-channel payment.

## Variables

### CARRIER

> `const` **CARRIER**: \{ readonly \[i in MppIntent\]: \{ readonly \[m in MppMethod\]?: readonly string\[\] \| null \} \} = `CARRIERS.byMethod`

The request member a pairing writes H into, by intent and method; null where no request member carries it. It is
derived from the MPP entries' `carrier` datum: each pairing's `carrier.member`, keyed by the intent and method its
id names. `usdc` carries H in a request member only on its Solana profile, which `USDC_CARRIER` keys by profile.

***

### chargeCard

> `const` **chargeCard**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/card`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment the
payer's credential authorizes to its processor; nothing here reads it.

***

### chargeNearIntents

> `const` **chargeNearIntents**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`, `named?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`credential`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| `NearIntentsRef`\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/nearintents`. The payer broadcasts (`broadcaster` answers `"payer"` for a credential of `type` `hash`):
it sends its deposit before presenting the deposit's hash. Settlement is the resource server's report: no
`fetchPresented`, `status` or `recover` reads it, and `reference` names the deposit by its origin network and hash. A
credential of any other type gets `near/not-hash-credential`, as `bound` refuses it.

***

### chargeSolana

> `const` **chargeSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/solana`: a challenge whose `methodDetails.feePayer` is `true`, under which the stock client refuses to
broadcast from `@solana/mpp` 0.6.0. A `signature` credential, which an older client pushes, is a payment that
already moved.

***

### chargeSolanaUnsponsored

> `const` **chargeSolanaUnsponsored**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/solana/unsponsored"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/solana/unsponsored`: a challenge of the `solana` method that does not set `feePayer: true`.

***

### chargeStripe

> `const` **chargeStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/stripe`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's server creates the Stripe
payment with the payer's shared payment token; nothing here reads it.

***

### chargeUsdcEvm

> `const` **chargeUsdcEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppEip3009Ref`](#mppeip3009ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/usdc/evm`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
`authorization`): the payer signs an EIP-3009 authorization, and the seller's server submits it and pays the gas;
`status` reads that transaction. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### chargeUsdcGateway

> `const` **chargeUsdcGateway**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/usdc/gateway`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
`transfer`): the seller's server submits the burn intent the payer signed through Circle Gateway, which settles it;
no `status` reads it. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### chargeUsdcSolana

> `const` **chargeUsdcSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/usdc/solana`, which takes only `type="transaction"` credentials. The payee broadcasts (`broadcaster`
answers `"payee"` for them): the seller's server broadcasts the transaction the payer signed, and `status` reads it.
A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### chargeUsdcStacks

> `const` **chargeUsdcStacks**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `chainId`: `number`; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`StacksRef`](stacks.md#stacksref), `"payee"`\> & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/usdc/stacks`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
`transaction`): the seller's server sponsors and broadcasts the Stacks transaction the payer signed; `status` reads
it. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### chargeXrpl

> `const` **chargeXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplChargeUnsigned`](#xrplchargeunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/xrpl`. `broadcaster` answers by the credential's `type`. `transaction`, `"payee"`: the seller's server
submits the signed blob, and `status` reads it. `hash`, `"payer"`: the payer broadcast the transaction, which
`fetchPresented` reads, then `status`. A credential of any other type gets `mpp/credential-type`, as `bound` refuses
it.

***

### evmAuthorization

> `const` **evmAuthorization**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppEip3009Ref`](#mppeip3009ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/charge/evm/authorization`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
`authorization`): the payer signs an EIP-3009 authorization, and the seller's server submits
`transferWithAuthorization` with it; `status` reads that transaction. A credential of any other type gets
`mpp/credential-type`, as `bound` refuses it.

***

### evmHash

> `const` **evmHash**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppNamedRef`](#mppnamedref) & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/charge/evm/hash`, whose `build` writes `broadcast: true`. `broadcaster` answers by the credential's `type`, as
`reference` and `status` take either: `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads by
that hash; `transaction`, `"payee"`, a signed transaction the seller's server broadcasts, naming its hash to
`status`. A credential of any other type gets `mpp/no-signed-place`, the code `bound` gives every credential within
its shape gate.

***

### evmPermit2

> `const` **evmPermit2**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`, `issue?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppPermit2Ref`](#mpppermit2ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/charge/evm/permit2`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type` `permit2`):
the payer signs a Permit2 transfer, and the seller's server, the `spender` it names, submits it to Permit2; `status`
reads that transaction. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### evmTransaction

> `const` **evmTransaction**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppNamedRef`](#mppnamedref) & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/charge/evm/transaction`, whose `build` writes `broadcast: false`. `broadcaster` answers by the credential's
`type`, as `reference` and `status` take either: `transaction`, `"payee"`, a signed transaction the seller's server
broadcasts, naming its hash to `status`; `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads
by that hash. A credential of any other type gets `mpp/no-signed-place`, the code `bound` gives every credential
within its shape gate.

***

### LEGAL\_CONTEXT\_METADATA\_KEY

> `const` **LEGAL\_CONTEXT\_METADATA\_KEY**: `"legal_context"` = `"legal_context"`

The Stripe metadata key the seller places H under: at most 40 characters, no square brackets.

***

### MPP\_BINDINGS

> `const` **MPP\_BINDINGS**: readonly \[`Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppEip3009Ref`](#mppeip3009ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`, `issue?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppPermit2Ref`](#mpppermit2ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppNamedRef`](#mppnamedref) & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppNamedRef`](#mppnamedref) & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/tempo/split-memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoSplitRef`](#temposplitref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TempoSplitStatus`](#temposplitstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoLandedCredential`](#tempolandedcredential)\>; `id`: `"mpp/charge/tempo/split-memo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoSplitRef`](#temposplitref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TempoSplitStatus`](#temposplitstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`, `account?`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/solana/unsponsored"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| [`Refusal`](index.md#refusal); `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaSessionUnsigned`](#solanasessionunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/solana/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| [`Refusal`](index.md#refusal); `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/session/solana/stock"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplChargeUnsigned`](#xrplchargeunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`, `named?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`credential`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| `NearIntentsRef`\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: () => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/xrpl/stock"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplChannelRef`](xrpl.md#xrplchannelref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: () => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/hedera/stock"`; `pattern`: \{ `forwardIndexable`: `false`; `onChain`: `true`; `pattern`: `"opaque-challenge"`; `profile`: `string`; `zeroPartyRecoverable`: `false`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaStockRef`](#hederastockref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`HederaStockStatus`](#hederastockstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & [`MppEip3009Ref`](#mppeip3009ref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StatusAnswer`](index.md#statusanswer)\<`bigint`, `EvmMark`\>\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `chainId`: `number`; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`StacksRef`](stacks.md#stacksref), `"payee"`\> & `object`\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>\]

Every MPP pairing this entry point implements.

***

### sessionEvm

> `const` **sessionEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/session/evm`. `broadcaster` answers by the payment's action and type (`evmBroadcasts`), for the actions
`channel.kind` takes, and every answer is `"payee"`: an opening or a top-up of type `authorization` or `permit2`,
which the seller's server submits to the escrow; a voucher, which it redeems when it settles or closes; and the
close, the escrow call it sends, which `closeRef` and `status` read. An opening funded by a `hash`, a transaction
the buyer's client broadcasts, is no part of the pairing: it gets the refusal `bound` gives it, `mpp/credential-type`,
as an opening of any other type does, and `mpp/not-an-opening` for a top-up of another type or any other action.

***

### sessionHederaStock

> `const` **sessionHederaStock**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: () => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/hedera/stock"`; `pattern`: \{ `forwardIndexable`: `false`; `onChain`: `true`; `pattern`: `"opaque-challenge"`; `profile`: `string`; `zeroPartyRecoverable`: `false`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaStockRef`](#hederastockref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`HederaStockStatus`](#hederastockstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/session/hedera/stock`, the stock client's session at coverage `none`, served after the agreement. `broadcaster`
answers `"payer"` for the opening and a top-up, which the buyer's client sends, and `"payee"` for a voucher and the
close; `status` reads the opening (`hederaStockStatus`).

***

### sessionSolanaMemo

> `const` **sessionSolanaMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaSessionUnsigned`](#solanasessionunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/solana/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/session/solana/memo`. The payee broadcasts every payment the session takes (`broadcaster` answers `"payee"`
for the actions `channel.kind` takes: the opening, which the seller's server co-signs as the operator and submits,
a voucher, a commit and the close). A top-up, which the payer's client broadcasts, and any other action get
`mpp/not-an-opening`, as `bound` refuses them.

***

### sessionSolanaStock

> `const` **sessionSolanaStock**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| [`Refusal`](index.md#refusal); `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) & `object`\>; `id`: `"mpp/session/solana/stock"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/session/solana/stock`, at coverage `none`: the buyer's client broadcasts the stock opening, which carries no
H, after the agreement is recorded. `broadcaster` answers `"payer"` for the opening; every later credential is
`mpp/not-an-opening`. The opening's account is the `open`'s payer (account 0), never its `authorizedSigner`.

***

### sessionTempo

> `const` **sessionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/session/tempo`, whose `build` writes `broadcast: false`. The payee broadcasts every payment the session takes
(`broadcaster` answers `"payee"` for the actions `channel.kind` takes, and an opening of `type` `transaction`), as
draft-tempo-session-00 has it: the seller's server broadcasts the signed transaction of an opening or a top-up, which
`status` reads, redeems vouchers when it settles or closes, and sends the close, which `closeRef` and `status` read.
Any other credential gets `mpp/not-an-opening`, as `bound` refuses it.

***

### sessionXrpl

> `const` **sessionXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/session/xrpl`. The payee broadcasts every payment the session takes (`broadcaster` answers `"payee"` for the
actions `channel.kind` takes: the opening, a voucher and the close): the seller's server submits the signed
`PaymentChannelCreate` the opening carries, which `status` reads, redeems claims when it closes, and sends the close,
which `closeRef` and `status` read. Any other action, a top-up among them, gets `mpp/session-action`, as `bound`
refuses it.

***

### sessionXrplStock

> `const` **sessionXrplStock**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: () => `number` \| `undefined`; \}\>; `claims`: `false`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/session/xrpl/stock"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplChannelRef`](xrpl.md#xrplchannelref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/session/xrpl/stock`, a stock client's session at coverage `none`, served after the agreement. The buyer's client
opens the channel itself, out of band, which is no credential of the pairing, and presents vouchers that name it. The
payee broadcasts every payment the pairing takes: it redeems the vouchers and submits the close's
`PaymentChannelClaim` from the recipient's wallet (`xrpl-mpp-sdk` 0.1.0-beta.4, `dist/channel/server/index.js:686-697`),
so `broadcaster` answers `"payee"` for a voucher and for a close; an `open` is `mpp/session-action`. `status` reads
the channel's create (`xrplChannelStatus`).

***

### subscriptionSolana

> `const` **subscriptionSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| [`Refusal`](index.md#refusal); `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/subscription/solana`. The payee broadcasts (`broadcaster` answers `"payee"` for a `type="transaction"`
credential): the activation's `transfer_subscription` needs the signature of the challenge's `puller`, the seller's
key, which the payer's client does not hold (`@solana/mpp` 0.7.0 `src/client/Subscription.ts:230`), so the seller's
server co-signs and submits it. A credential of any other type is `mpp/credential-type`, as `bound` refuses it.

***

### subscriptionStripe

> `const` **subscriptionStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/subscription/stripe`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's server creates the
Stripe subscription with the payer's shared payment token and reports its activation; nothing here reads it.

***

### subscriptionTempo

> `const` **subscriptionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`, `account?`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

`mpp/subscription/tempo`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
`keyAuthorization`, the one `channel.kind` takes): the payer's root key signs a key authorization, and the seller's
server sends the activation transaction that registers its access key, and each later transfer under that key;
`status` reads the activation, and `keySearch` the transfers. A credential of any other type gets
`mpp/not-an-opening`, as `bound` refuses it.

***

### tempoSplitMemo

> `const` **tempoSplitMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"mpp/charge/tempo/split-memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoSplitRef`](#temposplitref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TempoSplitStatus`](#temposplitstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/tempo/split-memo`, the pull form. The payee broadcasts (`broadcaster` answers `"payee"` for a credential
of `type` `transaction`): the resource server's settler broadcasts the signed transaction the credential carries. A
credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### tempoSplitMemoPush

> `const` **tempoSplitMemoPush**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `position`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoLandedCredential`](#tempolandedcredential)\>; `id`: `"mpp/charge/tempo/split-memo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`TempoSplitRef`](#temposplitref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`TempoSplitStatus`](#temposplitstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

`mpp/charge/tempo/split-memo/push`. The payer broadcasts (`broadcaster` answers `"payer"` for a credential of `type`
`hash`) and names the transaction by its hash: `fetchPresented` reads it, then `bound` reads H in its signed bytes.
A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.

## Functions

### attributionMemo()

> **attributionMemo**(`realm`, `challengeId`, `clientId?`): `` `0x${string}` ``

MPP's 32-byte attribution memo: keccak256("mpp")[0..3], `0x01`, keccak256(realm)[0..9], keccak256(clientId)[0..9]
or ten zero bytes, then keccak256(challengeId)[0..6], each over the string's UTF-8. A string that is not well-formed
is written as `TextEncoder` writes it, with U+FFFD for each lone surrogate. No pairing in this package calls it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `realm` | `string` |
| `challengeId` | `string` |
| `clientId?` | `string` |

#### Returns

`` `0x${string}` ``

***

### challengeBound()

> **challengeBound**(`c`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `request`: \{\[`k`: `string`\]: [`Json`](index.md#json); \}; \}

H from an echoed challenge: its id derives from H in the form its intent and method take, its `opaque` names H, and
its `request` decodes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `request`: \{\[`k`: `string`\]: [`Json`](index.md#json); \}; \}

***

### checkAttribution()

> **checkAttribution**(`memo`, `realm`, `challengeId`): `true` \| [`Refusal`](index.md#refusal)

Checks a memo's tag, version, server id for `realm` and nonce for `challengeId`. The client id is not read. A `realm`
or `challengeId` that is not well-formed is hashed as `attributionMemo` hashes it, with U+FFFD for each lone
surrogate. No pairing in this package calls it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `memo` | `string` |
| `realm` | `string` |
| `challengeId` | `string` |

#### Returns

`true` \| [`Refusal`](index.md#refusal)

***

### evmChannelId()

> **evmChannelId**(`c`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)); also Tempo v1's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | \{ `authorizedSigner`: `` `0x${string}` ``; `chainId`: `number`; `escrow`: `` `0x${string}` ``; `payee`: `` `0x${string}` ``; `payer`: `` `0x${string}` ``; `salt`: `` `0x${string}` ``; `token`: `` `0x${string}` ``; \} |
| `c.authorizedSigner` | `` `0x${string}` `` |
| `c.chainId` | `number` |
| `c.escrow` | `` `0x${string}` `` |
| `c.payee` | `` `0x${string}` `` |
| `c.payer` | `` `0x${string}` `` |
| `c.salt` | `` `0x${string}` `` |
| `c.token` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### hederaStockStatus()

> **hederaStockStatus**(`ref`, `reader`, `query`): `Promise`\<[`HederaStockStatus`](#hederastockstatus)\>

The read of a stock opening, as the profile `read-status` answers it at coverage `none` (the profile
`mpp/session/hedera-solana-xrpl`): the transaction the credential names, by its receipt through the relay, at its one
mark, `finalized`, every block the relay serves being final. A revert took the sender nonce it signed only where it
was executed in the EVM, the mirror's contract result for the hash being `CONTRACT_REVERT_EXECUTED`, one that failed
the node's validations before the EVM leaving the nonce as it was (HIP-844, *Rationale*). Such a revert is the act's
own failed result, `transaction-failed`, where its sender signed the escrow's `open` to the challenge's recipient, as
`eth_getTransactionByHash` gives the call; an `open` to another account consumed the opening's nonce,
`instrument-consumed`, and so does a revert of any other call. Any other failed result, or none on the mirror, shows
no nonce taken, `INSUFFICIENT_GAS` coming both before and in the EVM (HIP-844, *Backward Compatibility*), and the
same signed bytes can still land under the same hash: with the value unread and the lookup not ended, it is
`pending`, `search-incomplete`, never `failed`. A receipt that succeeded holding exactly one `ChannelOpened` from the
escrow naming the channel, whose members give the channel id it names, is the opening: its signer is the account id
the mirror resolves its payer to, or the payer's address where the mirror resolves none, an address of no account; it
is the payee's own act where that account is the one the challenge's `recipient` resolves to; and it names the
payee's account where its `payee` is the `recipient` or resolves to the same account. What moved is the deposit, by
the transaction and the log's place among the receipt's logs. Any other receipt that succeeded consumed the opening's
transaction and is no opening of the channel. No receipt is `not-found` where the mirror holds the blocks after the
position the caller gives, or is archival, and `history-gap` otherwise. The read reads no nonce state and makes no
search, the named transaction's receipt, and for a revert its contract result, being all it reads of the opening's
sender nonce; it reads the payer against no account: the caller compares the signer with the account that signed the
agreement.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`HederaStockRef`](#hederastockref) |
| `reader` | [`HederaStockReader`](#hederastockreader) |
| `query` | `StockQuery` |

#### Returns

`Promise`\<[`HederaStockStatus`](#hederastockstatus)\>

***

### issuedDigest()

> **issuedDigest**(`given`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

the core's `digestJson` over the bound members, with `request` decoded and its carrier removed (`asIssued`), and
`opaque` decoded without the LCP members (omitted when that leaves it empty). A value that does not decode is its
string. An `opaque` that is the object of its members, as a credential may echo it (`opaqueMembers`), is read by
those members. A challenge of a pairing whose quote or invoice the seller writes after H is read as `unplacedChallenge`
gives it, so that the digest covers the members fixed at issue alone.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `given` | [`MppChallenge`](#mppchallenge) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### keySearch()

> **keySearch**(`ref`, `receipt`, `h`): [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

The read keys of a transfer made under the subscription's access key, from a receipt of the key's registration: the
account whose key authorization carried `h` and registered the key, then `accessKey` with that account, the token's
`Transfer` to the recipient's digest, and the keychain's `AccessKeySpend` filter for the account, the key and the
token. Refused when `ref` carries no access key (`tempo/no-access-key`), when `h` is not a 32-byte hash
(`mpp/input-malformed`), or when the receipt did not register the key under `h`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SessionRef`](#sessionref) |
| `receipt` | [`EvmReceipt`](evm.md#evmreceipt) |
| `h` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

***

### network()

> **network**(`challenge`): `string` \| [`Refusal`](index.md#refusal)

The CAIP-2 network an MPP challenge pays on, read from its method, intent and `methodDetails` as each method defines
it, with that method's default where it names one. A method whose challenge names no network is refused.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `challenge` | [`MppChallenge`](#mppchallenge) |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### pairingsOf()

> **pairingsOf**(`c`): [`Refusal`](index.md#refusal) \| readonly [`MppPairingId`](#mpppairingid)[]

Checks a challenge as issued (no LCP member in `opaque`) and names its pairings, in the order they are offered. An
`expires` that is present must be an RFC 3339 date-time, else `mpp/expires-required`. Without `expires`, the pairings
whose `build` writes it into what the payer signs, and the NEAR Intents and XRP Ledger charges, whose drafts require
it, are left out, and a challenge left with no pairing is `mpp/expires-required`. These checks are each pairing's one
filter: they include every check its `build`, `bound` and `reference` make on the challenge alone, and those take
only a challenge `pairingsOfPlaced` names for the pairing, refusing any other with the code these checks give it
(`mpp/not-this-pairing` where they name only other pairings).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

[`Refusal`](index.md#refusal) \| readonly [`MppPairingId`](#mpppairingid)[]

***

### pairingsOfPlaced()

> **pairingsOfPlaced**(`c`): readonly [`MppPairingId`](#mpppairingid)[]

The pairings a placed challenge offers: `pairingsOf`'s checks over the challenge with the LCP members `place` writes
allowed in its `opaque`, which must decode as a map of strings, so they are not read as an occupied carrier, and
with the carrier the seller writes after `place` required where `pairingsOf` takes a challenge without it (the
Lightning invoice). These are the pairings whose `build` takes the challenge and whose `bound` and `reference` take it
echoed. None when the challenge does not read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

readonly [`MppPairingId`](#mpppairingid)[]

***

### parseChallenges()

> **parseChallenges**(`fieldValues`): [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

Reads `WWW-Authenticate` field values by RFC 9110's challenge grammar and keeps the `Payment` challenges, with
quoted-strings unescaped and unknown parameters dropped. At most 8 KiB per value and 32 `Payment` challenges.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldValues` | readonly `string`[] |

#### Returns

[`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

***

### place()

> **place**(`doc`, `h`, `link`, `option`, `position`, `agreementUrl?`): [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

A copy of `doc` in which the challenge whose bound members equal `option` carries the id derived from H at
`position` and an `opaque` holding the seller's map plus `legalContext`, `legalContextUrl` and, when given,
`legalContextAgreementUrl`. The caller gives each challenge of a sale its own position, 0 to 31, the charge and
agreement challenges of the sale together; a Tempo subscription challenge takes `null`, its id being the bare
base64url of H. A position out of that range, a number for a Tempo subscription challenge or `null` for any other is
`mpp/challenge-malformed`, and a position whose id another challenge of `doc` already carries is
`mpp/position-taken`. A `doc` holding a challenge that carries a `refused` member is `mpp/challenge-malformed`, as one
holding a challenge without the required members is.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | readonly [`MppChallenge`](#mppchallenge)[] |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `option` | [`MppChallenge`](#mppchallenge) |
| `position` | `number` \| `null` |
| `agreementUrl?` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

***

### problem()

> **problem**(`code`): `object`

The Payment scheme's problem type and HTTP status for a refusal code this package returns, from the scheme's Status
Codes and Error Codes tables, under `https://paymentauth.org/problems/`:
- 402 `malformed-credential`: `mpp/credential-malformed`, `mpp/request-malformed` and `mpp/opaque-malformed`;
- 402 `invalid-challenge`: `mpp/id-not-ours`;
- 500 `internal-payment-error`: a read to repeat, a code `readToRepeat` answers true for, so the seller asks again
  later: a reader that failed or answered out of its form (`<rail>/unreadable`), no landed transaction yet
  (`<rail>/not-found`), or a transaction not final yet, such as a revert above the reader's `finalized` mark
  (`tempo/not-final`) or one not in a validated ledger (`xrpl/not-validated`);
- 500 `internal-payment-error`: a call that cannot read the payment, which gives the same code until the seller
  changes the call: a reader that is not for the network the challenge or reference names, or a ref `recover`
  cannot read (`tempo/wrong-reader`, `svm/wrong-reader`, `xrpl/wrong-reader` and `hedera/wrong-reader`), and `bound`
  or `reference` on a push credential before `fetchPresented` has read it (`svm/read-first` and `xrpl/read-first`);
- 402 `verification-failed`: every other code this package returns;
- 500 `internal-payment-error`: a code this package does not return. The caller answers its own codes itself.

The seller answers a 402 with a fresh challenge and a 500 with no challenge: a challenge goes out only with a 402.
Neither carries `Payment-Receipt`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `string` |

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `status` | `402` \| `500` |
| `type` | `string` |

***

### read()

> **read**(`doc`): [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}

The buyer's reading: the challenges whose `opaque` carries an LCP hash and an `https` link and whose id derives from
that hash, in document order. `agreement` is their agreement URL when one is present. A link or agreement URL of at
most 2048 characters that parses as an absolute URL with a scheme other than `https` is `mpp/link-not-https`, and
any other value that is not a link is `mpp/legal-context-malformed`; with no challenge read, a link of another scheme
in any challenge gives `mpp/link-not-https`, else a malformed link gives `mpp/legal-context-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | readonly [`MppChallenge`](#mppchallenge)[] |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}

***

### sessionResume()

> **sessionResume**(`c`): [`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \} \| `null`

The network and channel a session challenge names for the client to resume, spelled as the pairing's `channel.ref`
spells it: EVM, Tempo and Hedera in `methodDetails.channelId` (a bytes32, lowercase), XRPL in the request's
`channelId` (64 hex characters, upper case). Null
when the challenge names no channel; refused for a challenge of no session pairing, or a channel or network that
cannot be read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \} \| `null`

***

### sessionStatus()

> **sessionStatus**(`ref`, `reader`, `query`): `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>

The status of an opening or a close of any of the three pairings, answered as the profile `read-status` does at the
coverage of the pairing whose keys the ref names. The read is `evmStatus`'s on the named logs, then, where
`ref.opened` is present, one `ChannelOpened` log from `opened.address` naming the channel: on v2 its data word 3 (the
salt) is `h`; on v1 the channel id recomputed from the event with salt `h` is the channel. A ref with `opens` is the
EVM session's opening, read by its funding (`mppSessionOpeningStatus`), not by the named transaction. Where `ref.closes`
is present, the succeeded transaction must be a call to that escrow whose calldata starts with one of
`EVM_CLOSE_SELECTORS` and whose first argument is that channel. Where `ref.accessKey.account` is present, the
succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token.
Where `ref.revokes` is present, the succeeded receipt must hold the account keychain's `KeyRevoked` log naming that
account and key. A transaction that fails one of these checks (an open call for another channel, any other
transaction, one sent through an ERC-4337 EntryPoint included, a call that is not the close, a missing log) is no
act, and with no search for H yet answers `pending` `search-incomplete`, as `evmStatus`'s reasons do. Settled carries
the highest mark reached and the receipt's block. An `opened` that is not one whose `address` is an
address, `version` `v1` or `v2`, `channel` and `h` 32-byte hashes and `chainId` a positive integer, a `closes` that
is not an object whose `escrow` is an address and `channel` a 32-byte hash, an `accessKey` that is not an object
whose `keyId` and `token` are addresses, `to` a 32-byte hash and `account`, when present, an address, or a `revokes`
that is not an object whose `account` and `keyId` are addresses, is unreadable `unparseable`, with no call made; so
is a ref that names none of the keys the three pairings' `reference`, `closeRef` and `keySearch` write for the
opening or the close (`opens`, `opened`, `closes`, `revokes`, an `accessKey` with `account`, or a binding log under
`ChannelClosed` or `KeyAuthorizationWitness`), and a query that is not one `status` takes. A
reader that is not an object is unreadable `transport`; what `evmStatus` reads as unreadable is unreadable for the
same reason. At most four calls.

This function accepts a key of any of the three pairings. Each pairing's own `status` reads a ref only when it names
one of the keys that pairing writes and none of the other two pairings' keys: on `mpp/session/evm` `opens` or
`closes`; on `mpp/session/tempo` `opened` or a binding log under `ChannelClosed`;
on `mpp/subscription/tempo` `revokes`, an `accessKey` with `account` or a binding log under
`KeyAuthorizationWitness`. Any other ref is unreadable `unparseable` there, with no call made.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SessionRef`](#sessionref) & `object` |
| `reader` | [`EvmReader`](evm.md#evmreader) |
| `query` | `EvmQuery`\<[`SessionRef`](#sessionref) & `object`\> |

#### Returns

`Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>

***

### tie()

> **tie**(`options`): \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]

The binding slot: the distinct challenges among `options`, each with exactly MPP's bound members, as issued. A
challenge of a pairing whose quote or invoice the seller writes after H is bound as `unplacedChallenge` gives it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`MppChallenge`](#mppchallenge)[] |

#### Returns

\[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]

***

### toX402()

> **toX402**(`credential`, `token`): [`Refusal`](index.md#refusal) \| [`X402Mapped`](#x402mapped)

The x402 `exact` EIP-3009 payment and requirements of an MPP `evm` `authorization` credential or `usdc` EVM
credential: `scheme` `exact`, `network` `eip155:<chainId>`, `amount`, `asset` and `payTo` the request's `amount`,
`currency` and `recipient`, `extra` the token's EIP-712 `name` and `version` the caller gives, and
`maxTimeoutSeconds` the window the payer signed, `validBefore` less `validAfter`; the payload's `authorization` is the
credential's `from`, `to`, `value`, `validAfter`, `validBefore` and `nonce`, with its `signature`. The echoed challenge
is held to the pairing's filter as an issued one is, so it need not carry H. A credential of any other form, a Permit2
witness, a Gateway burn intent, a challenge with splits and every non-EVM form among them, is `mpp/no-x402-twin`; a
payload member out of its form, or a `validBefore` not after `validAfter`, is `mpp/credential-malformed`; a token
domain that is not two strings of 1 to 256 characters is `mpp/input-malformed`. It compares nothing the payment pays
with the challenge: the facilitator's verification does.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `credential` | `unknown` |
| `token` | [`TokenDomain`](#tokendomain) |

#### Returns

[`Refusal`](index.md#refusal) \| [`X402Mapped`](#x402mapped)

***

### transferPresent()

> **transferPresent**(`ref`, `reader`, `query`): `Promise`\<[`MppEvmStatus`](#mppevmstatus)\>

The `status` of the EVM `transaction` and `hash` charges, whose data both give coverage `none`: the act is the
transaction the reference names, which the credential carries (`transaction`, by the hash of its signed bytes) or
names (`hash`). Found, it is read whole: its signer, the transaction's `from`, against the reference's payer and the
option's payee, so that one the payee signed is no act of the payer's; what it moved, each `Transfer` from its signer
by its log, with its token, amount and recipient, never the system emitter's log that Arc adds beside each USDC
transfer; the account test, a transfer to the challenge's `recipient`, its token and amount compared with nothing,
and for a reverted one, which moved nothing, the recipient of the `transfer` call that is the transaction's own; and
its result, the payer's account nonce consumed by its inclusion. So a reverted one whose call pays the `recipient` is
`failed`, `transaction-failed`, any other reverted one `failed`, `instrument-consumed`, and one that succeeded with no
transfer to the `recipient` `failed`, `instrument-consumed`, `other-account`, each at the final mark, and `pending`,
`below-mark`, under it. Not
found, it is `pending`, `not-found`, where the reader shows it holds the history the transaction would be in: an
endpoint the seller declares archival (`archival`), or one that answers a read at the position the caller gives;
otherwise `unreadable`, `history-gap`. `settled` states `presented: "yes"`, the act being the transaction the
credential names.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`MppNamedRef`](#mppnamedref) |
| `reader` | [`MppEvmReader`](#mppevmreader) |
| `query` | `EvmQuery`\<`unknown`\> |

#### Returns

`Promise`\<[`MppEvmStatus`](#mppevmstatus)\>

***

### usdcGatewaySalt()

> **usdcGatewaySalt**(`i`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

`usdc`'s Gateway salt: keccak256 of the JCS of the inputs with `method` "usdc", `intent` "charge", `type` "gateway".

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`GatewaySaltInput`](#gatewaysaltinput) |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### usdcNonce()

> **usdcNonce**(`id`, `realm`, `requestHash`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

`usdc`'s EIP-3009 nonce: keccak256 of the JCS of `{id, method: "usdc", realm, intent: "charge", requestHash}`, with
`requestHash` written as `0x` and 64 lowercase hex.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `realm` | `string` |
| `requestHash` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### usdcRequestHash()

> **usdcRequestHash**(`requestParam`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

keccak256 of the challenge's `request` parameter's decoded bytes, as `0x` and lowercase hex. The bytes must be the
RFC 8785 form of their own parse, else `mpp/request-not-jcs`; they are hashed as received.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `requestParam` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### challengeH

Re-exports [challengeH](index.md#challengeh)

***

### challengeHash

Re-exports [challengeHash](index.md#challengehash)

***

### challengeId

Re-exports [challengeId](index.md#challengeid)

***

### FETCHED

Re-exports [FETCHED](index.md#fetched)
