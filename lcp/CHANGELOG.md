# Changelog

Every release of `@integraledger/lcp`, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While the version is 0.x, a minor release may remove or
rename exports and pairing ids and change a function's arguments or answers; a patch release does not.
[Upgrading](../docs/upgrading.md) gives each change a caller of 0.5.x makes for 0.6.0.

## [Unreleased]

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

[0.6.0]: https://github.com/IntegraLedger/integra-protocol/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/IntegraLedger/integra-protocol/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/IntegraLedger/integra-protocol/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/IntegraLedger/integra-protocol/tree/v0.4.0
