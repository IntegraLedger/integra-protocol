---
title: Channels, sessions and subscriptions
description: One ATR for a whole channel, session or subscription, bound where it opens.
---

# Channels, sessions and subscriptions

Some payments are not one-off. An x402 `batch-settlement` channel takes a deposit and then pays each request with a
voucher. An MPP `session` does the same with a payment channel, and an MPP `subscription` activates once and renews
each period. Paying request by request under a fresh ATR each time would make every voucher an agreement of its own.

These pairings bind **one ATR to the whole channel, session or subscription**. H rides where the channel opens: in its
salt, its memo, the authorization that activates it, the deposit invoice's description hash on Lightning, or the
request's metadata on Stripe. The later payments within it carry no ATR of their own. Another agreement opens another
channel.

```mermaid
sequenceDiagram
  participant B as Buyer
  participant S as Seller
  S-->>B: challenge carrying H and the link
  Note over B: buyer gate: fetch, compare with H, once
  B->>S: the opening, with H in its salt, memo or witness
  Note over S: bound(opening) equals the H it issued, channel.kind is open
  loop each later request
    B->>S: a voucher within the channel
    Note over S: channel.kind is within, channel.ref names the same channel
  end
  B->>S: the close
  Note over S: channel.kind is close
```

The buyer compares the served bytes with H once, at the opening. After that, a payment within the channel is tied to
the ATR through the channel it belongs to.

## The pairings

Ten pairings have a `channel` member. The table says where H rides at the opening, which later payments count as
within the channel, and what `channel.boundWithin` and `channel.until` read.

