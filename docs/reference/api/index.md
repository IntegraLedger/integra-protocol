---
title: "@integraledger/lcp"
description: "The package root of `@integraledger/lcp`: the core functions of `@integraledger/lcp/core`, the registry of every pairing (`BINDINGS`, `pairingOf`) and its types, and the return after an agreement."
---

# @integraledger/lcp

The package root of `@integraledger/lcp`: the core functions of `@integraledger/lcp/core`, the registry of every
pairing (`BINDINGS`, `pairingOf`) and its types, and the return after an agreement.

The core functions assemble an ATR and hash its exact bytes, compare hashes, give the hash's string and structured
forms, and hold the https-link rule, `isRefusal` and `readToRepeat`. The return after an agreement is the
`Legal-Context` header, its check, and the charge options an agreement option serves. The root also exports MPP's
challenge id and its hash (`challengeId`, `challengeH`, `challengeHash`); the package's size bounds; and `FETCHED`,
the key under which a pairing's `fetchPresented` writes the seller's read onto a credential.

## Interfaces

### AgreementData

Present where the pairing's payment can itself be an agreement.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-fee"></a> `fee` | `readonly` | `string` | Who can pay the fee, by the chain and the published scheme. |
| <a id="property-feepayer"></a> `feePayer?` | `readonly` | [`FeePayer`](#feepayer) | `fee` as data: the parties that can pay it, and the one that pays where the option names none. |
| <a id="property-floor"></a> `floor` | `readonly` | `"0"` \| `` `1${string}` `` \| `` `2${string}` `` \| `` `3${string}` `` \| `` `4${string}` `` \| `` `5${string}` `` \| `` `6${string}` `` \| `` `7${string}` `` \| `` `8${string}` `` \| `` `9${string}` `` \| `"rule"` | The smallest amount the scheme and token admit, in base units: `"0"`, or a decimal with no sign and no leading zero; or `rule`, a rule over a ledger parameter that the pairing's profile states and its entry point's floor function evaluates: `cardanoFloor`, `suiFloor` or `starknetFloor`. |
| <a id="property-only"></a> `only?` | `readonly` | `true` | Present where the form is offered as an agreement and never as a charge. |
| <a id="property-succeeded"></a> `succeeded` | `readonly` | `string` | The fields that show the transaction succeeded. |

***

### AptosPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.transaction` | `string` |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

***

### Authorizer

The optional member of a pull pairing whose payer signs an authorization that the chain executes later: the account
whose signature authorises the pull, from the presented payment, as lowercase hex. With a `reference` that records
the authorization as `authorization` (its scheme, the contract that records its use, its nonce, deadline and token),
as the MPP EVM `authorization` and `permit2` charges' and the `usdc` EVM charge's do, it is what `authorizationUsed`
(`@integraledger/lcp/evm`) needs to read the authorization's use before any transaction is named. The x402 pull
pairings' references record no `authorization`.

#### Methods

##### authorizer()?

> `optional` **authorizer**(`presented`): `Promise`\<`string` \| [`Refusal`](#refusal)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`Promise`\<`string` \| [`Refusal`](#refusal)\>

***

### BatchPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-1"></a> `extensions?` | `object` |
| <a id="property-payload-1"></a> `payload` | `object` |
| `payload.type` | `string` |
| <a id="property-resource-1"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-1"></a> `x402Version` | `2` |

***

### CardanoPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-2"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-2"></a> `extensions?` | `object` |
| <a id="property-payload-2"></a> `payload` | [`CardanoPayload`](cardano.md#cardanopayload) |
| <a id="property-resource-2"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-2"></a> `x402Version` | `2` |

***

### Carrier

Where H rides.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-member"></a> `member?` | `readonly` | readonly `string`[] | The member of the option or challenge request the seller writes H into, as a path from the option (x402) or from the decoded request (MPP); absent where the seller writes it into none. |
| <a id="property-signed"></a> `signed` | `readonly` | `string` \| `null` | The field of what the payer signs that carries H, in the profile's words; null where none does. |

***

### CarrierAfterH

The optional member of a pairing whose carrier the seller writes after H: `advertise`'s checks and placement, without
the checks on that carrier. It takes the arguments its pairing's `advertise` takes.

#### Methods

##### advertiseBeforeCarrier()?

> `optional` **advertiseBeforeCarrier**(`doc`, `h`, `link`, `offer`, ...`rest`): `unknown`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | `never` |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `offer` | `never` |
| ...`rest` | `never`[] |

###### Returns

`unknown`

***

### CloudflarePaymentPayload

The request's payment document: the option's amount and asset, with the challenge's `extensions` echoed.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-3"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-3"></a> `extensions` | `object` |
| <a id="property-payload-3"></a> `payload` | `object` |
| `payload.amount` | `string` |
| `payload.asset` | `string` |
| <a id="property-x402version-3"></a> `x402Version` | `2` |

***

### Codec

A pairing's codec. `Presented` is what the payer presents, `Ref` the reference `reference` gives, `Reader` the
reader the caller supplies to `status`, `recover` and `fetchPresented`, and `F` the family's other types. A pairing
with no read has no `status` and no `recover`, and takes `never` for `Reader`, and for `Ref` where it has no
`reference`.

`build`, `bound` and `reference` take the act, and `bound` and `reference` H with it, where the caller gives them;
absent means the act `payment`. On a pairing whose single-use value is H itself or H's low bits, the act `agreement`
makes each use the agreement's own value (`agreementValue`, or its low bits as the pairing takes H's) where the
payment uses H; on every other pairing the act changes nothing. `status` takes the act in its query.

#### Type Parameters

| Type Parameter |
| ------ |
| `Presented` |
| `Ref` |
| `Reader` |
| `F` *extends* [`Family`](#family) |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-advertise"></a> `advertise` | `readonly` | (`doc`, `h`, `link`, `offer`, ...`rest`) => [`Refusal`](#refusal) \| `F`\[`"advertised"`\] | The seller's placement: a copy of the document with H and the link placed for `offer` as this pairing places them, and the agreement URL where one is given; the arguments after `offer` are the family's (`F["rest"]`). |
| <a id="property-advertisebeforecarrier"></a> `advertiseBeforeCarrier?` | `readonly` | (`doc`, `h`, `link`, `offer`, ...`rest`) => [`Refusal`](#refusal) \| `F`\[`"advertised"`\] | `advertise` without the checks on a carrier the seller writes after H. |
| <a id="property-bound"></a> `bound` | `readonly` | (`presented`, `given?`) => `Promise`\<[`Refusal`](#refusal) \| `` `0x${string}` ``\> | H as what was presented carries it. Given the act `agreement` and H on a pairing whose agreement has its own value, it checks that what was presented carries that value in H's place, and gives H where it does. |
| <a id="property-broadcaster"></a> `broadcaster` | `readonly` | (`presented`) => `Promise`\<[`Refusal`](#refusal) \| [`Broadcaster`](#broadcaster)\> | Who broadcasts what the payer presents: `"payer"` or `"payee"` (`Broadcaster`). A payment of a type or kind the pairing does not take gets the refusal `bound` gives it. |
| <a id="property-build"></a> `build?` | `readonly` | (`choice`, `h`, `act?`) => `Promise`\<[`Refusal`](#refusal) \| `F`\[`"unsigned"`\]\> | What the payer signs, with H in place, or for the act `agreement` on a pairing whose agreement has its own value, that value. Absent where lcp builds no payment for the pairing: the payer's own client builds it. |
| <a id="property-channel"></a> `channel?` | `readonly` | `object` | For a channel, a session or a subscription. |
| `channel.boundWithin` | `readonly` | (`presented`) => `Promise`\<[`Refusal`](#refusal) \| `` `0x${string}` ``\> | H as a payment within the channel carries it. A pairing whose payments within the channel carry no hash refuses every one (on MPP, `mpp/not-bound-within`). |
| `channel.kind` | `readonly` | (`presented`) => [`Refusal`](#refusal) \| [`ChannelKind`](#channelkind) | Whether the presented payment opens the channel, pays within it, or closes it (`ChannelKind`). |
| `channel.ref` | `readonly` | (`presented`) => `Promise`\<[`Refusal`](#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\> | The network and channel the presented payment belongs to; a payment `kind` refuses gets `kind`'s refusal. |
| `channel.until` | `readonly` | (`presented`) => `number` \| `undefined` | The time, in Unix seconds, after which the channel takes no payment, where the payment states one. |
| <a id="property-fetchpresented"></a> `fetchPresented?` | `readonly` | (`presented`, `reader`) => `Promise`\<[`Refusal`](#refusal) \| `Presented`\> | For a form its payer broadcasts: the presented payment completed with the landed transaction it names. |
| <a id="property-keyproves"></a> `keyProves?` | `readonly` | `string` | What the record proves for a transfer `keySearch` finds. |
| <a id="property-keysearch"></a> `keySearch?` | `readonly` | (`ref`, `receipt`, `h`) => [`Refusal`](#refusal) \| `Ref` | The read keys of a transfer made under a key the payer authorised over H, from the receipt that registered it. |
| <a id="property-landedtx"></a> `landedTx?` | `readonly` | (`presented`) => `string` \| `undefined` | For a form its payer broadcasts: the transaction the presented payment names, or undefined. |
| <a id="property-read"></a> `read` | `readonly` | (`doc`) => [`Refusal`](#refusal) \| `F`\[`"offered"`\] | The buyer's reading of the advertised document: H, the link, the agreement URL where the document carries one, and the offer this pairing serves in it (on x402, an `X402Offer`: the document and the options the pairing serves). |
| <a id="property-recover"></a> `recover?` | `readonly` | (`input`, `reader`) => `Promise`\<[`Refusal`](#refusal) \| `` `0x${string}` ``\> | The value a landed transaction carries in H's place, in H's spelling: H, or H's low bits as the pairing carries them; and from an agreement's transaction on a pairing whose agreement has its own value, that value, which a holder of the ATR compares with `agreementValue` of its own H, since a digest is not read back to H. |
| <a id="property-reference"></a> `reference?` | `readonly` | (`presented`, `option`, `given?`) => `Promise`\<[`Refusal`](#refusal) \| `Ref`\> | The read keys of a presented payment, with the payee of the option it answers; given the act `agreement` and H on a pairing whose agreement has its own value, the single-use value it names is that value. |
| <a id="property-status"></a> `status?` | `readonly` | (`ref`, `reader`, `query`) => `Promise`\<`F`\[`"answer"`\]\> | The read of the act the query asks about, from the reference and what the landed transaction adds to it. |

***

### DataMembers

The members of a pairing's data that do not turn on its coverage.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-asset"></a> `asset?` | `readonly` | `string` | How the asset is identified in the landed transaction. |
| <a id="property-broadcasts"></a> `broadcasts` | `readonly` | [`Broadcaster`](#broadcaster) \| `"either"` | The answers the codec's `broadcaster` can give over every credential type the pairing takes. |
| <a id="property-cardlike"></a> `cardLike?` | `readonly` | `true` | Present where the pairing's payment is card-like: a card, checkout or processor payment, on no ledger or payment network a CAIP-2 id names, which the seller or its processor takes and reports. Lightning's pairings, whose invoice is on an `lnbtc` network, do not have it. |
| <a id="property-carrier"></a> `carrier` | `readonly` | [`Carrier`](#carrier) | - |
| <a id="property-confirmed"></a> `confirmed` | `readonly` | `"no"` \| `"yes"` | Whether something outside lcp has shown the form as its profile defines it. |
| <a id="property-destination"></a> `destination?` | `readonly` | `string` | How the account the act names is identified in the landed transaction. |
| <a id="property-nonce"></a> `nonce` | `readonly` | `"unshown"` \| `"single-use"` \| `"reusable"` | Whether the identical instrument can land more than once; `unshown` until a vector or a run shows single use. |
| <a id="property-payeepreconditions"></a> `payeePreconditions?` | `readonly` | readonly `string`[] | What the payee's account must hold or be on chain before a payment through the pairing can reach it, each in the profile's words: an account, a token association, an asset already held, a funded key. Absent where the pairing's profile states none. |
| <a id="property-payer"></a> `payer?` | `readonly` | `string` | How the payer is identified in the landed transaction. |
| <a id="property-proves"></a> `proves` | `readonly` | `string` | What the read establishes of a payment through the pairing. |
| <a id="property-read-1"></a> `read?` | `readonly` | [`ReadData`](#readdata) | Absent where no public ledger records the payment. |
| <a id="property-source"></a> `source` | `readonly` | `string` | Who writes H: lcp's client, or a stock client and release, with the member it copies H from. |

***

### Family

A family's own types, as one descriptor: what `read` and `advertise` take and give, what `build` takes and gives,
the option a payment answers, and what `status` and `recover` take and answer.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-advertised"></a> `advertised` | `readonly` | `unknown` | What `advertise` gives. |
| <a id="property-answer"></a> `answer` | `readonly` | `unknown` | What `status` answers. |
| <a id="property-choice"></a> `choice` | `readonly` | `unknown` | The buyer's inputs `build` takes. |
| <a id="property-doc"></a> `doc` | `readonly` | `unknown` | The advertised document `read` reads. |
| <a id="property-landed"></a> `landed` | `readonly` | `unknown` | The members of `status`'s reference that `reference` does not give, which the caller adds: the landed transaction, and where the read takes them, H and the position its search starts from; `unknown` where there are none. |
| <a id="property-network"></a> `network` | `readonly` | `unknown` | The network `recover` takes. |
| <a id="property-offer"></a> `offer` | `readonly` | `unknown` | The offer `advertise` places H on: the x402 option, the MPP challenge, or the protocol's own option. |
| <a id="property-offered"></a> `offered` | `readonly` | `unknown` | What `read` gives: the hash, the link, the agreement URL where the document carries one, and the offer. |
| <a id="property-option"></a> `option` | `readonly` | `unknown` | The x402 option or MPP challenge a payment answers, which `reference` and `recover` take. |
| <a id="property-placedin"></a> `placedIn` | `readonly` | `unknown` | What `advertise` places H in: the document, or nothing where H goes into values the seller places itself. |
| <a id="property-query"></a> `query` | `readonly` | `unknown` | What `status` takes beside the reference and the reader. |
| <a id="property-receipt"></a> `receipt?` | `readonly` | `unknown` | The receipt `keySearch` reads; absent where the pairing has no `keySearch`. |
| <a id="property-rest"></a> `rest` | `readonly` | readonly `unknown`[] | The arguments `advertise` takes after `offer`: on MPP the challenge's position, the act, then the agreement URL. |
| <a id="property-unsigned"></a> `unsigned` | `readonly` | `unknown` | What `build` gives the payer to sign. |

***

### FeePayer

Who can pay an agreement's fee, as data.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-default"></a> `default?` | `readonly` | [`FeeParty`](#feeparty) | The party that pays it where the option names no fee payer, one of `may`; absent where the option always names one, or the pairing's profile states none. |
| <a id="property-may"></a> `may` | `readonly` | readonly [`FeeParty`](#feeparty)[] | Each party that can pay it, by the chain and the published scheme, each once. |

***

### ForeignItem

A transaction that carries H, succeeded, and is not the act asked about.

#### Type Parameters

| Type Parameter |
| ------ |
| `Position` |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-authority"></a> `authority?` | `readonly` | `string` | The authority the ledger records for its signer, where the read records one. |
| <a id="property-moved"></a> `moved?` | `readonly` | readonly [`Moved`](#moved)[] | - |
| <a id="property-named"></a> `named?` | `readonly` | `string` | The account it names apart from what it moved, where the read records one, as `Named.named` states it. |
| <a id="property-position"></a> `position?` | `readonly` | `Position` | - |
| <a id="property-reason"></a> `reason` | `readonly` | [`ForeignReason`](#foreignreason) | - |
| <a id="property-signer"></a> `signer?` | `readonly` | `string` | - |
| <a id="property-transaction"></a> `transaction` | `readonly` | `string` | - |

***

### LegalContextRecord

What a resource server's own record holds for the request a return names: the sale's H, and its return value where it has one.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-h"></a> `h` | `` `0x${string}` `` |
| <a id="property-returnvalue"></a> `returnValue?` | `Uint8Array`\<`ArrayBufferLike`\> |

***

### LegalContextReturn

What a `Legal-Context` header carries: H, and the sale's return value where it has one, as 32 bytes.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-h-1"></a> `h` | `` `0x${string}` `` |
| <a id="property-returnvalue-1"></a> `returnValue?` | `Uint8Array`\<`ArrayBufferLike`\> |

***

### Life

The longest a signed payment can stay payable where the rail itself bounds it, with the chain rule it comes from.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-rule"></a> `rule` | `readonly` | `string` |
| <a id="property-unit"></a> `unit` | `readonly` | `string` |
| <a id="property-value"></a> `value` | `readonly` | `number` |

***

### Moved

One transfer or deposit an act made, as the read observed it, named by its transaction and its place in it, so that
two answers that name one transfer are told from two transfers.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `readonly` | `string` | - |
| <a id="property-asset-1"></a> `asset` | `readonly` | `string` | - |
| <a id="property-beneficiary"></a> `beneficiary?` | `readonly` | `string` | On a deposit into a contract, the account that contract names as the payment's beneficiary, where the act names one; absent on a transfer, and on a deposit that names none. Observed, and never judged. |
| <a id="property-contract"></a> `contract?` | `readonly` | `string` | On a deposit into a contract, the contract it was deposited into, in the chain's own spelling, as the act names it: on EVM the contract's address, on the XRP Ledger the channel's id, on Solana the channel's account, on Cardano the script's address in Bech32. Absent on a transfer, so that its presence marks a deposit. Observed, and never judged. |
| <a id="property-decimals"></a> `decimals?` | `readonly` | `number` | Where the ledger states it for the asset, the number of decimals in which `amount` is written: `amount` counts the asset's smallest unit, and the amount in the asset's own unit is `amount` × 10^-`decimals`. Observed, and never compared with anything. |
| <a id="property-partial"></a> `partial?` | `readonly` | `true` | True where the ledger records that the payer signed the payment as one that may deliver less than the amount it names, and `amount` is then what it delivered; absent otherwise. Observed, and never judged. |
| <a id="property-place"></a> `place?` | `readonly` | `string` \| `number` | Its place in that transaction, in the pairing's own spelling: on EVM the position of its `Transfer` log among the receipt's logs; elsewhere the position of the instruction, operation, output or event it was read from. |
| <a id="property-to"></a> `to` | `readonly` | `string` | The account it reached; on a deposit into a contract, as each pairing's profile states, the beneficiary the contract names or the contract itself. `contract` and `beneficiary` name the two apart. |
| <a id="property-transaction-1"></a> `transaction?` | `readonly` | `string` | The transaction it was read from. |

***

### Named

#### Type Parameters

| Type Parameter |
| ------ |
| `Position` |
| `Mark` |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-authority-1"></a> `authority?` | `readonly` | `string` | - |
| <a id="property-finality"></a> `finality?` | `readonly` | `Mark` | The mark the read reached for the transaction it names. |
| <a id="property-moved-1"></a> `moved?` | `readonly` | readonly [`Moved`](#moved)[] | - |
| <a id="property-named-1"></a> `named?` | `readonly` | `string` | The account the act names apart from what it moved, where the read records one: on an activation, the one recipient the key authorization it carries lets its key pay, whether or not the act moved anything to it. Absent where the act names no such account. Observed, and never judged. |
| <a id="property-position-1"></a> `position?` | `readonly` | `Position` | - |
| <a id="property-signer-1"></a> `signer?` | `readonly` | `string` | - |
| <a id="property-transaction-2"></a> `transaction?` | `readonly` | `string` | - |

***

### PresentedOn

What the buyer presents as payment, per surface: the union of the payment types of every pairing on it. Every
pairing's `bound` and `reference` take `unknown` and check what they are given. `Presented` indexes it by every
surface, so a pairing on a surface it does not name does not compile.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-ack"></a> `ack` | [`Json`](#json) | ACK defines no payer signature; its `bound` refuses whatever is presented. |
| <a id="property-acp"></a> `acp` | [`Presented`](acp.md#presented) | - |
| <a id="property-ap2"></a> `ap2` | [`Presented`](ap2.md#presented) \| [`X402Presented`](ap2.md#x402presented) | - |
| <a id="property-card"></a> `card` | [`TapPresented`](card.md#tappresented) \| [`VicPresented`](card.md#vicpresented) \| [`ViImmediate`](card.md#viimmediate) \| [`ViAutonomous`](card.md#viautonomous) | - |
| <a id="property-mpp"></a> `mpp` | [`MppCredential`](mpp.md#mppcredential) | - |
| <a id="property-spend-permissions"></a> `spend-permissions` | [`SpendPermissionReturn`](spend-permissions.md#spendpermissionreturn) | - |
| <a id="property-ucp"></a> `ucp` | [`Presented`](ap2.md#presented) \| [`AgentSignedPresented`](ucp.md#agentsignedpresented) | - |
| <a id="property-x402"></a> `x402` | [`PaymentPayload`](x402.md#paymentpayload) \| [`LnPaymentPayload`](lightning.md#lnpaymentpayload) \| [`SvmPaymentPayload`](#svmpaymentpayload) \| [`UptoSvmPaymentPayload`](#uptosvmpaymentpayload) \| [`XrplPaymentPayload`](#xrplpaymentpayload) \| [`HederaPaymentPayload`](#hederapaymentpayload) \| [`ExecutorPaymentPayload`](#executorpaymentpayload) \| [`AptosPaymentPayload`](#aptospaymentpayload) \| [`AvmPaymentPayload`](#avmpaymentpayload) \| [`CardanoPaymentPayload`](#cardanopaymentpayload) \| [`CasperPaymentPayload`](#casperpaymentpayload) \| [`CcdPaymentPayload`](#ccdpaymentpayload) \| [`NearPayment`](#nearpayment) \| [`PolkadotPaymentPayload`](#polkadotpaymentpayload) \| [`StarknetPayment`](#starknetpayment) \| [`StellarPaymentPayload`](#stellarpaymentpayload) \| [`SuiPaymentPayload`](#suipaymentpayload) \| [`TronPayment`](#tronpayment) \| [`TvmPayment`](#tvmpayment) \| [`BatchPaymentPayload`](#batchpaymentpayload) \| [`CloudflarePaymentPayload`](#cloudflarepaymentpayload) \| [`UptoXrplPaymentPayload`](x402-upto-xrpl.md#uptoxrplpaymentpayload) | - |

***

### PushMode

The optional member of a push-mode pairing: the transaction its credential names, or undefined.

#### Methods

##### landedTx()?

> `optional` **landedTx**(`presented`): `string` \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `presented` | `unknown` |

###### Returns

`string` \| `undefined`

***

### ReadData

What a read of the pairing needs.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-chains"></a> `chains?` | `readonly` | `object` | The networks, as CAIP-2 ids, each contract it names is deployed on, keyed by its name in `contracts`, where the pairing's profile or the package states them; a contract it does not key has no networks stated here. |
| <a id="property-contracts"></a> `contracts` | `readonly` | readonly `string`[] | The contracts the read names. |
| <a id="property-endpoint"></a> `endpoint` | `readonly` | readonly [`EndpointKind`](#endpointkind)[] | The endpoint kinds the read goes through, each of which a network declares for the read to be made there. |
| <a id="property-fallback"></a> `fallback?` | `readonly` | [`EndpointKind`](#endpointkind) | The kind of a declared archival endpoint the read goes on to where the endpoint does not hold the history or state it needs; absent where the read has none. |
| <a id="property-history"></a> `history?` | `readonly` | `string` | The history the read needs; absent where the pairing's entry states none. |
| <a id="property-lapse"></a> `lapse?` | `readonly` | `string` | The signed fact after which the payment can no longer land; absent where the pairing's entry states none. |
| <a id="property-life"></a> `life?` | `readonly` | [`Life`](#life) | Absent where the rail sets no bound or the pairing's entry states none. |
| <a id="property-note"></a> `note?` | `readonly` | `string` | What the read asks of its endpoints beyond their kinds; absent where nothing. |
| <a id="property-search"></a> `search` | `readonly` | `string` | The search key and its bound. |

***

### RecoverInput

What `recover` takes: the network, the transaction id, and the option or challenge the ATR's binding slot holds.

#### Type Parameters

| Type Parameter |
| ------ |
| `Network` |
| `Option` |

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | `readonly` | `Network` |
| <a id="property-option-1"></a> `option` | `readonly` | `Option` |
| <a id="property-tx"></a> `tx` | `readonly` | `string` |

***

### StatusQuery

What `status` takes beside the reference and the reader: the act, the finality asked for, and, where the caller gives
them, the final position the transaction must come after, the search position an earlier answer returned, and the
other acts under the same H.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `Ref` | - |
| `Position` | - |
| `Mark` | - |
| `Cursor` | `Position` |

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-act"></a> `act` | `readonly` | [`Act`](#act) |
| <a id="property-after"></a> `after?` | `readonly` | `Position` |
| <a id="property-finality-1"></a> `finality` | `readonly` | `Mark` |
| <a id="property-others"></a> `others?` | `readonly` | readonly [`OtherAct`](#otheract)\<`Ref`\>[] |
| <a id="property-search-1"></a> `search?` | `readonly` | `Cursor` |

***

### StellarPaymentPayload

A Stellar x402 payment: the base64 XDR of the transaction with the payer's entry signed.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-4"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-4"></a> `extensions?` | `object` |
| <a id="property-payload-4"></a> `payload` | `object` |
| `payload.transaction` | `string` |
| <a id="property-resource-3"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-4"></a> `x402Version` | `2` |

***

### SuiPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-5"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-5"></a> `extensions?` | `object` |
| <a id="property-payload-5"></a> `payload` | [`SuiPayload`](sui.md#suipayload) |
| <a id="property-resource-4"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-5"></a> `x402Version` | `2` |

***

### SvmPaymentPayload

A payment on `x402/exact/solana`: the base64 partially signed versioned transaction. `../x402-exact-solana.ts`
returns it from `complete`, and the root names it among the payments `Presented` covers; both export it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-6"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-6"></a> `extensions?` | `object` |
| <a id="property-payload-6"></a> `payload` | `object` |
| `payload.transaction` | `string` |
| <a id="property-resource-5"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-6"></a> `x402Version` | `2` |

***

### UptoSvmPaymentPayload

A payment on `x402/upto/solana`: the opening's signed fields and its base64 partially signed transaction.
`../x402-upto-solana.ts` returns it from `complete`, and the root names it among the payments `Presented` covers; both
export it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-7"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-7"></a> `extensions?` | `object` |
| <a id="property-payload-7"></a> `payload` | [`UptoSvmPayload`](x402-upto-solana.md#uptosvmpayload) |
| <a id="property-resource-6"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-7"></a> `x402Version` | `2` |

***

### XrplPaymentPayload

A payment on `x402/exact/xrpl`: the wallet's signed blob, hex. `../x402-exact-xrpl.ts` returns it from `complete`,
and the root names it among the payments `Presented` covers; both export the name.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-8"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-8"></a> `extensions?` | `object` |
| <a id="property-payload-8"></a> `payload` | `object` |
| `payload.signedTxBlob` | `string` |
| <a id="property-resource-7"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version-8"></a> `x402Version` | `2` |

## Type Aliases

### Act

> **Act** = `"payment"` \| `"agreement"`

The act `status` is asked about.

***

### AtrHash

> **AtrHash** = `` `0x${string}` ``

`0x` followed by 64 hex digits. Every hash this module emits is lowercase.

***

### AvmPaymentPayload

> **AvmPaymentPayload** = [`X402Payment`](#x402payment)\<[`AvmPresented`](avm.md#avmpresented)\>

***

### Binding

> **Binding** = [`X402Binding`](#x402binding) \| [`MppBinding`](#mppbinding) \| *typeof* [`paymentRequest`](ack.md#paymentrequest) \| *typeof* [`delegated`](acp.md#delegated) \| *typeof* [`undelegated`](acp.md#undelegated) \| *typeof* [`checkoutMandate`](ap2.md#checkoutmandate) \| *typeof* [`viAutonomous`](card.md#viautonomous-1) \| *typeof* [`viImmediate`](card.md#viimmediate-1) \| *typeof* [`sellerReference`](card.md#sellerreference) \| *typeof* [`visaTap`](card.md#visatap) \| *typeof* [`agentPay`](card.md#agentpay) \| *typeof* [`visaVic`](card.md#visavic) \| *typeof* [`bookingAp2Mandate`](ucp.md#bookingap2mandate) \| *typeof* [`bookingUnsigned`](ucp.md#bookingunsigned) \| *typeof* [`ap2Mandate`](ucp.md#ap2mandate) \| *typeof* [`unsigned`](ucp.md#unsigned-1) \| *typeof* [`checkoutMandateX402`](ap2.md#checkoutmandatex402) \| *typeof* [`agentSigned`](ucp.md#agentsigned) \| *typeof* [`spendPermissionsEip155`](spend-permissions.md#spendpermissionseip155) & [`PushMode`](#pushmode) & [`CarrierAfterH`](#carrierafterh) & [`Authorizer`](#authorizer)

A pairing of protocol, scheme and rail.

***

### Broadcaster

> **Broadcaster** = `"payer"` \| `"payee"`

Who broadcasts what a payer presents under a pairing: `"payer"`, which sent the payment before presenting it, or
`"payee"`, the seller, or the facilitator or processor acting for it, which sends or executes it after. A pairing's
`broadcaster` gives this only for a payment of a type and kind the pairing takes, within the shape gate its `bound`
applies first; any other payment gets the refusal `bound` gives that fault. Where a payment has a second fault that
`bound` finds first, in H or the challenge, the two codes differ. A session's or batch channel's `bound` reads the
opening alone, so for any other action the reader is `channel.kind`: a payment it refuses for its own content gets
its refusal (a batch channel reads the payload alone, under any `accepted` option), and one a session's
`channel.kind` refuses for what the challenge decides is answered.

***

### CasperPaymentPayload

> **CasperPaymentPayload** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-9"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-9"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload-9"></a> `payload` | `object` |
| `payload.authorization` | [`CasperAuthorization`](casper.md#casperauthorization) |
| `payload.publicKey` | `string` |
| `payload.signature` | `string` |
| <a id="property-resource-8"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version-9"></a> `x402Version` | `2` |

***

### CcdPaymentPayload

> **CcdPaymentPayload** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-10"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions-10"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload-10"></a> `payload` | `object` |
| `payload.signedTransaction` | `object` |
| <a id="property-resource-9"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version-10"></a> `x402Version` | `2` |

***

### ChannelKind

> **ChannelKind** = `"open"` \| `"within"` \| `"close"`

What a channel's `kind` names a payment: its opening, a payment within it, or its close.

***

### CoreRefusal

> **CoreRefusal** = `object`

A refusal of the core, `assemble` and the JSON checks under it: one of the `core/` codes.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-code"></a> `code` | `"core/slot-name"` \| `"core/slot-reserved"` \| `"core/slot-duplicate"` \| `"core/content-not-json"` \| `"core/binding-not-json"` \| `"core/too-large"` |
| <a id="property-refused"></a> `refused` | `true` |

***

### Coverage

> **Coverage** = `"full"` \| `"none"`

`full`: the payer's own signed act, on a public ledger, binds all of H, a 256-bit digest over a preimage that holds H,
or on Starknet H's low 250 bits. `none`: no public payer-signed act carries H.

***

### EndpointKind

> **EndpointKind** = `"fullnode-http"` \| `"fullnode-rest"` \| `"graphql"` \| `"grpc-v2"` \| `"indexer-rest"` \| `"json-rpc"` \| `"mirror-rest"` \| `"rest-api"` \| `"rippled"` \| `"stacks-api-rest"` \| `"toncenter-v3"`

A kind of endpoint a read goes through, as the pairing's chain names it.

***

### Entry

> **Entry**\<`Id`, `Presented`, `Ref`, `Reader`, `F`\> = [`Codec`](#codec)\<`Presented`, `Ref`, `Reader`, `F`\> & [`NoneWhereNever`](#nonewherenever)\<`Presented`, `Ref`, `Reader`\> & `object`

A registry entry: its id, its data and its codec. It takes `never` for `Reader` only where the codec has no member
that takes a reader, for `Ref` only where it has no `reference`, and never for `Presented`.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `data` | [`PairingData`](#pairingdata) |
| `id` | `Id` |

#### Type Parameters

| Type Parameter |
| ------ |
| `Id` *extends* `string` |
| `Presented` |
| `Ref` |
| `Reader` |
| `F` *extends* [`Family`](#family) |

***

### ExecutorPayload

> **ExecutorPayload** = `object`

The x402 `transferExecutor` payload.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-authorization"></a> `authorization` | [`Hex`](evm.md#hex) |
| <a id="property-executor"></a> `executor` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |

***

### ExecutorPaymentPayload

> **ExecutorPaymentPayload** = [`X402Payment`](#x402payment)\<[`ExecutorPayload`](#executorpayload)\>

***

### FailedReason

> **FailedReason** = `"instrument-unused"` \| `"instrument-consumed"` \| `"transaction-failed"` \| `"before-position"`

The reasons of a `failed` answer.

***

### FeeParty

> **FeeParty** = `"buyer"` \| `"settler"` \| `"paymaster"` \| `"none"`

A party that can pay an agreement's fee: the buyer; the settler, the party that submits the payment the buyer
signed; a paymaster the buyer's user operation names; or `none`, on a path where the chain charges the buyer's
transaction no fee.

***

### ForeignReason

> **ForeignReason** = `"payee-signed"` \| `"other-signer"` \| `"given"` \| `"other-kind"` \| `"other-account"`

Why a transaction that carries H is not the act asked about, in the order in which they are tried.

***

### HederaPayload

> **HederaPayload** = `object`

The x402 `exact` payload on Hedera: the partially signed transaction, base64.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-transaction-3"></a> `transaction` | `string` |

***

### HederaPaymentPayload

> **HederaPaymentPayload** = [`X402Payment`](#x402payment)\<[`HederaPayload`](#hederapayload)\>

***

### IsNever

> **IsNever**\<`T`\> = \[`T`\] *extends* \[`never`\] ? `true` : `false`

True where `T` is `never`.

#### Type Parameters

| Type Parameter |
| ------ |
| `T` |

***

### Json

> **Json** = `string` \| `number` \| `boolean` \| `null` \| readonly [`Json`](#json)[] \| \{\[`k`: `string`\]: [`Json`](#json); \}

A JSON value: what `parseJson` reads, and what `canonicalJson`, `digestJson` and `assemble`'s binding value accept.
These three take `unknown` and refuse, at run time, a value that is not JSON. Numbers in a binding value must be safe
integers.

***

### MppBinding

> **MppBinding** = *typeof* [`MPP_BINDINGS`](mpp.md#mpp_bindings)\[`number`\]

An MPP pairing of intent and method.

***

### NearPayment

> **NearPayment** = [`X402Payment`](#x402payment)\<\{ `signedDelegateAction`: `string`; \}\>

***

### NoneWhereNever

> **NoneWhereNever**\<`Presented`, `Ref`, `Reader`\> = [`IsNever`](#isnever)\<`Presented`\> *extends* `true` ? `never` : `unknown` & [`IsNever`](#isnever)\<`Reader`\> *extends* `true` ? `object` : `unknown` & [`IsNever`](#isnever)\<`Ref`\> *extends* `true` ? `object` : `unknown`

The members a codec may not have where its entry takes `never`: none where `Presented` is `never`, since `bound`
takes what is presented; no member that takes the reader where `Reader` is; none that gives or takes the reference
where `Ref` is.

#### Type Parameters

| Type Parameter |
| ------ |
| `Presented` |
| `Ref` |
| `Reader` |

***

### NonZeroDigit

> **NonZeroDigit** = `"1"` \| `"2"` \| `"3"` \| `"4"` \| `"5"` \| `"6"` \| `"7"` \| `"8"` \| `"9"`

A decimal digit other than zero.

***

### OtherAct

> **OtherAct**\<`Ref`\> = \{ `ref`: `Ref`; \} \| \{ `transaction`: `string`; \}

Another act under the same H, which `status` never settles on: by its reference, or by its transaction.

#### Type Parameters

| Type Parameter |
| ------ |
| `Ref` |

***

### PairingData

> **PairingData** = [`DataMembers`](#datamembers) & \{ `agreement?`: [`AgreementData`](#agreementdata); `agreementOn?`: `never`; `coverage`: `"full"`; `link?`: `never`; \} \| \{ `agreement?`: `never`; `agreementOn?`: `"any"` \| `"same-network"` \| `` `x402/${string}` `` \| `` `mpp/${string}` ``; `coverage`: `"none"`; `link`: `"h"` \| `"pointer"` \| `"none"`; \}

A pairing's data. At coverage `full` it has no `link` and no `agreementOn`; at coverage `none` it has a `link` and
no `agreement`, since only a payment that is itself a public proof of H can be an agreement.

Every pairing's data also has `carrier` (`Carrier`), where H rides; `source`, who writes H: lcp's client, or a stock
client and release, with the member it copies H from; `nonce`, whether the identical instrument can land more than
once (`single-use`, `reusable`, or `unshown` until a vector or a run shows single use); `broadcasts`, the answers the
codec's `broadcaster` can give over every credential type the pairing takes; `confirmed`, whether something outside
lcp has shown the form as its profile defines it (`yes` or `no`); and `proves`, what the read establishes of a
payment through the pairing. Where a public ledger records the payment it has `read` (`ReadData`), what a read of
the pairing needs; and, where the pairing's entry states them, `destination`, `asset` and `payer`: how the account
the act names, the asset and the payer are identified in the landed transaction. Where the pairing's profile states
them it has `payeePreconditions`, what the payee's account must hold before it can be paid; and where the payment is
card-like, on no network a CAIP-2 id names, `cardLike`.

***

### PairingId

> **PairingId** = [`Binding`](#binding)\[`"id"`\]

The id of a pairing this package implements: the `id` of an entry of `BINDINGS`.

***

### PairingOn

> **PairingOn**\<`S`\> = `Extract`\<[`PairingId`](#pairingid), `` `${S}/${string}` ``\>

The pairing ids of one surface.

#### Type Parameters

| Type Parameter |
| ------ |
| `S` *extends* [`Surface`](#surface) |

***

### PendingReason

> **PendingReason** = `"below-mark"` \| `"instrument-live"` \| `"search-incomplete"` \| `"not-found"`

The reasons of a `pending` answer, in the order in which they are answered: the first that holds.

***

### PolkadotPayload

> **PolkadotPayload** = `object`

The x402 payload: the signed extrinsic and its call, lowercase hex.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-call"></a> `call` | [`Hex`](evm.md#hex) |
| <a id="property-extrinsic"></a> `extrinsic` | [`Hex`](evm.md#hex) |

***

### PolkadotPaymentPayload

> **PolkadotPaymentPayload** = [`X402Payment`](#x402payment)\<[`PolkadotPayload`](#polkadotpayload)\>

***

### Presented

> **Presented** = [`PresentedOn`](#presentedon)\[[`Surface`](#surface)\]

What the buyer presents as payment.

***

### Refusal

> **Refusal** = `object`

A refusal returned as a value. `code` is `<entry point>/<reason>`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-code-1"></a> `code` | `string` |
| <a id="property-refused-1"></a> `refused` | `true` |

***

### StarknetPayment

> **StarknetPayment** = [`X402Payment`](#x402payment)\<\{ `from`: [`Felt`](starknet.md#felt); `outsideExecution`: \{ `signature`: readonly [`Felt`](starknet.md#felt)[]; `typedData`: [`OutsideExecutionTypedData`](starknet.md#outsideexecutiontypeddata); \}; \}\>

***

### StatusAnswer

> **StatusAnswer**\<`Position`, `Mark`, `Cursor`\> = [`Named`](#named)\<`Position`, `Mark`\> & `object` \| [`Named`](#named)\<`Position`, `Mark`\> & `object` \| [`Named`](#named)\<`Position`, `Mark`\> & `object` \| \{ `foreign`: readonly [`ForeignItem`](#foreignitem)\<`Position`\>[]; `reason`: [`UnreadableReason`](#unreadablereason); `state`: `"unreadable"`; \}

The answer of `status`: one state, one reason of a closed list, what it read, and the foreign items it met.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `Position` | - |
| `Mark` | - |
| `Cursor` | `Position` |

#### Union Members

[`Named`](#named)\<`Position`, `Mark`\> & `object`

***

[`Named`](#named)\<`Position`, `Mark`\> & `object`

***

[`Named`](#named)\<`Position`, `Mark`\> & `object`

***

##### Type Literal

\{ `foreign`: readonly [`ForeignItem`](#foreignitem)\<`Position`\>[]; `reason`: [`UnreadableReason`](#unreadablereason); `state`: `"unreadable"`; \}

***

### Surface

> **Surface** = [`SurfaceOf`](#surfaceof)\<[`PairingId`](#pairingid)\>

The surfaces: each pairing id's first "/" segment.

***

### SurfaceOf

> **SurfaceOf**\<`I`\> = `I` *extends* `` `${infer S}/${string}` `` ? `S` : `never`

#### Type Parameters

| Type Parameter |
| ------ |
| `I` |

***

### TronPayment

> **TronPayment** = [`X402Payment`](#x402payment)\<\{ `transaction`: `string`; \}\>

***

### TvmPayment

> **TvmPayment** = [`X402Payment`](#x402payment)\<\{ `asset`: `string`; `settlementBoc`: `string`; \}\>

***

### UnreadableReason

> **UnreadableReason** = `"history-gap"` \| `"transport"` \| `"unparseable"` \| `"too-large"` \| `"chain-mismatch"`

The reasons of an `unreadable` answer.

***

### UrlAuthority

> **UrlAuthority** = `object`

What the basic URL parser gives for an absolute URL's scheme and authority.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-credentials"></a> `credentials` | `boolean` | Whether the URL has a username or a password that is not empty. |
| <a id="property-host"></a> `host` | `string` \| `null` | The serialized host, or null for a URL with no authority. |
| <a id="property-port"></a> `port` | `number` \| `null` | The port, or null where the URL names none or names its scheme's default port, as the URL record holds it. |
| <a id="property-scheme"></a> `scheme` | `string` | The scheme, lowercased. |

***

### X402Binding

> **X402Binding** = *typeof* [`exactEip3009`](x402.md#exacteip3009) \| *typeof* [`authCaptureEip3009`](x402.md#authcaptureeip3009) \| *typeof* [`authCapturePermit2`](x402.md#authcapturepermit2) \| *typeof* [`batchCloudflare`](x402-batch-settlement.md#batchcloudflare) \| *typeof* [`batchEvm`](x402-batch-settlement.md#batchevm) \| *typeof* [`batchSvm`](x402-batch-settlement.md#batchsvm) \| *typeof* [`exactAvm`](avm.md#exactavm) \| *typeof* [`exactAptos`](aptos.md#exactaptos) \| *typeof* [`exactCardano`](cardano.md#exactcardano) \| *typeof* [`exactCardanoLock`](cardano.md#exactcardanolock) \| *typeof* [`exactCasper`](casper.md#exactcasper) \| *typeof* [`exactCcd`](ccd.md#exactccd) \| *typeof* [`exactErc7710`](x402.md#exacterc7710) \| *typeof* [`exactErc7710Salt`](x402.md#exacterc7710salt) \| *typeof* [`exactPermit2`](x402.md#exactpermit2) \| *typeof* [`exactHedera`](hedera.md#exacthedera) \| *typeof* [`exactHederaExecutor`](hedera.md#exacthederaexecutor) \| *typeof* [`exactLnbtcPaymentHash`](lightning.md#exactlnbtcpaymenthash) \| *typeof* [`exactNear`](near.md#exactnear) \| *typeof* [`exactPolkadotRemark`](polkadot.md#exactpolkadotremark) \| *typeof* [`exactSvm`](x402-exact-solana.md#exactsvm) \| *typeof* [`exactStarknet`](starknet.md#exactstarknet) \| *typeof* [`exactStellarPrecondition`](x402-exact-stellar.md#exactstellarprecondition) \| *typeof* [`exactSui`](sui.md#exactsui) \| *typeof* [`exactTronMemo`](tron.md#exacttronmemo) \| *typeof* [`exactTvm`](tvm.md#exacttvm) \| *typeof* [`exactXrpl`](x402-exact-xrpl.md#exactxrpl) \| *typeof* [`uptoPermit2`](x402.md#uptopermit2) \| *typeof* [`uptoSvm`](x402-upto-solana.md#uptosvm) \| *typeof* [`exactGatewayBatched`](x402.md#exactgatewaybatched) \| *typeof* [`uptoXrpl`](x402-upto-xrpl.md#uptoxrpl)

An x402 pairing of scheme and rail.

***

### X402Payment

> **X402Payment**\<`P`\> = `Omit`\<[`PaymentPayload`](x402.md#paymentpayload), `"payload"`\> & `object`

An x402 v2 payment whose `payload` is the pairing's own.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `payload` | `P` |

#### Type Parameters

| Type Parameter |
| ------ |
| `P` |

## Variables

### BINDINGS

> `const` **BINDINGS**: readonly [`Binding`](#binding)[]

Every pairing this package implements.

***

### FETCHED

> `const` **FETCHED**: unique `symbol`

The key of the one member that holds what a seller's reader wrote onto a credential: `fetchPresented` writes the
credential with its read under this key, and `bound`, `reference` and `buildWithin` read a rail's read from this
member and from no other. A string-keyed member of any name, such as `landed` or `tables`, is never read as a read:
a credential carrying one gives the answer the same credential without it gives. The registered symbol
`Symbol.for("@integraledger/lcp/fetched")` is the same in every copy of the package in a process. No wire form
carries it: `JSON.parse` and `structuredClone` make no symbol-keyed member, and `JSON.stringify` and
`structuredClone` drop it, so the seller keeps the object `fetchPresented` returned, or a spread or `Object.assign`
copy of it, both of which copy the member. One symbol, exported from `@integraledger/lcp`, `@integraledger/lcp/mpp`
and `@integraledger/lcp/hedera`, the entry points whose pairings write it.

***

### LEGAL\_CONTEXT\_HEADER

> `const` **LEGAL\_CONTEXT\_HEADER**: `"Legal-Context"` = `"Legal-Context"`

The header's name.

***

### LEGAL\_CONTEXT\_META

> `const` **LEGAL\_CONTEXT\_META**: `"com.integraledger.lcp/legal-context"` = `"com.integraledger.lcp/legal-context"`

The `_meta` key under which an MCP tool result, and each later tool call's `params`, carry the header's value.

***

### LEGAL\_CONTEXT\_SERVES

> `const` **LEGAL\_CONTEXT\_SERVES**: `"legalContextServes"` = `"legalContextServes"`

The member by which an agreement option names the charge options it serves: in an x402 option's `extra`, in an MPP challenge's `opaque`.

***

### MAX\_ATR\_BYTES

> `const` **MAX\_ATR\_BYTES**: `1048576` = `1_048_576`

The largest ATR `assemble` writes, in bytes: 1 MiB. A smaller `limits.maxBytes` lowers it for one call; no larger
one raises it.

***

### MAX\_CHALLENGE\_DEPTH

> `const` **MAX\_CHALLENGE\_DEPTH**: `16` = `16`

The deepest nesting of arrays and objects lcp reads in an MPP challenge's decoded `request` and `opaque`. A challenge
is read before anything is bound to it, so it is held to less depth than an ATR.

***

### MAX\_CHALLENGES

> `const` **MAX\_CHALLENGES**: `32` = `32`

The most challenges lcp reads in one MPP response. A challenge id lcp derives from H names the challenge's position
in the response, and an id holds the positions 0 to 31.

***

### MAX\_CREDENTIAL\_BYTES

> `const` **MAX\_CREDENTIAL\_BYTES**: `65536` = `65_536`

The largest MPP credential lcp decodes, in bytes. The MPP draft sets no size.

***

### MAX\_HEADER\_BYTES

> `const` **MAX\_HEADER\_BYTES**: `65536` = `65_536`

The largest JSON lcp decodes from an x402 header, `PAYMENT-REQUIRED` and the others, in bytes. x402 sets no size.

***

### MAX\_JSON\_DEPTH

> `const` **MAX\_JSON\_DEPTH**: `64` = `64`

The deepest nesting of arrays and objects in any JSON lcp writes or reads, an ATR's among it. RFC 8259 permits any
depth; a parser's recursion is bounded by it.

***

### MAX\_LINK\_LENGTH

> `const` **MAX\_LINK\_LENGTH**: `2048` = `2048`

The longest link, in characters, that a placement writes or a reader accepts: the ATR's link and the agreement's URL.
No specification of a link's carrier fixes a length.

***

### MAX\_OPTIONS

> `const` **MAX\_OPTIONS**: `32` = `32`

The most options lcp reads in one x402 document (`accepts`). x402 sets no count.

***

### MAX\_REQUEST\_BYTES

> `const` **MAX\_REQUEST\_BYTES**: `1048576` = `1_048_576`

The most bytes the x402 request commitment reads of one part of a request: the body, the RFC 8785 form of an MCP tool
call's arguments, and a named header field's value, its lines joined. x402 sets no size; a larger part is refused.

***

### MAX\_SIGNATURE\_BYTES

> `const` **MAX\_SIGNATURE\_BYTES**: `8192` = `8192`

The longest signature lcp decodes, in bytes. A smart-contract wallet's signature (ERC-1271, and ERC-6492's wrapped
form) has no length its standard fixes, so lcp bounds it here, for every pairing that reads one.

***

### MAX\_SLOT\_NAME\_LENGTH

> `const` **MAX\_SLOT\_NAME\_LENGTH**: `64` = `64`

The longest slot name `assemble` accepts, in characters: 64, each from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`, the
first a letter or a digit. It bounds the binding's slot and every party slot alike.

***

### RETURN\_VALUE\_BYTES

> `const` **RETURN\_VALUE\_BYTES**: `32` = `32`

The length of a sale's return value, in bytes.

## Functions

### agreementValue()

> **agreementValue**(`h`): `Promise`\<`` `0x${string}` ``\>

The agreement's own value for H (read-status.md, rule 1): SHA-256 over the 16 ASCII bytes `lcp-agreement-v1`
followed by H's 32 bytes, as `0x` and lowercase hex. On a pairing whose single-use value is H itself or H's low bits,
an agreement carries this value, or its low bits as the pairing takes H's, where a payment carries H, so the two acts
under one H never share a single-use value; a holder of the ATR compares it with what `recover` reads from an
agreement's transaction. Rejects with a TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### assemble()

> **assemble**(`id`, `binding`, `content`, `limits?`): `Promise`\<[`CoreRefusal`](#corerefusal) \| \{ `atrHash`: `` `0x${string}` ``; `bytes`: `Uint8Array`\<`ArrayBuffer`\>; \}\>

Writes the ATR's bytes and hashes them. The same inputs always give the same bytes. Every problem with the inputs
is returned as a refusal, from the first check that fails, in this order:

1. `limits.maxBytes`, when given, is a non-negative safe integer (`core/too-large`). The limit applied is the
   smaller of it and 1 MiB (`MAX_ATR_BYTES`).
2. `id` is a string (`core/binding-not-json`), `binding` is an array of two (`core/slot-name`), and `content` is an
   array (`core/content-not-json`).
3. The binding's slot name matches the slot-name pattern, 1 to 64 characters (`MAX_SLOT_NAME_LENGTH`)
   (`core/slot-name`), and is not `atrVersion` or `id` (`core/slot-reserved`).
4. There are at most 64 party slots (`core/too-large`).
5. Each party slot, in the order given, is an array of two (`core/slot-name`); its name matches the pattern
   (`core/slot-name`), is not `atrVersion`, `id` or the binding's slot name (`core/slot-reserved`) and has not
   appeared before (`core/slot-duplicate`); its bytes are a `Uint8Array` (`core/content-not-json`).
6. The binding value is a JSON value `JSON.stringify` writes exactly, every number a safe integer, nested at most 64
   levels (`core/binding-not-json`).
7. The assembled length is at most the limit (`core/too-large`).
8. Each party's bytes, in order, are one JSON value in which no object repeats a member name, names compared after
   their escapes are decoded, no number overflows a double, and no integer lies beyond 2^53 - 1 either way
   (`core/content-not-json`).

Each input is read once: each array's length and members, each party's name, bytes and size, and each member of
the binding value, in the one walk that checks the value and writes it. What is checked is what is written, an input
behind an accessor included.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `binding` | readonly \[`string`, `unknown`\] |
| `content` | readonly readonly \[`string`, `Uint8Array`\<`ArrayBufferLike`\>\][] |
| `limits?` | \{ `maxBytes?`: `number`; \} |
| `limits.maxBytes?` | `number` |

#### Returns

`Promise`\<[`CoreRefusal`](#corerefusal) \| \{ `atrHash`: `` `0x${string}` ``; `bytes`: `Uint8Array`\<`ArrayBuffer`\>; \}\>

***

### base64Bytes()

> **base64Bytes**(`s`, `maxBytes`): `Uint8Array`\<`ArrayBuffer`\> \| `"too-large"` \| `"malformed"`

The bytes of `s` as `fromBase64` reads them, or "too-large" when they would be more than `maxBytes`, or "malformed".
The size is read from the text's length before anything is decoded, so a text past the bound is never decoded.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |
| `maxBytes` | `number` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| `"too-large"` \| `"malformed"`

***

### base64UrlBytes()

> **base64UrlBytes**(`s`, `maxBytes`): `Uint8Array`\<`ArrayBuffer`\> \| `"too-large"` \| `"malformed"`

The bytes of `s` as `fromBase64Url` reads them, or "too-large" when they would be more than `maxBytes`, or
"malformed". The size is read from the text's length before anything is decoded, so a text past the bound is never
decoded.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |
| `maxBytes` | `number` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| `"too-large"` \| `"malformed"`

***

### canonicalJson()

> **canonicalJson**(`v`): `string` \| [`CoreRefusal`](#corerefusal)

The RFC 8785 form of `v`: object members sorted by the UTF-16 code units of their names, recursively, and every
primitive written as `JSON.stringify` writes it. Takes any value and refuses what `digestJson` refuses.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `v` | `unknown` |

#### Returns

`string` \| [`CoreRefusal`](#corerefusal)

***

### challengeH()

> **challengeH**(`id`): [`Refusal`](#refusal) \| `` `0x${string}` ``

H from an id `challengeId` wrote, or from the bare base64url of H; anything else is `mpp/id-not-ours`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Refusal`](#refusal) \| `` `0x${string}` ``

***

### challengeHash()

> **challengeHash**(`id`, `realm`): `` `0x${string}` ``

keccak256(UTF-8(JSON.stringify([id, realm]))), lowercase: the id and realm framed as a JSON array of two strings, as
`mppx` computes MPP's EVM challenge hash from 0.13.1, so that no two pairs give one preimage. A string that is not
well-formed is written as `JSON.stringify` writes it, with each lone surrogate escaped as `\uXXXX`; the pairings
refuse such an id or realm before they call it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `realm` | `string` |

#### Returns

`` `0x${string}` ``

***

### challengeId()

> **challengeId**(`h`, `index`): `string` \| [`Refusal`](#refusal)

base64url, without padding, of H's 32 bytes, then `.` and the challenge's position (0 to 31).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |
| `index` | `number` |

#### Returns

`string` \| [`Refusal`](#refusal)

***

### checkLegalContextReturn()

> **checkLegalContextReturn**(`value`, `record`): `true` \| [`Refusal`](#refusal)

The check a resource server makes of a return: `value`, a `Legal-Context` header's value or the same value from an
MCP `_meta`, read as `fromLegalContextHeader` reads it (`return/header-malformed`); its H the record's H
(`return/not-this-sale`); and its return value the record's, compared in constant time, an `rv` given where the
record holds none and none given where it holds one refused alike (`return/value-mismatch`). True where all hold. A
record whose H is not a 32-byte hash is `return/not-this-sale`, and one whose return value is not 32 bytes is
`return/value-mismatch`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |
| `record` | [`LegalContextRecord`](#legalcontextrecord) |

#### Returns

`true` \| [`Refusal`](#refusal)

***

### digestJson()

> **digestJson**(`v`): `Promise`\<`` `0x${string}` `` \| [`CoreRefusal`](#corerefusal)\>

SHA-256 over the RFC 8785 form of `v`. Takes any value and refuses, as `core/content-not-json`, a value deeper than
64 levels, a non-finite number, a string with an unpaired surrogate, or anything else that is not a JSON value.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `v` | `unknown` |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`CoreRefusal`](#corerefusal)\>

***

### domainToAscii()

> **domainToAscii**(`domain`, `beStrict?`): `string` \| `null`

The URL Standard's domain parser (§3.3, "IDNA"): the ASCII form of a domain, or null for failure.

With `beStrict` false, the URL parser's call: an ASCII domain is lowercased, and any other is read by UTS #46 ToASCII
(Unicode 17.0.0) with CheckBidi and CheckJoiners, nontransitional processing, and CheckHyphens, UseSTD3ASCIIRules and
VerifyDnsLength false; the result fails when it is empty or holds a forbidden domain code point. With `beStrict`
true, every domain is read by ToASCII with CheckHyphens, UseSTD3ASCIIRules and VerifyDnsLength true as well, and its
result is the answer. A lone surrogate is read as U+FFFD, which every domain parse refuses.

A domain of length n takes O(n log n) time. The Standard sets no bound on the length when `beStrict` is false.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `domain` | `string` | `undefined` |
| `beStrict` | `boolean` | `false` |

#### Returns

`string` \| `null`

***

### fromBase64()

> **fromBase64**(`s`): `Uint8Array`\<`ArrayBuffer`\> \| `null`

The bytes of `s` when it is padded standard base64 (RFC 4648 §4) in its canonical form (RFC 4648 §3.5), or null: the
standard alphabet, `=` padding to a multiple of four characters, and zero bits past the last whole byte in the last
character before the padding. A text whose last character before the padding has a bit set past the last byte is not
that form. Every rail's standard base64 is read by this one function, in one pass over the text.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| `null`

***

### fromBase64Url()

> **fromBase64Url**(`s`): `Uint8Array`\<`ArrayBuffer`\> \| `null`

The bytes of `s` when it is base64url without padding (RFC 4648 §5), the base64url of RFC 7515 §2, in its canonical
form (RFC 4648 §3.5), or null: the URL-safe alphabet alone, no `=` padding, a length that is not one more than a
multiple of four, and zero bits past the last whole byte in the last character. Every base64url this package reads,
a JWS or SD-JWT segment's and an MPP challenge's included, is read by this one function, in one pass over the text.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| `null`

***

### fromLcpString()

> **fromLcpString**(`s`): `` `0x${string}` `` \| `null`

Decodes `lcp:sha256:0x…`, returning the lowercase hash, or null for anything else.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `string` |

#### Returns

`` `0x${string}` `` \| `null`

***

### fromLegalContext()

> **fromLegalContext**(`o`): \{ `h`: `` `0x${string}` ``; `url`: `string`; \} \| `null`

Decodes the structured form: `type` "sha256", a 32-byte hash, and an `https://` link in either spelling. Returns
the lowercase hash and the link, or null for anything else, including two spellings that disagree. Other members
are ignored.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | `unknown` |

#### Returns

\{ `h`: `` `0x${string}` ``; `url`: `string`; \} \| `null`

***

### fromLegalContextHeader()

> **fromLegalContextHeader**(`value`): [`Refusal`](#refusal) \| [`LegalContextReturn`](#legalcontextreturn)

H, and the return value where the header carries `rv`, from a `Legal-Context` header's value, parsed as an RFC 9651
Item (section 4.2): spaces before and after the item and after each `;`; a bare item that is a token, H's LCP string
in lowercase hex; and parameters whose keys are `rv` alone, a repeated key overwriting the value before it
(section 4.2.3.2). `rv` is a byte sequence of 32 bytes in the standard base64 alphabet, read with its `=` padding
absent and with bits set past its last byte, which section 4.2.7 says a parser should not refuse. Any other value is
`return/header-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

#### Returns

[`Refusal`](#refusal) \| [`LegalContextReturn`](#legalcontextreturn)

***

### fromRawBytes()

> **fromRawBytes**(`b`): `` `0x${string}` `` \| `null`

The lowercase hash of exactly 32 raw bytes, or null.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `Uint8Array` |

#### Returns

`` `0x${string}` `` \| `null`

***

### hash()

> **hash**(`bytes`): `Promise`\<`` `0x${string}` ``\>

SHA-256 over the bytes as given, as `0x` and lowercase hex. Rejects with a TypeError when `bytes` is not a
`Uint8Array`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `bytes` | `Uint8Array` |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### hashEquals()

> **hashEquals**(`a`, `b`): `boolean`

True when `a` and `b` are each `0x` and 64 hex digits, in either case, and decode to the same 32 bytes (LCP §2.5).
Anything else is false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | `string` |
| `b` | `string` |

#### Returns

`boolean`

***

### isHttpsLink()

> **isHttpsLink**(`s`): `s is string`

The one https-link rule. The raw string holds no whitespace, control character or backslash; it parses as an
absolute URL by the WHATWG URL Standard's basic URL parser, with no base; its scheme is `https`, compared
case-insensitively (RFC 3986 §3.1); its authority has a host, a DNS name or an IP literal, and no userinfo. The
scheme, the authority, the host and the port are read by this package's own copy of the Standard's parser and host
parser (`parseHost`), so the answer is the same on every runtime; the path, query and fragment never fail that parse.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`s is string`

***

### isOtherSchemeLink()

> **isOtherSchemeLink**(`s`): `s is string`

True for a string of at most 2048 characters that parses as an absolute URL whose scheme is not `https`, by the WHATWG
URL Standard's basic URL parser with no base, read by this package's own copy of it as `isHttpsLink` reads one: the
one failing link a pairing's `read` refuses as `link-not-https`, where every other failing link is
`legal-context-malformed`. Card's, ACK's and AP2's `read` refuse every link that is not `https` as
`legal-context-malformed`. A pairing's `advertise`, and MPP's and A2A's `place`, refuse every link that is not
`https` as `link-not-https`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`s is string`

***

### isRefusal()

> **isRefusal**(`v`): `v is Refusal`

True only for a refusal a copy of this package made: a value whose own property keyed by the registered symbol
`Symbol.for("@integraledger/lcp/refusal")` holds `true`, the mark `refusal` sets as a non-enumerable property. Every
installed copy of the package recognises the refusals of every other, as when two installs serve one process. A
caller's value shaped `{ refused: true, … }`, a value read from JSON, and a spread or `structuredClone` copy of a
refusal hold no mark, so none of them is a refusal, and no such input is ever passed on as one. `JSON.stringify`
writes a refusal as `{"refused":true,"code":…}`. Never throws.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `v` | `unknown` |

#### Returns

`v is Refusal`

***

### newAtrId()

> **newAtrId**(): `string`

A random RFC 9562 version 4 UUID, lowercase.

#### Returns

`string`

***

### pairingOf()

> **pairingOf**(`option`): [`PairingOn`](#pairingon)\<`"x402"`\> \| `undefined`

The x402 pairing that serves an option: the first x402 pairing in `BINDINGS` whose `read` offers it, on a document
holding that option alone. Undefined when none does. Each pairing's `read` applies the one filter its `advertise`,
`build`, `bound` and `reference` apply, so the pairing named takes the option at every step.

No two x402 pairings' `read` offers one option, except the two ERC-7710 levels, which share the `erc7710` option: this
names `x402/exact/eip155/erc7710`, and `pairingOfPayment` names the level from a payment. A Worker that serves one
pairing need not import this function, which loads every pairing: the pairing's own `read`, on a document holding
the option, or its `bound`, on a presented payment, answers for that pairing alone.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

[`PairingOn`](#pairingon)\<`"x402"`\> \| `undefined`

***

### parseHost()

> **parseHost**(`input`, `isOpaque?`): `string` \| `null`

The URL Standard's host parser (§3.5), with the host serializer (§3.6): the serialized host, or null for failure.

`[…]` is read by the IPv6 parser and serialized in brackets, compressed. With `isOpaque` true (the host of a URL
whose scheme is not special) any other input is an opaque host: it fails on a forbidden host code point, and is
otherwise UTF-8 percent-encoded with the C0 control percent-encode set. Otherwise the input is percent-decoded,
decoded as UTF-8, and read by the domain parser (`domainToAscii` with `beStrict` false); a domain whose last label,
after one trailing dot, is a number is read by the IPv4 parser, in decimal, `0x` hex or `0`-led octal parts, and
serialized as four decimal numbers. The empty string is an opaque host, and a failure otherwise. A lone surrogate is
read as U+FFFD, and so are percent-encoded bytes that are not UTF-8, which the domain parser fails on.

An input of length n takes O(n log n) time. The Standard sets no bound on the length.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `input` | `string` | `undefined` |
| `isOpaque` | `boolean` | `false` |

#### Returns

`string` \| `null`

***

### parseJson()

> **parseJson**(`text`): `unknown`

The value of JSON text nested at most 64 levels deep; undefined for text that is deeper or is not JSON.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`unknown`

***

### readToRepeat()

> **readToRepeat**(`code`): `boolean`

True when `code` is a read to repeat: a refusal whose answer rests on a read of the rail that may answer differently
later, with nothing the caller must change. The caller asks again later, since the payment may already have moved.
These are each reader's `<rail>/unreadable` (the reader failed, or answered out of its documented form) and
`<rail>/not-found` (the reader holds no landed transaction for the reference yet), and the codes of a transaction
that is not final yet: `casper/not-executed`, `ccd/not-finalized`, `xrpl/not-validated`, `evm/not-final` (a revert,
or a receipt without what the read looks for, in a block above the reader's `finalized` mark, which can be replaced
by one in which the transaction succeeds or holds other logs),
`polkadot/not-final` (an extrinsic not dispatched as the payment, in a block above the finalized height),
`stacks/not-final` (a failure in a Stacks block fewer than two tenures below the tip, which can be replaced),
`starknet/not-final` (a revert, or no single matching transfer, in a pre-confirmed block, which can change),
`svm/not-final` (a transaction at Solana's `confirmed` not found at `finalized`, with an error or none) and
`tempo/not-final` (as `evm/not-final`, on Tempo). The refusal code reference marks each of them.

False for every other string. A verdict is not a read to repeat: a later read gives the same answer. Nor is a call the
caller must change before it can succeed: `<rail>/wrong-reader` (a reader for another network, or a ref the rail
cannot read) and `<rail>/read-first` (`bound` or `reference` on a push credential before `fetchPresented` has read
it), a missing peer dependency,
and malformed input. A string the package does not return is false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `string` |

#### Returns

`boolean`

***

### readUrl()

> **readUrl**(`input`): [`UrlAuthority`](#urlauthority) \| `null`

The scheme and authority of a string that the URL Standard's basic URL parser (§4.4) reads, with no base, as an
absolute URL, or null where it returns failure. Only the scheme and the authority can fail: the parser's path, query
and fragment states accept every input, so they are not read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` |

#### Returns

[`UrlAuthority`](#urlauthority) \| `null`

***

### servesOf()

> **servesOf**(`option`, `atr?`): readonly `string`[] \| [`Refusal`](#refusal) \| `undefined`

The charge options an agreement option names as those it serves: each `<slot>/<i>`, the option at index `i` of the
charge options the ATR binding slot of that name holds: `accepts` of `x402`, `challenges` of `mpp`, `paymentOptions`
of `ack`, and `options` of `acp`, `ap2`, `card` and `ucp`. On an x402 option the member is
`extra.legalContextServes`, an array of those strings; on an MPP challenge it is `opaque`'s `legalContextServes`,
those strings joined by one space. Undefined where the option carries no such member; `return/serves-malformed`
where the member is not 1 to 32 distinct such strings. Where `atr`, the ATR's bytes, is given, each name is also
resolved against it: a name whose slot is not the ATR's binding slot (its member after `atrVersion` and `id`), or
whose index is not below the number of charge options that slot holds, is `return/serves-malformed`, and so is every
name where `atr` is not the bytes of a UTF-8 JSON object of at most 1 MiB.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `unknown` |
| `atr?` | `Uint8Array`\<`ArrayBufferLike`\> |

#### Returns

readonly `string`[] \| [`Refusal`](#refusal) \| `undefined`

***

### toBase64()

> **toBase64**(`b`): `string`

Padded standard base64 (RFC 4648 §4) of `b`, in the canonical form `fromBase64` reads, in one pass over the bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `Uint8Array` |

#### Returns

`string`

***

### toBase64Url()

> **toBase64Url**(`b`): `string`

base64url without padding (RFC 4648 §5) of `b`, in the canonical form `fromBase64Url` reads, in one pass over the
bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `Uint8Array` |

#### Returns

`string`

***

### toLcpString()

> **toLcpString**(`h`): `string`

LCP §8.1 string form: `lcp:sha256:0x…`. Throws TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`string`

***

### toLegalContext()

> **toLegalContext**(`h`, `url`, `spelling?`): `object`

LCP §8.1 structured form, with the link beside the digest. `spelling` "snake" writes `legal_context_url`.
Throws TypeError when `h` is not a 32-byte hash or `url` is not an `https://` URL.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `h` | `` `0x${string}` `` | `undefined` |
| `url` | `string` | `undefined` |
| `spelling` | `"camel"` \| `"snake"` | `"camel"` |

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `legalContext` | `object` |
| `legalContext.legal_context_url?` | `string` |
| `legalContext.legalContextUrl?` | `string` |
| `legalContext.type` | `"sha256"` |
| `legalContext.value` | `` `0x${string}` `` |

***

### toLegalContextHeader()

> **toLegalContextHeader**(`h`, `returnValue?`): `string` \| [`Refusal`](#refusal)

The header's value, an RFC 9651 Item: H's LCP string as a token, and, where `returnValue` is given, the parameter
`rv`, its 32 bytes as a byte sequence. An H that is not a 32-byte hash, or a return value that is not 32 bytes, is
`return/header-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |
| `returnValue?` | `Uint8Array`\<`ArrayBufferLike`\> |

#### Returns

`string` \| [`Refusal`](#refusal)

***

### toRawBytes()

> **toRawBytes**(`h`): `Uint8Array`\<`ArrayBuffer`\>

The raw 32 bytes of a hash. Throws TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

## References

### LcpPattern

Re-exports [LcpPattern](x402.md#lcppattern)
