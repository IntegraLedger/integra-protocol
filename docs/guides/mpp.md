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
  402 response. A Tempo `subscription` challenge's id is the bare base64url of H. `challengeId(h, index)` writes it and
  `challengeH(id)` reads H back.
- **The challenge's `opaque`** map carries `legalContext`, H's LCP string, and `legalContextUrl`, the link. Where the
  pairing's payment carries H in nothing public, it also carries `legalContextAgreementUrl`.

MPP binds the credential to the challenge it echoes, so whatever the payer signs over the challenge id, or over a
value derived from it, commits to H. Some methods also carry H in a request member the payer signs; `CARRIER` names
that member for each intent and method (for example `externalId` for `solana` charges, and
`methodDetails.invoiceId` for `xrpl`).

`issuedDigest(challenge)` is the digest of what the seller issued: SHA-256 over the RFC 8785 form of the bound
members, with `request` decoded and its `CARRIER` member left out, and `opaque` without the LCP members. The seller
compares the echoed challenge's digest with the one it recorded at issue. A `stellar` charge's `recipient` is the one
carrier that stays in part: the digest keeps its base `G…` account and leaves out only the muxed id, so an echoed
challenge whose `recipient` names another account gives another digest.

## Placing and reading

`place(doc, h, link, option)` is the seller's placement over a list of challenges: the challenge whose bound members
equal `option` gets the id derived from H and an `opaque` holding the seller's own map plus the LCP members.
`read(doc)` is the buyer's reading: the challenges whose `opaque` carries an LCP hash and an `https` link and whose id
derives from that hash. `pairingsOf(challenge)` names the pairings a challenge offers, and `tie(challenges)` is the
ATR's binding slot: every challenge's bound members, as issued.

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
const placed = place([issued], h, `https://atr.seller.example/${h}`, issued);
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
{"legalContext":"lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","legalContextUrl":"https://atr.seller.example/0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}
true 1
```

`parseChallenges(fieldValues)` parses `WWW-Authenticate` field values into challenges, and `problem(code)` gives the
Payment scheme's problem type and HTTP status for a refusal code.

## The MPP pairings

| Method | Pairings | Where H rides in what the payer signs or lands |
|---|---|---|
| `evm` | `mpp/charge/evm/authorization`, `mpp/charge/evm/permit2` | The signed nonce, or the witness's `challengeHash`: keccak256 of the challenge id and realm (`challengeHash`). |
| `evm` | `mpp/charge/evm/transaction`, `mpp/charge/evm/hash` | Nothing signed or landed; H is in the challenge. |
| `tempo` | `mpp/charge/tempo/memo`, `mpp/charge/tempo/push` | MPP's attribution memo on the `transferWithMemo`, whose last 7 bytes are from keccak256 of the challenge id (`attributionMemo`): H is bound through those 7 bytes only. |
| `solana` | `mpp/charge/solana` | The one Memo instruction, holding H's LCP string (the request's `externalId`). |
| `stellar` | `mpp/charge/stellar` | The seller's muxed recipient address, whose 8-byte id is H's first 8 bytes: H is bound through those 8 bytes only. |
| `xrpl` | `mpp/charge/xrpl` | The Payment's `InvoiceID`: H itself (the request's `methodDetails.invoiceId`), in a Payment the payer signs with a single key. |
| `hedera` | `mpp/charge/hedera` | MPP's attribution memo as the signed body memo: H is bound through its 7-byte nonce only. |
| `lightning` | `mpp/charge/lightning` | The BOLT11 invoice's description hash `h`, which the seller's node signs. |
| `usdc` | `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway` | The EIP-3009 nonce, or the Gateway burn intent's salt: `usdc`'s derivation over the challenge id. |
| `usdc` | `mpp/charge/usdc/solana`, `mpp/charge/usdc/stacks` | The signed Memo instruction (H's LCP string), or the SIP-010 `transfer` memo (H's 32 bytes). |
| `nearintents` | `mpp/charge/nearintents` | The request's `externalId`; the deposit carries nothing. |
| `card`, `stripe` | `mpp/charge/card`, `mpp/charge/stripe`, `mpp/subscription/stripe` | The request's `externalId`, or `methodDetails.metadata.legal_context`, which Stripe copies into the PaymentIntent. The buyer's card or token signs nothing that carries H. |
| sessions | `mpp/session/evm`, `mpp/session/tempo`, `mpp/session/hedera`, `mpp/session/solana`, `mpp/session/xrpl`, `mpp/session/lightning` | Where the channel opens. See [Channels, sessions and subscriptions](./sessions.md). |
| subscription | `mpp/subscription/tempo` | The key authorization the payer's root key signs, whose witness is H. |

Where only 7 or 8 bytes of what the payer signs depend on H (the nonce of the attribution memo on Tempo and Hedera, and
the Stellar muxed id), the payment binds H only through those bytes: whoever assembles the ATR can construct a second
ATR that shares them. Those pairings state this in their `pattern.proves`.

Each pairing's `build(choice, h)` takes the chosen challenge (`MppChoice`) and returns what the buyer signs. Its
`bound(credential)` reads H from the echoed challenge and checks that what was signed carries it; `reference` and
`status` read the settlement where the method lands on a chain. In push mode, where the buyer broadcasts and presents
only the transaction's hash or signature, `fetchPresented(credential, reader)` reads the landed transaction first, and
refuses one that failed: `svm/err` on Solana, `stellar/tx-failed` on Stellar, and `xrpl/not-success` on the XRP
Ledger, which it reads only once the transaction is in a validated ledger (`xrpl/not-validated` before that).

`mpp/charge/evm/authorization`, `mpp/charge/evm/permit2` and `mpp/charge/usdc/evm` are pull pairings: the payer signs
an authorization that the server executes later. Each gives `authorizer(credential)`, the account whose signature
authorises the pull, and its reference's `authorization` names the nonce the payer signed (the challenge-derived value,
not H), the deadline, the token and the contract that records the nonce's use, for `authorizationUsed` in
`@integraledger/lcp/evm`. `status` on `mpp/charge/evm/permit2` reads that record at the receipt's block, as on x402's
Permit2 pairings.

The LCP profile [`mpp/charge`](../../lcp/profiles/mpp-charge.md) states these rules in full.
