# Changelog

Every release of `@integraledger/lcp`, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While the version is 0.x, a minor release may remove or
rename exports and pairing ids and change a function's arguments or answers; a patch release does not.
[Upgrading](../docs/upgrading.md) states what 0.6's patch releases add, and each change a caller of 0.5.x makes for
0.6.0.

## [Unreleased]

### Fixed

- The Solana channel openings' read (`svmChannelStatus` and `svmOpeningStatus` of `@integraledger/lcp/svm`, the
  `status` of `x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/session/solana/memo` and
  `mpp/session/solana/stock`) reads the payee an `open` names, its third account, a seed of the channel's address: the
  deposit counts where that payee is the option's payee or the `open`'s distribution holds it. It read the distribution
  alone, so an `open` with no distribution, which `@solana/mpp` 0.7.0 composes for a session challenge with no
  `splits`, named no account and was never the sale. Every `open` names an account now: one whose payee is another
  account and whose distribution does not hold the option's payee names `other`. `Moved.beneficiary` and `Moved.to`
  keep 0.6.2's values, and on an `open` with no distribution are its payee, where they were absent and the channel's
  account. The read kit's case of an act of the pairing's kind that names no account is declared inapplicable to the
  four pairings, in their profiles.
- Every XRP Ledger read whose search runs through the payer's `account_tx` (the `status` of `x402/exact/xrpl`,
  `x402/upto/xrpl`, `mpp/charge/xrpl`, `mpp/session/xrpl` and `mpp/session/xrpl/stock`, and `xrplStatus`,
  `xrplChargeStatus` and `xrplChannelStatus` of `@integraledger/lcp/xrpl`) answers `failed` where a search read whole
  proves absence. `account_tx` lists every transaction of the payer's account, a delegated payment (`Delegate`) and an
  inner `Batch` payment among them, as rippled 3.4.1 lists them on the XRPL Testnet
  (`test/fixtures/xrpl-delegated-batch-testnet.json`). A payment that lapsed is `instrument-unused`, one whose
  sequence number or ticket another transaction took `instrument-consumed`, and a validated `tec` result
  `transaction-failed`, where each answered `pending`, `search-incomplete`; a stock session's channel the validated
  ledger shows whose create the search, read whole from the position, does not hold is `failed`, `before-position`.
  The profiles `x402-exact-xrpl` (rule 15), `x402-upto-xrpl`, `mpp-charge-xrpl` and `mpp-session-hedera-solana-xrpl`
  state it, and the read kit runs the cases they declared inapplicable while the search proved no absence.
- `x402/exact/starknet` takes an option of amount `"0"` on a token whose transfer of zero emits a `Transfer`, as the
  profile `x402-exact-starknet` (rule 24) states the agreement's floor: on Starknet Sepolia, STRK and USDC, each of
  whose `transfer(to, 0)` emits a `Transfer` of 0 (`starknet_simulateTransactions`,
  `test/fixtures/starknet-zero-transfer-sepolia.json`). `starknetFloor` (`@integraledger/lcp/starknet`) takes an
  optional `network` beside `asset` and answers 0 for those tokens on that network, 1 on any other and where no
  network is given, and refuses a network that is not Starknet's (`starknet/network-malformed`). The option filter
  refused `"0"` on every token.

## [0.6.2] - 2026-11-19

### Added

