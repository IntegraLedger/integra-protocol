---
title: Refusals
description: Every refusal is a value with a code.
---

# Refusals

Failures are values. A function in this package whose type carries a refusal returns its result, or a **refusal**: a
plain object that names what is wrong with its input. A `status` answers a pending state instead, and the writers that
only encode a value you supply throw ([What throws](#what-throws)).

```ts no-check
type Refusal = { refused: true; code: string };
```

A code is `<namespace>/<reason>`, such as `core/slot-name`, `x402/link-not-https` or `svm/memo-not-lcp`. The namespace
is the entry point or rail that refused. The same reason means the same thing on every surface: `link-not-https` is
always a link that is not `https` (any such link given to `advertise` or `place`, and a link of another scheme that a
`read` finds, except card's, ACK's and AP2's, which give `legal-context-malformed` to every link that is not `https`),
and `legal-context-malformed` is always a hash, link or agreement URL that does not read.

The [refusal code reference](../reference/refusals.md) lists every code with its meaning.

## Checking a result

`isRefusal(result)` is how a caller tells a refusal from a result: it is true only for a refusal made by the same loaded
copy of this package, and false for every result, the hashes `bound` returns included. A refusal from a second copy of
the package reads as a result, so load one copy. Test it before using a result:

```ts
import { assemble, isRefusal, newAtrId } from "@integraledger/lcp";

const result = await assemble(newAtrId(), ["bind", {}], [["id", new TextEncoder().encode("{}")]]);
if (isRefusal(result)) {
  console.log(result.code);
} else {
  console.log(result.atrHash);
}
```

```text
core/slot-reserved
```

## Where a refusal comes from

Only the package makes refusals. `isRefusal`, which the package's own entry points use as well, recognises a refusal by
where it was made, not by its members, so a value you pass in is never returned to you as a refusal, whatever it holds.
A presented payment or credential that the package would otherwise hand back to you unchanged is refused as malformed
when it carries a `refused` member: `mpp/credential-malformed` for an MPP credential, `x402/payload-malformed` for an
x402 EIP-3009 payment and `casper/payload-malformed` for a Casper payment. `unplaced`, which gives back the option or
challenge you pass or a copy of it without the pairing's carrier, and each placement, which gives back a copy of the
seller's document with the carrier placed (`advertise` and `advertiseBeforeCarrier` on the x402, MPP, ACP, AP2 and UCP
pairings, and MPP's and A2A's `place`), refuse a value that carries a `refused` member before they remove or place
anything: with `x402/option-malformed` on x402, with `mpp/challenge-malformed` on MPP (for a list of challenges, when
any of them carries one), and elsewhere with the malformed code of what they are given: the pairing's
`option-malformed` code for an option given to `unplaced` on the ACK, ACP, AP2, card and UCP pairings, and
`acp/session-malformed`, `ap2/jws-malformed`, `ucp/checkout-malformed` or `a2a/legal-context-malformed` for the session,
checkout payload, checkout or task a placement is given.
Every other entry point reads a presented value only for the members its pairing defines, and returns either a value
it built or its own refusal.

## What throws

A writer encodes a value you supply, and its type carries no refusal: it throws a `TypeError` on an argument outside
its type. In the core, `hash` rejects with one when its argument is not a `Uint8Array`: a `Buffer` or a `Uint8Array`
from another realm is hashed, and a string, an array, an `ArrayBuffer`, another typed array or a Proxy is not.
`toLcpString`, `toLegalContext` and `toRawBytes` throw when the hash is not 32 bytes, and `toLegalContext` also when
the link is not an `https` URL. Their `from…` counterparts return `null` instead of throwing.

The rails' writers throw the same way (`x402InvoiceId` and `svmDigest`, which are asynchronous, reject):

- on a hash that is not 32 bytes: `ccdMemo` and `pltMemo`, `muxedId` and `muxedFor` (also on a base that is not a `G…`
  account, and on any argument when `@stellar/stellar-sdk` is not installed), `mppInvoiceId` and `x402InvoiceId`, and
  `sessionSalt`;
- on a Hedera value outside its type: `txIdText` and `txIdMirror` (an id that is not an account `shard.realm.num`, a
  non-negative bigint `seconds` and `nanos` from 0 to 999,999,999), `hederaChannelId` (an address that is not `0x` and
  40 hex digits, a salt that is not a 32-byte hash, a chain id other than 295 and 296) and `hederaVoucher` (the same
  for the channel, and a `cumulative` that is not a bigint that fits a uint128);
- on a field of the wrong type: `encodeTronRaw`, `encodeProfileCall` (a call `decodeProfileCall` would not give back),
  `openInstructionData` and `channelVoucherMessage`, and `sessionProof` on a null or missing argument or a `channelId`,
  `payer` or `challengeId` that is not a well-formed string, so that it never returns a message you did not write;
- on bytes that are not a `Uint8Array`: `extrinsicHash`, `stacksTxid`, and `svmDigest` on a transaction whose message
  is not one;
- on a network other than `starknet:SN_MAIN` and `starknet:SN_SEPOLIA`: `chainIdFelt`.

Every other function answers a caller's input with a value, never a throw: a refusal, a pending state, `false` or
`{ complete: false }` from a read, or, for `unplaced`, its argument itself when that is not an option.

## Readers

The functions that read a rail (`status`, `recover`, `fetchPresented`) take a reader you supply, so the network calls
are yours. A reader that fails or times out is never a failed payment: a rejected read of the transaction makes `status`
return a pending state with the reason `unreadable`, and a later read can settle it; a rejected read of a finality mark
counts as that mark not reached. A reader that declares a network other than the one the reference names is never a
failed payment either, and nothing is read through it: `status` returns pending `unreadable` on every read, so no later
read settles it, and `recover` refuses `<namespace>/wrong-reader`. A ref or reader that is not an object is read the
same way, with nothing read: `status` is pending `unreadable`, and `recover` refuses with the code it gives a reader for
another network, except on `mpp/charge/usdc/stacks`, which refuses `stacks/unreadable`. Check `reader.network` against
the reference's network before you poll, and give every polling loop a deadline of its own.

## Next

- [Refusal codes](../reference/refusals.md): every code, with its meaning.
