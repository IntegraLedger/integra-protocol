---
title: MPP
description: The ATR hash as the MPP challenge id, the opaque members, and the MPP pairings.
---

# MPP

MPP, the Machine Payments Protocol, carries payment in HTTP authentication, as the
[Payment HTTP authentication scheme](https://paymentauth.org) defines it: the seller answers with one or more
`WWW-Authenticate: Payment` challenges, each naming a `method` (such as `evm`, `tempo`, `solana` or `stripe`) and an
`intent` (`charge`, `session` or `subscription`), and the buyer answers with a credential that echoes the challenge
it pays. Import the MPP pieces from `@integraledger/lcp/mpp`.

## Where H rides

On every MPP pairing, H rides in the challenge itself, in two places:

- **The challenge `id`** is the base64url (no padding) of H's 32 bytes, then `.` and the challenge's position in the
  402 response. A Tempo `subscription` challenge's id is the bare base64url of H, so a 402 that carries H holds one
  Tempo `subscription` challenge at most: `place` refuses a Tempo `subscription` challenge in a 402 that holds another
  (`mpp/witness-taken`). The `mppx` SDK's `tempo.subscription()` offers one subscription challenge per currency, by
  default two on Tempo's mainnet and testnet; a seller placing H there names one `currency`. `challengeId(h, index)`
  writes the id and `challengeH(id)` reads H back.
- **The challenge's `opaque`** map carries `legalContext`, H's LCP string, and `legalContextUrl`, the link. Where the
  pairing's payment carries H in nothing public, it also carries `legalContextAgreementUrl`.

MPP binds the credential to the challenge it echoes, so whatever the payer signs over the challenge id, or over a
value derived from it, commits to H. Some methods also carry H in a request member; `CARRIER` names that member for
each intent and method. Where the payer signs it, as `externalId` on `solana` charges and `methodDetails.invoiceId` on
`xrpl`, it is in the payment.

The package reads a challenge's `id`, `request` and `opaque` as base64url without padding in its canonical form only
(RFC 4648 §3.5). One with `=` padding, or whose last character has a bit set past its last byte, is malformed:
`mpp/id-not-ours`, `mpp/request-malformed` and `mpp/opaque-malformed`, on every pairing, the Hedera charge's request
checks included. `read` passes over a challenge whose `id` or `opaque` is in such a form, as it passes over one
that carries no hash.

`issuedDigest(challenge)` is the digest of what the seller issued: SHA-256 over the RFC 8785 form of the bound
members, with `request` decoded and its `CARRIER` member left out, and `opaque` without the LCP members. The seller
compares the echoed challenge's digest with the one it recorded at issue. A `stellar` charge's `recipient` is the one
carrier that stays in part: the digest keeps its base `G…` account and leaves out only the muxed id, so an echoed
challenge whose `recipient` names another account gives another digest.

## Placing and reading

`place(doc, h, link, option)` is the seller's placement over a list of challenges: the challenge whose bound members
equal `option` gets the id derived from H and an `opaque` holding the seller's own map plus the LCP members. `place`,
and so each pairing's `advertise`, refuses a list holding a challenge that carries a `refused` member as
`mpp/challenge-malformed`.
`read(doc)` is the buyer's reading: the challenges whose `opaque` carries an LCP hash and an `https` link and whose id
derives from that hash. `pairingsOf(challenge)` names the pairings a challenge offers, and `pairingsOfPlaced(challenge)`
those a placed challenge offers, with the Lightning invoice the seller's node writes after `place` required.
`tie(challenges)` is the ATR's binding slot: every challenge's bound members, as issued.

A challenge's `expires`, when present, is an RFC 3339 date-time, else `mpp/expires-required`. MPP's core makes it a
SHOULD for servers. A pairing needs it where its `build` writes it into what the payer signs: the EVM `authorization`
and `permit2` charges, Tempo's pull and push charges, the `usdc` EVM charge, the Stellar charge and the EVM and Tempo
sessions; the NEAR Intents and XRP Ledger charge drafts require it too. Without `expires` those pairings are left out of
what `pairingsOf`, `advertise`, `build`, `bound` and `reference` take, and a challenge left with no pairing is
`mpp/expires-required`.

```ts
import { hash, isRefusal } from "@integraledger/lcp";
import { challengeH, pairingsOf, place, read, type MppChallenge } from "@integraledger/lcp/mpp";

const request = Buffer.from(
  JSON.stringify({
    amount: "10000",
    currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    methodDetails: {
      chainId: 84532,
      credentialTypes: ["permit2", "authorization"],
      permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    recipient: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  }),
).toString("base64url");
const issued: MppChallenge = {
  id: "issued-by-the-seller",
  realm: "api.seller.example",
  method: "evm",
  intent: "charge",
  request,
  expires: "2026-09-21T14:14:20Z",
};
console.log(pairingsOf(issued));

const h = await hash(new TextEncoder().encode("abc"));
const placed = place([issued], h, "https://atr.seller.example/b3195b1f-4115-46b2-95a3-c9d61d7bfb01", issued);
if (isRefusal(placed)) throw new Error(placed.code);
const id = placed[0]!.id!;
console.log(id, challengeH(id) === h);
console.log(Buffer.from(placed[0]!.opaque!, "base64url").toString());

const offer = read(placed);
if (isRefusal(offer)) throw new Error(offer.code);
console.log(offer.h === h, offer.offer.challenges.length);
```

```text
[ 'mpp/charge/evm/permit2', 'mpp/charge/evm/authorization' ]
ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0.0 true
{"legalContext":"lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","legalContextUrl":"https://atr.seller.example/b3195b1f-4115-46b2-95a3-c9d61d7bfb01"}
true 1
```

`parseChallenges(fieldValues)` parses `WWW-Authenticate` field values into challenges, and `problem(code)` gives the
Payment scheme's problem type and HTTP status for a refusal code this package returns
([Answering the buyer](#answering-the-buyer)).

## The MPP pairings

| Method | Pairings | Where H rides in what the payer signs or lands |
|---|---|---|
| `evm` | `mpp/charge/evm/authorization`, `mpp/charge/evm/permit2` | The signed nonce, or the witness's `challengeHash`: keccak256 of the challenge id and realm (`challengeHash`). |
| `evm` | `mpp/charge/evm/transaction`, `mpp/charge/evm/hash` | Nothing signed or landed; H is in the challenge. |
| `tempo` | `mpp/charge/tempo/memo`, `mpp/charge/tempo/push` | The attribution memo MPP's SDKs write on the `transferWithMemo` (the layout MPP's Hedera method specifies), whose last 7 bytes are from keccak256 of the challenge id (`attributionMemo`): H is bound through those 7 bytes only. The `memo` credential's transaction is signed for the challenge's chain, `methodDetails.chainId` (42431 where it names none), else `tempo/tx-malformed`, which `build`'s `complete` also gives a transaction signed for another chain or one that does not decode, an empty one among them. A Tempo charge challenge whose `amount` is not 0 and that sets its own `methodDetails.memo` is refused (`mpp/carrier-taken`). With `methodDetails.splits`, `build` answers `tempo-calls`, the calls of one Tempo transaction as draft-tempo-charge-00's Split Payments section gives them: the primary `transferWithMemo` of `amount` less the splits, carrying the attribution memo, then one call per split in array order, `transferWithMemo` with the split's `memo` where it names one and `transfer` where it does not. |
| `solana` | `mpp/charge/solana` | The one LCP-form Memo instruction, holding H's LCP string (the request's `externalId`); other Memo instructions, such as split labels, are not read. |
| `stellar` | `mpp/charge/stellar` | The seller's muxed recipient address, whose 8-byte id is H's first 8 bytes: H is bound through those 8 bytes only. |
| `xrpl` | `mpp/charge/xrpl` | The Payment's `InvoiceID`: H itself (the request's `methodDetails.invoiceId`), in a Payment the payer signs with a single key. The Payment carries no `NetworkID`: each network the challenge names has an id of at most 1024, where rippled refuses one, so a blob that carries it is `xrpl/network-id-mismatch`, which `build`'s `complete`, reading the blob as `bound` does, also gives. |
| `hedera` | `mpp/charge/hedera` | MPP's attribution memo as the signed body memo: H is bound through its 7-byte nonce only. |
| `lightning` | `mpp/charge/lightning` | The BOLT11 invoice's description hash `h`, which the seller's node signs. |
| `usdc` | `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway` | The EIP-3009 nonce, or the Gateway burn intent's salt: `usdc`'s derivation over the challenge id. |
| `usdc` | `mpp/charge/usdc/solana`, `mpp/charge/usdc/stacks` | The signed LCP-form Memo instruction (H's LCP string), or the SIP-010 `transfer` memo (H's 32 bytes). The Stacks transaction is signed for the challenge's `chainId`, which `build`'s request names, at that network's version, 0x00 on chain 1 (mainnet) and 0x80 on any other, as a Stacks node requires, else `mpp/stacks-network-mismatch`, which `build`'s `complete` also gives it. |
| `nearintents` | `mpp/charge/nearintents` | The request's `externalId`; the deposit carries nothing. |
| `card`, `stripe` | `mpp/charge/card`, `mpp/charge/stripe`, `mpp/subscription/stripe` | The request's `externalId`, or `methodDetails.metadata.legal_context`, which on a `stripe` charge the seller's server copies into the PaymentIntent it creates at settlement; MPP's Stripe subscription method does not say where the metadata goes. The buyer's card or token signs nothing that carries H. |
| sessions | `mpp/session/evm`, `mpp/session/tempo`, `mpp/session/hedera`, `mpp/session/solana`, `mpp/session/xrpl`, `mpp/session/lightning` | Where the channel opens. See [Channels, sessions and subscriptions](./sessions.md). |
| subscription | `mpp/subscription/tempo` | The key authorization the payer's root key signs, whose witness is H. |