- An agreement option's served member (profile `legal-context-return`, rule 6) names a charge option `<slot>/<i>` for
  every ATR binding slot that holds charge options: `x402/<i>` (`accepts`) and `mpp/<i>` (`challenges`), as before,
  and `ack/<i>` (`paymentOptions`), `acp/<i>`, `ap2/<i>`, `card/<i>` and `ucp/<i>` (`options`), so a card or checkout
  sale offered an agreement as an x402 option or an MPP challenge names its card or checkout options. `servesOf` reads
  the new names, and takes the ATR's bytes as an optional second argument, `servesOf(option, atr?)`, against which it
  resolves each name: a slot that is not the ATR's binding slot, or an index not below the number of options that slot
  holds, is `return/serves-malformed`. `legal-context-return.json` gains a card ATR and its rows. A reader on 0.6.1 or
  earlier refuses the new names ([Upgrading](../docs/upgrading.md#within-06)).
- `@integraledger/lcp/mpp` writes and reads MPP's three HTTP fields, so a resource server writes and reads MPP's forms
  from this package: `encodeChallenge(challenge)` writes one challenge as a `WWW-Authenticate` field value, as the
  `mppx` SDK 0.17.6 writes it, and refuses one `parseChallenges` would not read back as the same members, or whose
  `header` is not `Payment-Authorization` (`mpp/challenge-malformed`); `decodeCredential(fieldValue)` reads the
  credential from an `Authorization` or `Payment-Authorization` field value, held to the shape every `bound` reads
  first (`mpp/credential-malformed`); and `encodeReceipt(receipt)` writes a successful response's `Payment-Receipt`
  field value (`mpp/receipt-malformed`), with the type `MppReceipt`. No existing export changes.
- `encodeCredential(credential)` and `decodeReceipt(fieldValue)` (`@integraledger/lcp/mpp`), the other halves of
  `decodeCredential` and `encodeReceipt`, so a buyer's client answers a challenge and reads the receipt with this
  package: `encodeCredential` writes the `Authorization` or `Payment-Authorization` field value as the `mppx` SDK
  0.17.6 writes it, leaving out the echoed challenge's `meta` and an empty `source`, and refuses a credential
  `decodeCredential` would not read back (`mpp/credential-malformed`); `decodeReceipt` reads a `Payment-Receipt` field
  value of at most `MAX_HEADER_BYTES` (65,536) bytes, canonical base64url without padding, and refuses one that does
  not decode to a receipt `encodeReceipt` writes (`mpp/receipt-malformed`).
- Four registry facts as data, beside the prose that states them. `data.agreement.feePayer` (`FeePayer`): the parties
  that may pay an agreement's fee (`FeeParty`: `buyer`, `settler`, `paymaster` or `none`) and the one that pays where
  the option names none, on every pairing whose payment can be an agreement, so a resource server can check the fee
  payer it declares against the pairing. `data.payeePreconditions`: what the payee's account must hold or be on chain
  before it can be paid, where the profile states it (`x402/exact/hedera`, `mpp/charge/lcp/hedera`,
  `x402/exact/polkadot/lcp-assets-remark`, `x402/upto/xrpl`). `data.read.chains`: the networks, as CAIP-2 ids, each
  contract the read names is deployed on, where the profile or the package states them, so an option on a network the
  contract is not on can be refused by data. `data.cardLike`: `true` on the card-like pairings, which are on no
  network a CAIP-2 id names, telling them from Lightning's, whose invoice is on an `lnbtc` network. The root exports
  the types `FeePayer` and `FeeParty`. No existing member changes.
- `MAX_ATR_BYTES` (1,048,576) and `MAX_SLOT_NAME_LENGTH` (64), from the root: the largest ATR `assemble` writes and
  the longest slot name it accepts, so a server sizes its own limits from them. `assemble`'s rules do not change.
- `suiFloor` (`@integraledger/lcp/sui`) and `starknetFloor` (`@integraledger/lcp/starknet`): the agreement's floor
  that each pairing's data gives as `rule`, as `cardanoFloor` gives Cardano's. `suiFloor` takes the option's gas path
  and, on the gasless path, the coin type's smallest transfer that Sui's protocol configuration lists, answering the
  larger of it and 1; `starknetFloor` takes the token and answers 1. A new code, `sui/floor-input`, refuses a gas path
  or parameter `suiFloor` cannot read.
- `cardanoInputs` (`@integraledger/lcp/cardano`): the inputs a transaction's body spends, as `<id>#<index>` in the
  body's order, read from the transaction's bytes with the Cardano reader's bounds, so a `CardanoReader` answers
  `inputAddresses` from an indexer that returns a transaction's CBOR.
- `Moved.contract` and `Moved.beneficiary`, optional: on a deposit into a contract, the contract it was deposited
  into, in the chain's own spelling, and the account that contract names as the payment's beneficiary, where it names
  one. `to` keeps every value it had; its documentation now states that on a deposit it is, as each pairing's profile
  states, the beneficiary or the contract, which the two new members name apart. `contract` is absent on a transfer.
  The reads that record a deposit set them: the MPP session openings on Tempo and EVM (the escrow; the channel's
  `payee`), `x402/auth-capture/eip155/*` (the escrow; the `PaymentInfo.receiver`), `x402/batch-settlement/eip155` (the
  channel contract; the channel's `receiver`), the XRPL `PaymentChannelCreate` reads of `x402/upto/xrpl` and the XRPL
  sessions (the channel's id; its `Destination`), the Solana channel openings of `x402/upto/solana`,
  `x402/batch-settlement/solana` and the Solana sessions (the channel's account; the payee the `open`'s distribution
  holds, else its first recipient), and the Cardano reads (a script's address in Bech32 for an output with an inline
  datum; on the Masumi lock, the seller its escrow datum names). The Hedera stock session opening records the
  beneficiary alone.
- `named`, optional, on `Named`, `Seen` and `ForeignItem`: the account an act names apart from what it moved. The read
  of `mpp/subscription/tempo` sets it to the activation's one recipient, the account the key authorization it carries
  lets its key pay. The profile `read-status` (rules 13 and 14) and each pairing's profile state what is recorded.
- `issuedDigest` from `@integraledger/lcp/card`, `@integraledger/lcp/ack` and `@integraledger/lcp/spend-permissions`,
  as every other surface's entry point exports it, so a seller or resource server that keeps only a digest of each
  option it issued tells whether what a buyer presents answers one of them. On `card` and `ack` it is SHA-256 over the
  RFC 8785 form of the option as issued, as on `acp`, `ap2` and `ucp`. On `spend-permissions` (profile
  `spend-permissions/eip155`, rule 9) it covers the members the resource server fixes at issue alone: `network`,
  `manager`, and the permission's `spender`, `token`, `allowance`, `period`, `start`, `end` and `extraData`, leaving
  out `salt` (H), `account` and `accepts`, so the offer as `advertise` takes it, the offer the `402` body places and a
  return of it on either route have one digest; any other value is `spend-permissions/option-malformed`.
  `spend-permissions-eip155.json` gains the rows.

### Fixed

- Every XRP Ledger read (the `status` of each XRPL pairing, and `xrplStatus`, `xrplChargeStatus`, `xrplOpenStatus` and
  `xrplChannelStatus` of `@integraledger/lcp/xrpl`) answers `unreadable`, `history-gap` where the reader rejects with
  `ReaderError` of kind `history`, as the EVM reads do, where it answered `transport`. `XrplReader` states when a
  reader rejects so: where the server refuses a call for ledgers it does not hold, as rippled on API version 2 refuses
  `account_tx` from a ledger below those it holds with `lgrIdxMalformed`. The caller then reads again through a server
  that holds the ledgers.
- `TonTx`'s `before` and `after`, and the profile `x402-exact-tvm`'s expiry read, state where a reader takes the
  account's status: TON Center v3's `orig_status` and `end_status`. A deploy's `account_state_before` states no
  status, so a reader that took it from there gave the expiry read's search no status before the deploy, and the
  search held there.
- `network` (`@integraledger/lcp/mpp`) gives a Hedera session challenge (`session` on `hedera`) its network from
  `methodDetails.chainId`, `hedera:mainnet` for 295 or none and `hedera:testnet` for 296, the network `sessionResume`
  reads, where it answered `mpp/network-unnamed`.

## [0.6.1] - 2026-11-18

### Added

- Every type that an exported function, type or pairing names is exported, as a type, from each entry point whose
  declarations name it, so a caller can name what it passes and what it gets, and the API reference defines every type
  it shows. No runtime export, and no existing name or shape, changes. From the root: `AptosPaymentPayload`,
  `AvmPaymentPayload`, `BatchPaymentPayload`, `CardanoPaymentPayload`, `CasperPaymentPayload`, `CcdPaymentPayload`,
  `ChannelKind`, `CloudflarePaymentPayload`, `DataMembers`, `ExecutorPayload`, `ExecutorPaymentPayload`,
  `HederaPayload`, `HederaPaymentPayload`, `IsNever`, `Named`, `NearPayment`, `NoneWhereNever`, `NonZeroDigit`,
  `PairingOn`, `PolkadotPayload`, `PolkadotPaymentPayload`, `PresentedOn`, `PushMode`, `StarknetPayment`,
  `StellarPaymentPayload`, `SuiPaymentPayload`, `Surface`, `SurfaceOf`, `SvmPaymentPayload`, `TronPayment`,
  `TvmPayment`, `UptoSvmPaymentPayload`, `X402Payment`, `XrplPaymentPayload`; from `@integraledger/lcp/ap2`:
  `EvmMark`, `EvmQuery`; from `@integraledger/lcp/aptos`: `AptosPaymentPayload`, `X402Read`; from
  `@integraledger/lcp/avm`: `AvmPaymentPayload`, `X402Payment`, `X402Read`; from `@integraledger/lcp/cardano`:
  `CardanoPaymentPayload`, `CardanoQuery`, `X402Read`; from `@integraledger/lcp/casper`: `CasperChoice`,
  `CasperPaymentPayload`, `CasperRefRead`, `X402Advertise`, `X402Read`; from `@integraledger/lcp/ccd`: `CcdChoice`,
  `CcdMark`, `CcdPaymentPayload`, `X402Advertise`, `X402Read`; from `@integraledger/lcp/evm`: `EvmMark`, `EvmQuery`,
  `EvmReadRefBase`, `HederaNetwork`, `Signed`, `X402EvmRefBase`; from `@integraledger/lcp/hedera`: `ExecutorPayload`,
  `ExecutorPaymentPayload`, `HederaQuery`, `HederaVoucherTypedData`, `X402Payment`, `X402Read`; from
  `@integraledger/lcp/lightning`: `X402Advertise`, `X402Read`; from `@integraledger/lcp/mpp`: `ChannelKind`,
  `ChargeRefBase`, `EvmMark`, `EvmQuery`, `GatewayChargeChoice`, `HederaNetwork`, `HederaQuery`,
  `HederaSessionUnsigned`, `HederaVoucherTypedData`, `MppIntent`, `MppSessionOpeningRef`, `NearIntentsRef`,
  `RailSessionChoice`, `Seen`, `SessionWithinUnsigned`, `Signed`, `SolanaChargeChoice`, `SolanaChargeUnsigned`,
  `StacksChargeChoice`, `StockQuery`, `XrplQuery`, `XrplSessionUnsigned`; from `@integraledger/lcp/near`: `Answer`,
  `NearChoice`, `NearPayment`, `X402Payment`, `X402Read`; from `@integraledger/lcp/polkadot`: `PolkadotMark`,
  `PolkadotPayload`, `PolkadotPaymentPayload`, `X402Payment`, `X402Read`; from `@integraledger/lcp/spend-permissions`:
  `EvmMark`, `EvmQuery`, `EvmReadRefBase`; from `@integraledger/lcp/starknet`: `StarknetPayment`, `StarknetRefRead`,
  `X402Payment`, `X402Read`; from `@integraledger/lcp/stellar`: `StellarPaymentPayload`; from
  `@integraledger/lcp/sui`: `SuiMark`, `SuiPaymentPayload`, `X402Read`; from `@integraledger/lcp/svm`:
  `SvmInstruction`; from `@integraledger/lcp/tron`: `TronChoice`, `TronMark`, `TronPayment`, `X402Payment`,
  `X402Read`; from `@integraledger/lcp/tvm`: `TvmChoice`, `TvmMark`, `TvmPayment`, `X402Payment`, `X402Read`; from
  `@integraledger/lcp/ucp`: `Option`; from `@integraledger/lcp/x402`: `BatchedAuthorization`, `BreadthBase`,
  `BreadthId`, `Eip3009Authorization`, `EvmMark`, `EvmQuery`, `Pairings`, `Permit2Authorization`, `X402Advertise`,
  `X402PairingId`, `X402Read`, `X402SchemePayload`; from `@integraledger/lcp/x402-batch-settlement`:
  `BatchPaymentPayload`, `CloudflarePaymentPayload`, `EvmMark`, `EvmQuery`, `X402Advertise`, `X402Read`; from
  `@integraledger/lcp/x402-exact-solana`: `SvmChoice`, `SvmPaymentPayload`, `X402Read`; from
  `@integraledger/lcp/x402-exact-stellar`: `X402Read`; from `@integraledger/lcp/x402-exact-xrpl`: `X402Read`,
  `XrplChoice`, `XrplPaymentPayload`, `XrplQuery`; from `@integraledger/lcp/x402-upto-solana`:
  `UptoSvmPaymentPayload`, `X402Read`; from `@integraledger/lcp/x402-upto-xrpl`: `X402Read`; from
  `@integraledger/lcp/xrpl`: `XrplQuery`.
- `StatusAnswer`'s and `Seen`'s `presented` member is written as its union, `"yes" | "no" | "unshown"`, so `Presented`
  at the root names only what a buyer presents.

### Fixed

- `mpp/session/hedera/stock` and `mpp/session/xrpl/stock` have `pattern.onChain` `false`, from `true`: the stock client
  opens the session itself and nothing it signs carries H, and `onChain` states that the settlement carries H or a value
  derived from it.
- `x402/batch-settlement/cloudflare`'s `data.proves`, and its profile's rule 5, no longer say that an agreement was
  signed before the payment: the pairing has no `agreementOn` and follows no agreement. The profile's rule 5 now quotes
  `data.proves` whole.
- Every pairing names its profile in `pattern.profile`: `mpp/charge` on `mpp/charge/evm/authorization`,
  `mpp/charge/evm/permit2`, `mpp/charge/evm/transaction`, `mpp/charge/evm/hash`, `mpp/charge/usdc/evm`,
  `mpp/charge/usdc/gateway`, `mpp/charge/card` and `mpp/charge/stripe`; `mpp/session/evm-tempo` on
  `mpp/subscription/tempo`; and `x402/exact/lnbtc/payment-hash` on that pairing. The vector files of the eight MPP
  charges and of `mpp/subscription/tempo` carry the same `profile` in their `pattern`.
- The Lightning payment-hash profile is `profiles/x402-exact-lnbtc-payment-hash.md`, named by its id as every other
  profile is, in place of `profiles/x402-exact-lnbtc.md`.

### Documentation

- The `spend-permissions/eip155` profile's rule 26 records that both routes have run on Base Sepolia
  (`eip155:84532`) and read `settled` at `finalized` with `presented` `yes`: the route `"transaction"` in transaction
  `0x5062e7014d8f52009a3ff7284b931ad19a7808baf179516406f24b550c5360c0` (2026-11-17) and the route `"signature"`,
  `approveWithSignature` submitted by the spender, in transaction
  `0xfc55d672c94a4c07fdff80c5124a065be2f616475455119bb22a2172dc685914` (block 60521753, 2026-11-18). The pairing's
  `confirmed` stays `yes`.

## [0.6.0] - 2026-11-18

### Added

- 19 pairings: `ap2/checkout-mandate/x402`, `card/mastercard-agent-pay`, `card/visa-vic`, `mpp/charge/lcp/hedera`,
  `mpp/charge/solana/unsponsored`, `mpp/charge/tempo/split-memo`, `mpp/charge/tempo/split-memo/push`,
  `mpp/session/hedera/stock`, `mpp/session/solana/memo`, `mpp/session/solana/stock`, `mpp/session/xrpl/stock`,
  `mpp/subscription/solana`, `spend-permissions/eip155`, `ucp/checkout/agent-signed`, `x402/exact/cardano/lock`,
  `x402/exact/eip155/gateway-batched`, `x402/exact/lnbtc/payment-hash`, `x402/exact/stellar/precondition` and
  `x402/upto/xrpl`. `BINDINGS` holds 77 pairings on eight surfaces; `spend-permissions` is the new one.
- Two entry points: `@integraledger/lcp/spend-permissions` (`spendPermissionsEip155`, the `Spend-Permission` header's
  codec and the read of the approval) and `@integraledger/lcp/x402-upto-xrpl` (`uptoXrpl`).
- Every pairing's `data`, typed `PairingData`: `coverage`, `carrier`, `link`, `source`, `nonce`, `broadcasts`, `read`,
  `destination`, `asset`, `payer`, `agreementOn`, `confirmed`, `agreement` and `proves`. `data.confirmed` is `yes` on
  the 19 pairings that something outside the package has shown as their profiles define them.
- The act: `build(choice, h, act?)`, `bound(presented, given?)` and `reference(presented, option, given?)` take the act
  `agreement`, and `agreementValue(h)`, from the root and `@integraledger/lcp/core`, gives the agreement's own value
  that an agreement carries where a payment carries H, on a pairing whose single-use value is H itself or its low bits.
- x402's HTTP headers, from `@integraledger/lcp/x402`: `PAYMENT_REQUIRED`, `PAYMENT_SIGNATURE`, `PAYMENT_RESPONSE`,
  `encodeHeader`, `decodePaymentRequired`, `decodePaymentSignature` and `decodePaymentResponse`; the commitment to an
  MCP tool call, `toolCallCommitment`; and `requestCommitment(r, fields?)`, whose `fields` commit to named request
  header fields by name and the SHA-256 of each value.
- The return after an agreement, from the root: `LEGAL_CONTEXT_HEADER`, `toLegalContextHeader`,
  `fromLegalContextHeader`, `checkLegalContextReturn`, `LEGAL_CONTEXT_META`, `LEGAL_CONTEXT_SERVES`, `servesOf` and
  `RETURN_VALUE_BYTES`.
- MPP's mapping to x402, `toX402`, the nonce an `mpp/session/evm` authorization opening signs,
  `evmSessionAuthorizationNonce`, and `hederaStockStatus`, from `@integraledger/lcp/mpp`.
- The resource bounds, from the root: `MAX_CHALLENGE_DEPTH`, `MAX_CHALLENGES`, `MAX_CREDENTIAL_BYTES`,
  `MAX_HEADER_BYTES`, `MAX_JSON_DEPTH`, `MAX_LINK_LENGTH`, `MAX_OPTIONS`, `MAX_REQUEST_BYTES` and
  `MAX_SIGNATURE_BYTES`; each rail entry point exports its own read bounds and the types its read takes and answers.
- The registry and read types, from the root: `Codec`, `Entry`, `Family`, `PairingData`, `Carrier`, `Coverage`,
  `AgreementData`, `ReadData`, `Act`, `StatusQuery`, `StatusAnswer`, `PendingReason`, `FailedReason`,
  `UnreadableReason`, `ForeignItem`, `ForeignReason`, `Moved`, `OtherAct`, `Life`, `EndpointKind`, `RecoverInput`,
  `LegalContextRecord` and `LegalContextReturn`.
- Rail functions: `cardanoFloor`; `checkPreimage` and `validateExactLnbtc` (`lightning`); `nearRequest`, `tronRequest`
  and `tvmRequest`; `starknetRecover`; `stellarPosition`, `parseStellarPosition`, `signedPayload`,
  `readSignedPayload` and `stellarRecover`; `svmOpeningStatus`; `keyAuthorizationDigest` (`tempo`);
  `xrplChannelStatus` and `xrplChargeStatus`; `checkoutJwt` (`ucp`).

### Changed

- `status` takes a query, `status(ref, reader, query)`: the act (`payment` or `agreement`), the finality asked for, and,
  where the caller has them, a final position the transaction must come after (`after`), the search position an
  earlier answer returned (`search`) and other acts under the same H (`others`). It answers `settled`, `pending`,
  `failed` or `unreadable`, with one `reason` of a closed list in place of `why`, what it read, on `settled` whether
  the act is the payment presented (`presented`), and the foreign items it met, as the profile `read-status` states. A
  read that did not complete answers `unreadable`, where it answered pending. Sui's `position` argument is the query's
  `after`, and Cardano's `depth` is its `finality`, a count of confirmations. Each rail's `…Status(ref, reader)`
  function changes the same way.
- `recover` takes `{ network, tx, option }` and the reader, and each rail's `…Recover(ref, reader)` function its
  `input` the same way.
- `reference` takes the option the payment answers: `reference(presented, option, given?)`.
- MPP: `place` and every MPP pairing's `advertise` take the challenge's position (0 to 31, each challenge of a sale its
  own; `null` for a Tempo subscription) and the act before the agreement URL:
  `advertise(doc, h, link, offer, position, act?, agreementUrl?)`. 0.5.x took the challenge's index in `doc`. An
  agreement challenge states `expires`, else `mpp/expires-required`. Each MPP `advertise` refuses another pairing's
  offer. `challengeBound(c, recorded)` holds the echoed id, whole, to the recorded one.
- `x402/exact/cardano`'s `advertise` takes `coinsPerUtxoByte`, the protocol parameter, before the agreement URL, and
  refuses a lovelace offer below the output's floor (`cardano/amount-below-floor`).
- `mpp/charge/usdc/gateway`'s `build` takes `{ challenge, sourceNetwork, burnIntentExpirationHeight, withdrawalDelay }`
  and writes the `maxBlockHeight` the burn intent signs; `complete` refuses a signed burn intent with another
  (`mpp/max-block-height-changed`).
- Visa TAP carries H in the `nonce` of the agent's `agent-payer-auth` message signature, or in the checkout path that
  signature covers, in place of an `lcp-hash` field.
- Stellar: `muxedFor(payee, position)`, `stellarLocate(q, reader)` and `transferEventTopics(buyer)`.
- `pattern` (`LcpPattern`) holds the binding pattern, the profile, `onChain`, `zeroPartyRecoverable` and
  `forwardIndexable`; `pattern.pattern` is absent on `x402/exact/starknet`.
- `assemble` refuses (`core/content-not-json`) party JSON that two JSON readers read differently: an object that
  repeats a member name, a number that overflows a double, or an integer beyond 2^53 - 1.
- `requestCommitment` refuses a method that is not an RFC 9110 token (`x402/request-target-invalid`).
- `engines.node` is `>=24.22.1`, from `>=24`. CI runs the tests on Node.js 24.22.1 and 26.

### Removed

- 9 pairings: `mpp/charge/hedera`, `mpp/charge/stellar`, `mpp/charge/tempo/memo`, `mpp/charge/tempo/push`,
  `mpp/session/hedera`, `mpp/session/solana`, `x402/exact/lnbtc`, `x402/exact/lnbtc/invoice-named` and
  `x402/exact/stellar`: the pairings whose payer signed only part of H, or whose stock client broadcast, and the two
  invoice-named Lightning forms.
- Exports, by entry point: `card` `TAP_FIELD`; `ccd` `ccdIdDigest`; `hedera` `chargeHedera`, `ESCROW_OPEN_SELECTOR`,
  and the types `HederaChargeChoice`, `HederaEvmReader` and `HederaSessionRef`; `lightning` `atrNamesInvoice`,
  `exactLnbtc` and `exactLnbtcNamed`; `mpp` `chargeHedera`, `chargeStellar`, `sessionHedera`, `sessionSolana`,
  `tempoMemo` and `tempoPush`; `near` `nearLapsed`; `polkadot` `polkadotLocate`; `stellar` `muxedId`; `svm`
  `sessionSalt`, `svmLocate` and `svmNonceMoved`; `x402-exact-stellar` `exactStellar`.
- `LcpPattern`'s `proves`, `buyerSigns`, `publicProof` and `canonical`, and the pattern `truncated-field`: read
  `data.proves`, `data.carrier.signed` and `data.coverage`. The pairing members `carrier` (read `data.carrier`) and
  `mpp/charge/hedera`'s `network`.
- 25 refusal codes, with the forms that returned them: `card/tap-field-malformed`, `card/tap-field-missing`,
  `card/tap-field-repeated`, `hedera/chain-id-unnamed`, `hedera/channel-id-mismatch`, `hedera/channel-log-not-found`,
  `hedera/not-final`, `hedera/reverted`, `ln/invoice-not-named`, `ln/no-legal-context`, `ln/not-this-pairing`,
  `mpp/modes-pull-only`, `near/no-relayer`, `polkadot/no-transfer`, `polkadot/range`, `stellar/carrier-occupied`,
  `stellar/read-first`, `stellar/tx-failed`, `svm/channel-mismatch`, `svm/proof-not-challenge`,
  `svm/signer-not-operator`, `svm/table-unusable`, `svm/version-not-built`, `xrpl/memos-not-carried` and
  `xrpl/multisigned`.

## [0.5.1] - 2026-11-16

- Reads version-1 Solana transactions, as the stock x402 client writes them, and writes the `upto` Permit2 nonce in
  decimal; refuses a Solana build whose `transactionVersions` does not admit version 0.

## [0.5.0] - 2026-10-24

- Runs on Node.js 24 (`engines.node` `>=24`, from `>=26.11.1`); the root exports MPP's id helpers `challengeH`,
  `challengeHash` and `challengeId`; MPP's EVM challenge hash frames the id and realm as a JSON array.

## [0.4.2] - 2026-10-16

- A TypeScript user without the optional `borsh` peer typechecks every entry point.

## [0.4.1] - 2026-10-16

- Every pairing's `broadcaster` and the `Broadcaster` type; `parseHost`, `domainToAscii`, `readUrl` and `FETCHED`; a
  rail's function without its optional peer refuses only at the step that needs the peer; `near-api-js` is no longer a
  peer dependency.

## [0.4.0] - 2026-10-15

- The earliest release tagged in this repository. Versions before it have no tag and are not recorded here.

[Unreleased]: https://github.com/IntegraLedger/integra-protocol/compare/v0.6.2...HEAD
[0.6.2]: https://github.com/IntegraLedger/integra-protocol/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/IntegraLedger/integra-protocol/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/IntegraLedger/integra-protocol/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/IntegraLedger/integra-protocol/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/IntegraLedger/integra-protocol/tree/v0.4.0