| Pairing | H at the opening | Within, and the close | `boundWithin` | `until` |
|---|---|---|---|---|
| `x402/batch-settlement/eip155` | The channel configuration's `salt`. The channel id, which the deposit authorization and every voucher sign, commits to it. | A voucher, or a refund with an amount, is within; a full refund is the close. | The `salt` of the payment's channel configuration, once it hashes to the voucher's channel id. | none |
| `x402/batch-settlement/solana` | The opening transaction's seller Memo instruction, H's LCP string (the option's `extra.memo`), beside x402's receiver-authorizer binding memo. | A voucher or a top-up is within; a refund is the close. | Refuses `x402/not-bound-within`. | none |
| `mpp/session/evm` | The channel's `salt`: in the signed `open` call, the EIP-3009 nonce MPP derives over the channel parameters and the salt, or the Permit2 witness. | A voucher or a top-up is within; `close` is the close. | Refuses `mpp/not-bound-within`. | none |
| `mpp/session/tempo` | The `salt` of the signed `open` call to the channel escrow. | A voucher or a top-up is within; `close` is the close. | On the v2 escrow, the salt in the payment's channel descriptor, once the descriptor's channel id is the payment's channel. | none |
| `mpp/session/hedera` | The `salt` of the escrow's `open`. | A voucher, a top-up or a `use` is within; `close` is the close. | Refuses `mpp/not-bound-within`. | none |
| `mpp/session/solana` | The `open` instruction's `salt`: H's first 8 bytes. It binds those 8 bytes only: whoever assembles the ATR can construct a second ATR whose hash shares them. | A voucher, a top-up or a `use` is within; `close` is the close. | H from a `use` credential whose session proof names the opening challenge's id. | none |
| `mpp/session/xrpl` | The `PaymentChannelCreate`'s one memo holding an LCP string, H's, in an opening the payer signs with a single key. | A voucher is within; `close` is the close. | Refuses `mpp/not-bound-within`. | The opening's `CancelAfter`, where it sets one. |
| `mpp/session/lightning` | The deposit invoice's description hash `h`, which the seller's node signs. | A bearer proof or a top-up is within; `close` is the close. | Refuses `mpp/not-bound-within`. | none |
| `mpp/subscription/tempo` | The `witness` of the key authorization the payer's root key signs. | Only the activation, a key authorization, is classified: it is the opening. | Refuses `mpp/not-bound-within`. | The request's `subscriptionExpires`. |
| `mpp/subscription/stripe` | The request's `methodDetails.metadata.legal_context`. | Every payment the seller reports on this pairing is the activation. | Refuses `mpp/not-bound-within`. | none |

An `mpp/session/xrpl` challenge's `amount` is the increment, in drops, charged for its request. `pairingsOf` takes only
an opening challenge, whose `channelId` is absent or empty, and on it `build` signs that `amount` as the first claim's
cumulative total, a big-endian u64. `pairingsOf`, and so `build`, refuses an `amount` that is not a u64 written in
decimal with no sign, point or leading zero, with `mpp/request-malformed`.

This example lists them from the registry:

```ts
import { BINDINGS } from "@integraledger/lcp";

const channels = BINDINGS.filter((b) => "channel" in b).map((b) => b.id);
console.log(channels.length);
console.log(channels.sort().join("\n"));
```

```text
10
mpp/session/evm
mpp/session/hedera
mpp/session/lightning
mpp/session/solana
mpp/session/tempo
mpp/session/xrpl
mpp/subscription/stripe
mpp/subscription/tempo
x402/batch-settlement/eip155
x402/batch-settlement/solana
```

Two x402 pairings carry a request-scoped form of the same idea, with no `channel` member:
`x402/batch-settlement/cloudflare` echoes H in the `legalContext` extension of each request, and `x402/upto/solana`
opens a one-request payment channel whose opening transaction carries H as its memo.

The LCP profiles [`x402/batch-settlement/eip155`](../../lcp/profiles/x402-batch-settlement-eip155.md),
[`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) and
[`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) state the rules for these
bindings.

## The channel members

On top of the members every pairing has, a channel pairing has:

| Member | Side | What it does |
|---|---|---|
| `channel.kind(payment)` | seller | `"open"`, `"within"` or `"close"`, from the payment's own action or type, or a refusal. |
| `channel.ref(payment)` | seller | The channel's key: `{ network, channel }`. The opening and every payment within share it. |
| `channel.boundWithin(payment)` | seller | H from a payment within the channel, where the pairing's payments within carry it; otherwise a refusal. |
| `channel.until(payment)` | seller | The channel's end in Unix seconds, where its opening sets one. |
| `buildWithin(within, h)` | buyer | A later voucher, or the close, for a channel opened under H. It refuses a channel that was not, except on `x402/batch-settlement/solana`, whose configuration does not carry H. |
| `closeRef(challenge, channel)` | seller | The read keys of the channel's close, on the MPP sessions on EVM, Tempo, Hedera, Solana and the XRP Ledger, and on `mpp/subscription/tempo`, where a third argument names the payer's account. |

`buildWithin` exists on the two x402 channels and the MPP sessions on EVM, Tempo, Hedera, Solana and the XRP Ledger.
On MPP it builds a voucher or the close. It does not build a top-up, which is a further deposit, or Solana's operator
`use`.

`mpp/subscription/stripe`'s `channel.ref` takes the payment's receipt as a second argument: the Stripe subscription
it names is the channel.

## One channel, end to end

This program opens an x402 `batch-settlement` channel on an EVM chain, pays one voucher within it, and closes it.
Both sides run in one process: a random key stands in for the buyer's signer and no network is used. Signing uses
[viem](https://viem.sh).

```ts
import { assemble, hashEquals, isRefusal, newAtrId } from "@integraledger/lcp";
import { requestCommitment, tie, type PaymentRequired, type PaymentRequirements } from "@integraledger/lcp/x402";
import { batchEvm, type SigningRequest } from "@integraledger/lcp/x402-batch-settlement";
import type { TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const payer = privateKeyToAccount(generatePrivateKey());
async function sign(requests: readonly SigningRequest[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of requests) {
    if (r.kind !== "eip712") throw new Error(`this signer signs EIP-712 only, not ${r.kind}`);
    out.push(await payer.signTypedData(r.typedData as TypedDataDefinition));
  }
  return out;
}

// Seller: the channel option. 1000 base units of USDC per request, on Base Sepolia.
const option: PaymentRequirements = {
  scheme: "batch-settlement",
  network: "eip155:84532",
  amount: "1000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: {
    name: "USDC",
    version: "2",
    receiverAuthorizer: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    withdrawDelay: 900,
  },
};
const challenge: PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://api.seller.example/v1/stream" },
  accepts: [option],
};

// Seller: one ATR for the whole channel, and H advertised in the challenge.
const request = await requestCommitment({ method: "GET", target: "/v1/stream", body: new Uint8Array() });
if (isRefusal(request)) throw new Error(request.code);
const terms = new TextEncoder().encode('{"text":"1000 base units of USDC per request."}');
const atr = await assemble(newAtrId(), tie(challenge.accepts, request), [["terms", terms]]);
if (isRefusal(atr)) throw new Error(atr.code);
const advertised = batchEvm.advertise(challenge, atr.atrHash, `https://atr.seller.example/${atr.atrHash}`, option);
if (isRefusal(advertised)) throw new Error(advertised.code);

// Buyer: read H, compare the served bytes with it as the buyer guide shows, then open the channel with H as its salt.
const offer = batchEvm.read(advertised);
if (isRefusal(offer)) throw new Error(offer.code);
const accepted = offer.offer.options[0]!;
const unsignedOpening = await batchEvm.build(
  {
    required: advertised,
    accepted,
    from: payer.address,
    payerAuthorizer: payer.address,
    deposit: 100_000n,
    authSalt: `0x${"01".repeat(32)}`,
    now: Math.floor(Date.now() / 1000),
  },
  offer.h,
);
if (isRefusal(unsignedOpening)) throw new Error(unsignedOpening.code);
const kinds = unsignedOpening.requests.map((r) => (r.kind === "eip712" ? r.typedData.primaryType : r.kind));
console.log("the opening signs:", kinds);
const opening = unsignedOpening.complete(await sign(unsignedOpening.requests));
if (isRefusal(opening)) throw new Error(opening.code);

// Seller: the opening is bound to the H it issued, and names the channel.
const h = await batchEvm.bound(opening);
const channel = await batchEvm.channel.ref(opening);
if (isRefusal(channel)) throw new Error(channel.code);
console.log(batchEvm.channel.kind(opening), "bound to H:", typeof h === "string" && hashEquals(h, atr.atrHash));

// Buyer: a later voucher in the same channel, for a cumulative 2000 base units.
const channelConfig = opening.payload["channelConfig"]!;
const unsignedVoucher = await batchEvm.buildWithin(
  { required: advertised, accepted, channelConfig, maxClaimableAmount: 2000n },
  offer.h,
);
if (isRefusal(unsignedVoucher)) throw new Error(unsignedVoucher.code);
const voucher = unsignedVoucher.complete(await sign(unsignedVoucher.requests));
if (isRefusal(voucher)) throw new Error(voucher.code);

// Seller: the voucher is within the same channel, and its configuration still carries H.
const sameChannel = await batchEvm.channel.ref(voucher);
const within = await batchEvm.channel.boundWithin(voucher);
const same = !isRefusal(sameChannel) && sameChannel.channel === channel.channel;
console.log(batchEvm.channel.kind(voucher), "same channel:", same);
console.log("within bound to H:", typeof within === "string" && hashEquals(within, atr.atrHash));
const notAnOpening = await batchEvm.bound(voucher);
console.log("bound(voucher):", typeof notAnOpening === "string" ? notAnOpening : notAnOpening.code);

// Buyer: the close, a full refund of what is left.
const unsignedClose = await batchEvm.buildWithin(
  { required: advertised, accepted, channelConfig, maxClaimableAmount: 2000n, refund: {} },
  offer.h,
);
if (isRefusal(unsignedClose)) throw new Error(unsignedClose.code);
const close = unsignedClose.complete(await sign(unsignedClose.requests));
if (isRefusal(close)) throw new Error(close.code);
console.log(batchEvm.channel.kind(close));
```

```text
the opening signs: [ 'ReceiveWithAuthorization', 'Voucher' ]
open bound to H: true
within same channel: true
within bound to H: true
bound(voucher): x402/not-an-opening
close
```

Keep the opening exactly as the buyer signed it: every payment within the channel is built from its channel
configuration, and `buildWithin` refuses a configuration whose salt is not H (`x402/channel-id-mismatch`).

## What each side keeps

**The seller** refuses an opening whose H it did not issue for that request, or has already seen claimed. After that,
it matches each later payment to an open channel by `channel.ref`, and so to that channel's ATR. What a voucher is
worth, and when to settle, are the seller's to decide under the scheme. The channel members classify a payment and
name its channel; none of them reads a voucher's amount.

**The buyer** keeps the ATR's bytes it compared at the opening, and the opening itself. On MPP, a session challenge
that names a `channelId` resumes a channel (`sessionResume` reads it on the MPP sessions on EVM, Tempo, Hedera, Solana
and the XRP Ledger): the buyer pays it with a voucher only for a channel it opened for an ATR it compared.

## What the record says

Each channel pairing's `pattern.proves` states what the opening shows, and never that later requests or billing periods
were paid under this ATR, which the record never reads. Where each voucher signs a value that commits to H, such as a
`channelId` over the salt, it says so in one sentence, such as *"Each voucher in this channel signs a commitment to
this ATR's hash."* The EVM, Tempo and Hedera sessions and the EVM batch-settlement channel say so; on the XRP Ledger
session, `pattern.proves` says that each voucher signs the channel id and an amount, not H. The
[pairings reference](../reference/pairings.md#what-each-binding-proves) quotes each one.

## Reading settlement

`reference(opening)` and `status(ref, reader)` read the opening's settlement, as on any pairing. On the MPP sessions
on EVM, Tempo, Hedera, Solana and the XRP Ledger, and on `mpp/subscription/tempo`, `closeRef(challenge, channel)` gives
the read keys of the close from the issued challenge and the channel, and `status` reads the close through the same
reader. On `mpp/session/evm`, a transaction
that is not a call closing that channel reads as pending, with the reason `not-a-close`. On the EVM, Tempo and Hedera
sessions, the Tempo subscription and `x402/batch-settlement/eip155`, an opening, a close or a transfer under the
subscription's access key reads as failed only once the
receipt's block is at or below the reader's `finalized` mark; above that mark, where the block can be replaced,
or where the mark cannot be read, it reads as pending with the same reason
([Reading settlement](./rails.md#reading-settlement)). On `mpp/session/hedera`, `fetchPresented`, which reads the
opening's receipt before `bound`, refuses a revert by the same mark: an opening that reverted is `hedera/reverted` only
once its block is at or below the reader's `finalized` mark, and `hedera/not-final`, a read to repeat, above that mark
or where it cannot be read. On `mpp/subscription/tempo`,
the close is the account keychain's `KeyRevoked` naming the payer's account and the access key, so `closeRef(challenge,
channel, account)` takes the account the activation registered the key for, which `keySearch` reads from the
activation's receipt as `accessKey.account`; without it, `closeRef` refuses `mpp/input-malformed`. Another account's
revocation of the same key is not this close. On `mpp/session/evm`, `mpp/session/tempo` and `mpp/subscription/tempo`, a
reference that names none of the keys its own pairing's `reference`, `closeRef` and `keySearch` write for the opening
or the close (`opens`, `closes` or a binding log under `AuthorizationUsed` on the EVM session; `opened` or a binding
log under `ChannelClosed` on the Tempo session; `revokes`, an `accessKey` with `account` or a binding log under
`KeyAuthorizationWitness` on the subscription), or that names a key another of the three writes, reads as pending, with
the reason `unreadable`, and nothing is read: no read could check H or the close.

The `mpp/subscription/tempo` activation is read by what the payer signed in the key authorization: its `reference`
names the `Transfer` of the authorization's one limit token, which is also its one allowed-call target, to its one
recipient across its `transfer` and `transferWithMemo` rules, identified by the recipient alone, and `accessKey`
carries the same token and recipient for `keySearch`. Tempo's subscription draft lets the key make only those calls and
forbids `approve`, so no other rule names the recipient: an `approve` rule's spender is not one. The request's amount,
currency and recipient are not read. An authorization that names more than one token or recipient, or none, is refused
`tempo/key-authorization-malformed`. A `transfer` or `transferWithMemo` rule with no recipients allows any recipient,
so the authorization does not name exactly one, and it is refused the same way.

On `x402/batch-settlement/eip155`, the opening's `status` counts the payer's deposit only from the call that deposited
into this channel. The channel contract collects a deposit and then emits `Deposited` for the channel, so the payer's
transfer must be among the logs between the contract's previous `Deposited` and the channel's own. A gift into the
channel beside the payer's deposit into another channel, or the payer's short deposit into it beside a deposit
elsewhere, reads as failed, with the reason `transfer-not-found`.

An `mpp/session/evm` opening of type `hash` names a transaction the payer broadcast before the claim; one of type
`permit2` is sent by the seller's server, which names its transaction to `status`. Both references carry `opens`: the
escrow, the channel, H and the chain; a reference whose `opens` is not of that form reads as pending, with the reason
`unreadable`, and nothing is read. Otherwise `status` reads the transaction itself, through the reader's
`transaction` (`eth_getTransactionByHash`, which gives the sender, the recipient and the calldata), and settles only
when it holds the escrow's open call for the channel, with H as its salt:

- the escrow's `open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)` in its
  first 164 bytes of calldata, sent to the escrow, whose sender is the payer; or
- the escrow's `openWithPermit2(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner,
  address from, uint256 nonce, uint256 deadline, bytes signature)`, sent to the escrow, whose `from` is the payer.

In each, the payer, payee, token and authorized signer give the channel id, and the payer is read from the chain, not
from the credential's `source`. `reference` computed the channel id from the `source` on a `hash` opening and from the
authorization's `from` on a `permit2` one, so an open call whose payer is any other account opens another channel.
Calldata past the call's arguments, such as a data suffix a wallet appends, is not read. An open call sent to the
escrow that opens another channel reads as failed, with the
reason `open-call-not-found`, on a `hash` opening, whose named transaction is the payment, once the transaction's block
is at or below the `finalized` mark; above it, where the block can still be replaced, and on a `permit2` opening, which
can land until its deadline, it reads as pending. Any other transaction, such as a plain token transfer to the
escrow, reads as pending, with the reason `open-call-not-found`, never as failed. A transaction sent through an ERC-4337
EntryPoint reads as pending, with the reason `open-call-not-found`: the account's calldata does not show which contract
the account called. The deposit is not read. Calldata longer than 131,072 bytes, go-ethereum's transaction pool
maximum, reads as pending, with the reason `unreadable`.

## Next

- [x402](./x402.md) and [MPP](./mpp.md): the surfaces these channels run on.
- [Buyer](./buyer.md): the comparison the buyer makes before the opening.