Where only 7 or 8 bytes of what the payer signs depend on H (the nonce of the attribution memo on Tempo and Hedera, the
Stellar muxed id, and the Solana session's 8-byte channel salt), the payment binds H only through those bytes: whoever
assembles the ATR can construct a second ATR that shares them. Those pairings state this in their `pattern.proves`.

`challengeHash` is keccak256 of the challenge id's UTF-8 bytes followed by the realm's, as MPP's EVM charge method
specifies. The `mppx` SDK from 0.13.1 hashes `JSON.stringify([id, realm])` instead, so an
`mpp/charge/evm/authorization` credential and an `mppx` server of those versions derive different nonces.

The challenge's `id` and `realm`, and the client id a Tempo or Hedera payer may add to the attribution memo, are hashed
as UTF-8. A string holding a lone surrogate has no UTF-8 form, so a challenge whose `realm` is not a well-formed string
is `mpp/challenge-malformed` in `pairingsOf`, `place` and `build`, and in every `bound`, and in each `reference` and
`fetchPresented` that reads H from a credential's echoed challenge; the Hedera charge `build` refuses such an `id` too.
The build that takes such a client id refuses it (`mpp/input-malformed` on Tempo, `hedera/option-malformed` on
Hedera).

Each pairing's `build(choice, h)` takes the chosen challenge (`MppChoice`) and returns what the buyer signs; on card and
Stripe, where nothing the buyer signs can carry H, it refuses `mpp/no-signed-place`. Its `bound(credential)` reads H
from the echoed challenge and, where the payer signs a value that carries it, checks that value; where nothing signed
carries H, the card, Stripe and EVM `transaction` and `hash` pairings refuse `mpp/no-signed-place`. `reference` and
`status` read the settlement where the method lands on a chain. In push mode, where the buyer broadcasts and presents
only the transaction's hash or signature, `fetchPresented(credential, reader)` reads the landed transaction first, and
refuses one that failed: `tempo/reverted` on Tempo, which it gives only once the receipt's block is at or below the
reader's `finalized` mark (`tempo/not-final` above that mark, or where it cannot be read), `svm/err` on Solana,
which it gives only once a read at `finalized` holds the transaction with its error (`svm/not-final` when the error is
at `confirmed` and that read does not hold the transaction yet), `stellar/tx-failed` on Stellar, `xrpl/not-success`
on the XRP Ledger, which it reads only once the transaction is in a validated ledger (`xrpl/not-validated` before
that), and
`hedera/not-success` on Hedera. The Hedera session's `fetchPresented` refuses a reverted opening by the same mark:
`hedera/reverted` at or below it, `hedera/not-final` above it or where it cannot be read
([Reading settlement](./sessions.md#reading-settlement)). On the Tempo push charge and the Hedera session, a
transaction that succeeded without exactly one of the logs `bound` reads H from is read by the same mark: above it
`fetchPresented` answers `tempo/not-final` or `hedera/not-final`, and at or below it returns the landed credential,
which `bound` refuses (`tempo/memo-not-bound`, `tempo/ambiguous` or `hedera/channel-log-not-found`). A read
that fails, cannot yet read the landed payment, or reads a revert or error that is not final yet is a read to repeat,
not a refusal of the payment: the seller asks again later. `readToRepeat(code)`, from the package root, is true for each
such code ([Reads to repeat](../concepts/refusals.md#reads-to-repeat)).

`bound`, `reference` and `fetchPresented` start from the echoed challenge's H, require its intent and method to be
the pairing's, and hold the echoed challenge to the pairing's filter: `pairingsOf`'s checks over it as placed, which
must name the pairing (`pairingsOfPlaced`). A challenge those checks refuse gives their code, and one that offers only
other pairings (another credential type, mode or `usdc` profile, or no `expires` where the pairing needs it) is
`mpp/not-this-pairing`, as `advertise` and `build` answer for the same challenge; `build` holds the chosen challenge
to the same filter. `pairingsOf` makes every check `build`, `bound` and `reference` make on the challenge alone: on
Lightning, that the invoice decodes with one `h` field and no `d`, carries the request's payment hash and the currency
of the `network` the challenge names, and expires no earlier than the challenge; on the Solana charges, no `splits` or
`confidential` transfer and the form of the `decimals`, `tokenProgram` and `recentBlockhash` the build writes; on
Permit2 and the Tempo charges, an `amount` above its `splits`, and on Tempo their form; on the Stellar charge, an
`amount` below 2^127, the `i128` of a SEP-41 `transfer`; on the XRP Ledger charge, no `memos`; the XRPL session
recipient's checksum;
the Tempo subscription's period and expiry within the key authorization's uint64; and, on `usdc`'s EVM and Gateway
profiles, a request in its RFC 8785 form. So no pairing binds a payment presented under a challenge `pairingsOf` would
not name for it. Of a challenge the filter takes, each function reads only the request members its own read keys or
derivation use, such as the network or chain, the currency, the recipient, the escrow, the member that carries H, and
`expires` where it is the payment's deadline; on the Lightning charge and session, the read keys name the network of
the invoice's currency. The EVM `transaction` and `hash` charges' `bound` then refuses (`mpp/no-signed-place`), and a
`fetchPresented` given a signed transaction returns it as given.

`mpp/charge/evm/authorization`, `mpp/charge/evm/permit2` and `mpp/charge/usdc/evm` are pull pairings: the payer signs
an authorization that the server executes later. Each gives `authorizer(credential)`, the account whose signature
authorises the pull, and its reference's `authorization` names the nonce the payer signed (the challenge-derived value,
not H), the deadline, the token and the contract that records the nonce's use, for `authorizationUsed` in
`@integraledger/lcp/evm`. `status` on `mpp/charge/evm/permit2` requires the named transaction to carry that nonce as
32 bytes anywhere in its input, and reads that record set at the receipt's block and unset at the block before, as on
x402's Permit2 pairings.

On the EVM, Tempo and `usdc` EVM charges, `status` answers failed, such as `reverted`, `binding-log-not-found`,
`transfer-not-found`, `receive-policy-blocked` or `nonce-not-used`, only once the receipt's block is at or below the
reader's `finalized` mark. Above that mark, where the block can be replaced, or where the mark cannot be read, it
answers pending with the same reason ([Reading settlement](./rails.md#reading-settlement)).

The LCP profile [`mpp/charge`](../../lcp/profiles/mpp-charge.md) states these rules in full.

## Answering the buyer

`problem(code)` maps a refusal code this package returns to the Payment scheme's status codes and problem types, under
`https://paymentauth.org/problems/`:

| Code | Status | Problem type |
|---|---|---|
| `mpp/credential-malformed`, `mpp/request-malformed`, `mpp/opaque-malformed` | 402 | `malformed-credential` |
| `mpp/id-not-ours` | 402 | `invalid-challenge` |
| A read to repeat, a code `readToRepeat` answers true for: each rail's `<rail>/not-found` and `<rail>/unreadable` (such as `tempo/not-found` and `svm/unreadable`), `casper/not-executed`, `ccd/not-finalized`, `xrpl/not-validated`, `evm/not-final`, `hedera/not-final`, `polkadot/not-final`, `stacks/not-final`, `starknet/not-final`, `svm/not-final` and `tempo/not-final` | 500 | `internal-payment-error` |
| A call that cannot read the payment: `tempo/wrong-reader`, `svm/wrong-reader`, `stellar/wrong-reader`, `xrpl/wrong-reader`, `hedera/wrong-reader`, `tempo/read-first`, `svm/read-first`, `stellar/read-first`, `xrpl/read-first`, `hedera/read-first` | 500 | `internal-payment-error` |
| Every other code this package returns | 402 | `verification-failed` |
| A code this package does not return | 500 | `internal-payment-error` |

A read to repeat is a code `readToRepeat` answers true for, such as what a `fetchPresented` or `recover` returns when
its read fails, cannot yet read the landed payment, or reads a revert, an error or a verdict that is not final yet:
the seller asks again later ([Reads to repeat](../concepts/refusals.md#reads-to-repeat)). A call that cannot read the
payment is the seller's own call: a reader that is not
for the network the challenge or reference names, or a ref `recover` cannot read: one that is not an object, one
whose `transaction` is not in its rail's form (a 32-byte hash on Tempo and the Hedera session, a signature, base58 of
64 bytes, on Solana, 64 hex digits on XRPL), or on the Hedera session one that names a `bindingLog` that is not an
object with an address `address` and a 32-byte `value`, an `escrow` that is not an address, or neither or both of them
(`<rail>/wrong-reader`), or `bound` or `reference` on a push
credential before `fetchPresented` has read it (`<rail>/read-first`). The same call gives the same code until the
seller changes it. In both, the payment may already have moved, so the seller sends no fresh challenge the buyer could
pay a second time. Answer a 402 with a fresh challenge and a 500 with none: a challenge goes out only with a 402, and
neither carries `Payment-Receipt`. Any other code is the caller's to answer: `problem` gives it 500
`internal-payment-error`, never a 402.
