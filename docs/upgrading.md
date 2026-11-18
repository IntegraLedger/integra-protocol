---
title: Upgrading
description: What a 0.x release of @integraledger/lcp may change, the ranges to pin, and each change a caller of 0.5.x makes for 0.6.0.
---

# Upgrading

This page is for a developer whose code already uses `@integraledger/lcp` and who is moving it to a newer release. At
the end you know what a release may change, how to pin the package and its peers, and each change your code makes to
move from 0.5.x to 0.6.0. The [changelog](../lcp/CHANGELOG.md) records every release.

## What 0.x means for this package

While the version is 0.x, a minor release, such as 0.5 to 0.6, may remove or rename exports and pairing ids and change
a function's arguments or answers. A patch release does not. Pin the package with a tilde range, which takes patch
releases only, and read the changelog before you move to the next minor:

```sh
npm install @integraledger/lcp@~0.6.0
```

## The ranges

| What | Range |
|---|---|
| Node.js | `>=24.22.1`, the package's `engines.node`. CI runs the package's tests on Node.js 24.22.1 and on 26. |
| The settler, `@integraledger/profile-facilitator` 0.5.0 | Its peer dependency on this package is `~0.6.0`, so install the two together with `npm install @integraledger/profile-facilitator @integraledger/lcp@~0.6.0`. Without the range, npm takes the newest lcp, which a later minor puts outside the settler's peer range. |
| The buyer packages, `@integraledger/terms` 0.5.0 | The same peer dependency, `~0.6.0`. |
| The optional rail peers | `@solana/kit` `^8.3.0`, `@stellar/stellar-sdk` `^17.1.0`, `ripple-binary-codec` `~2.11.0`, `@mysten/sui` `^2.31.3`, `borsh` `^2.0.0`, `@ton/core` `^0.63.1` and `algosdk` `^3.8.0`. `~2.11.0` admits 2.11.x only and `^0.63.1` admits 0.63.x only, so install those two with their range ([the package README](../lcp/README.md#install)). |

## From 0.5.x to 0.6.0

The core is unchanged in use: `assemble`, `hash`, `hashEquals`, the forms of H, and the x402 flow of
[Getting started](./getting-started.md) run as they did, except that `assemble` refuses more party JSON
([Stricter checks](#stricter-checks)). The changes are in the pairings, in the read of a settlement, and in MPP's
placement.

### Removed pairings

| 0.5.x | Use instead |
|---|---|
| `x402/exact/stellar` (`exactStellar`) | `x402/exact/stellar/precondition` (`exactStellarPrecondition`), from the same entry point, `@integraledger/lcp/x402-exact-stellar`: H rides in the transaction's signed-payload precondition, all of H. |
| `x402/exact/lnbtc` (`exactLnbtc`), `x402/exact/lnbtc/invoice-named` (`exactLnbtcNamed`) | `x402/exact/lnbtc/payment-hash` (`exactLnbtcPaymentHash`, from `@integraledger/lcp/lightning`), at coverage `none`. |
| `mpp/charge/tempo/memo` (`tempoMemo`), `mpp/charge/tempo/push` (`tempoPush`) | `mpp/charge/tempo/split-memo` (`tempoSplitMemo`) and `mpp/charge/tempo/split-memo/push` (`tempoSplitMemoPush`): H is the memo of a split `{recipient, amount: 1, memo: H}` the challenge carries. Neither has `build`: the payer's own client builds the payment. |
| `mpp/session/solana` (`sessionSolana`) | `mpp/session/solana/memo` (`sessionSolanaMemo`), whose opening carries H's LCP string in a Memo instruction the payer signs, or `mpp/session/solana/stock` (`sessionSolanaStock`), the stock client's session, at coverage `none`. |
| `mpp/session/hedera` (`sessionHedera`) | `mpp/session/hedera/stock` (`sessionHederaStock`, with `HederaStockRef`, `HederaStockReader` and `hederaStockStatus` from `@integraledger/lcp/mpp`), at coverage `none`. |
| `mpp/charge/hedera` (`chargeHedera`, from `@integraledger/lcp/hedera` and `@integraledger/lcp/mpp`) | `mpp/charge/lcp/hedera` (`chargeLcpHedera`, choice `LcpHederaChoice`, from `@integraledger/lcp/mpp`): MPP's `lcp` method on Hedera, whose signed memo is H's LCP string. |
| `mpp/charge/stellar` (`chargeStellar`) | No MPP pairing on Stellar. Stellar is served on x402, by `x402/exact/stellar/precondition`. |

At coverage `none`, no public act the payer signs carries H, so the sale is served only after an agreement payment
([the agreement URL](./concepts/buyer-gate.md#the-agreement-url)).

### Removed exports

| 0.5.x | Instead |
|---|---|
| `card`: `TAP_FIELD` | None. Visa TAP carries H in the `nonce` of the agent's `agent-payer-auth` message signature, or in the checkout path that signature covers, and no longer in an `lcp-hash` field. |
| `ccd`: `ccdIdDigest`; `near`: `nearLapsed`; `polkadot`: `polkadotLocate`; `svm`: `svmLocate`, `svmNonceMoved` | None. The pairing's `status` runs its own search for the payer's acts and reads the lapse, and answers in the read-status shape. |
| `hedera`: `chargeHedera`, `ESCROW_OPEN_SELECTOR`, and the types `HederaChargeChoice`, `HederaEvmReader`, `HederaSessionRef` | The Hedera MPP pairings above, from `@integraledger/lcp/mpp`. |
| `lightning`: `atrNamesInvoice`, `exactLnbtc`, `exactLnbtcNamed` | `exactLnbtcPaymentHash`, `checkPreimage` and `validateExactLnbtc`. |
| `mpp`: `chargeHedera`, `chargeStellar`, `sessionHedera`, `sessionSolana`, `tempoMemo`, `tempoPush` | The pairings above. |
| `stellar`: `muxedId` | None: no pairing carries H's first 8 bytes as a muxed id. `muxedFor(payee, position)` now writes the muxed address of a transaction's position. |
| `svm`: `sessionSalt` | None: it was the salt of the removed `mpp/session/solana`. |
| `x402-exact-stellar`: `exactStellar` | `exactStellarPrecondition`. |

### The pattern record and the pairing's data

Every pairing now has `data`, typed `PairingData`, and `pattern` keeps only where the binding is seen
([what each binding proves](./concepts/binding.md#what-each-binding-proves)).

| 0.5.x | 0.6.0 |
|---|---|
| `pattern.proves` | `data.proves` |
| `pattern.buyerSigns` | `data.carrier.signed !== null`: the field of what the payer signs that carries H, or null. |
| `pattern.publicProof` | `data.coverage === "full"` |
| `pattern.canonical` | Removed. Nothing read it. |
| `pattern.pattern` `"truncated-field"` | Removed with the pairings that used it. `pattern.pattern` is absent on `x402/exact/starknet`. |
| A pairing's `carrier` member | `data.carrier.member`: the path of the option or request member the seller writes H into. |
| `mpp/charge/hedera`'s `network` member | Removed with the pairing. |

### Reading a settlement

| 0.5.x | 0.6.0 |
|---|---|
| `reference(presented)` | `reference(presented, option)`: `option` is the x402 option or MPP challenge the payment answers, from which the reference takes the payee. |
| `status(ref, reader)`; on Sui `status(ref, reader, position)`; on Cardano `status(ref, reader, depth)` | `status(ref, reader, query)`, where `query` is `{ act, finality, after?, search?, others? }`: the act (`"payment"` or `"agreement"`), the finality asked for, a final position the transaction must come after, the search position an earlier answer returned, and other acts under the same H. Sui's `position` is `after`; Cardano's `depth` is `finality`, a count of confirmations. |
| An answer `{ state, why }`, `settled`, `pending` or `failed` | An answer `{ state, reason, ... }`: `settled`, with `transaction`, `finality` and `presented`; `pending`, with `below-mark`, `instrument-live`, `search-incomplete` or `not-found`; `failed`, with `instrument-unused`, `instrument-consumed`, `transaction-failed` or `before-position`; or `unreadable`, with `history-gap`, `transport`, `unparseable`, `too-large` or `chain-mismatch`. Every answer lists the `foreign` items it met. The `why` values are gone. |
| A read that did not complete answered `pending` | It answers `unreadable`, `transport`; a reader for another network, `unreadable`, `chain-mismatch`. Neither is ever `failed`. |
| `recover(tx, reader)` | `recover({ network, tx, option }, reader)`, `option` being the option or challenge the ATR's binding slot holds. |
| A rail's `…Status(ref, reader)` and `…Recover(ref, reader)`, such as `evmStatus` and `eip3009Recover` | `…Status(ref, reader, query)` and `…Recover(input, reader)`, as above. |

The [read-status profile](../lcp/profiles/read-status.md) states each answer and the rules that choose it, and
[Refusals](./concepts/refusals.md#readers) what a failed reader gives.

### MPP placement

| 0.5.x | 0.6.0 |
|---|---|
| `place(doc, h, link, option, agreementUrl?)`, and each MPP pairing's `advertise(doc, h, link, offer, agreementUrl?)` | `place(doc, h, link, option, position, act?, agreementUrl?)` and `advertise(doc, h, link, offer, position, act?, agreementUrl?)`. `position` is the challenge's place in the sale, 0 to 31, each challenge of the sale its own, the charge and the agreement challenges together, and `null` for a Tempo subscription. 0.5.x took the challenge's index in `doc`: pass that index to keep the same ids. An agreement URL passed where `position` now stands is refused, `mpp/challenge-malformed`. |
| An agreement challenge without `expires` | Refused, `mpp/expires-required`. |
| `challengeBound(c)` | `challengeBound(c, recorded)`: the echoed id must equal, whole, the one the seller recorded. |

Each MPP pairing's `advertise` also refuses an offer of another pairing.

### Other calls

| 0.5.x | 0.6.0 |
|---|---|
| `x402/exact/cardano`'s `advertise(doc, h, link, offer, agreementUrl?)` | `advertise(doc, h, link, offer, coinsPerUtxoByte, agreementUrl?)`: the protocol parameter, read when the offer is issued, from which the output's floor is computed; a lovelace offer below it is `cardano/amount-below-floor`. |
| `mpp/charge/usdc/gateway`'s `build({ challenge, from, now }, h)` | `build({ challenge, sourceNetwork, burnIntentExpirationHeight, withdrawalDelay }, h)`: the network the burn intent spends from, the height Circle Gateway's `GET /v1/info` serves for it and that network's Gateway Wallet's `withdrawalDelay()`, each a decimal string. `complete` refuses a signed burn intent whose `maxBlockHeight` differs, `mpp/max-block-height-changed`. |
| `stellar`: `muxedFor(base, h)`, `stellarLocate(ref, reader)`, `transferEventTopics(toBase)` | `muxedFor(payee, position)`, `stellarLocate(q, reader)`, `transferEventTopics(buyer)`. |

### Stricter checks

- `assemble` refuses, as `core/content-not-json`, a party slot whose JSON two JSON readers read differently: an object
  that repeats a member name, a number that overflows a double, or an integer beyond 2^53 - 1 either way. Write such a
  number as a string ([the rules `assemble` enforces](./concepts/atr.md#the-rules-assemble-enforces)).
- `requestCommitment` refuses a method that is not an RFC 9110 token, `x402/request-target-invalid`.
- Node.js `>=24.22.1`, where 0.5.x took `>=24`.

25 refusal codes are gone with the forms that returned them; the [changelog](../lcp/CHANGELOG.md) lists them. A
caller that matches one can drop that branch.
