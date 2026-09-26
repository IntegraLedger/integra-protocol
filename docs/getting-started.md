---
title: Getting started
description: Install @integraledger/lcp, assemble an ATR, and carry its hash through one x402 payment.
---

# Getting started

This page takes you from an empty folder to one x402 payment whose signed nonce is the hash of the agreement's record.
You play both parties, the seller and the buyer, in one program. Nothing touches a network: a `Map` stands in for the
seller's storage, and a random key for the buyer's wallet.

Three terms carry the whole page:

- The **Agentic Transaction Record (ATR)** is the agreement's record, a JSON document the seller serves.
- The **ATR hash (H)** is SHA-256 over the ATR's exact bytes.
- **Binding** is how H rides in a pairing's payment: the field its specification defines. Here it is the `nonce` of
  the EIP-3009 authorization the buyer signs.

## Requirements

- Node.js `>=26.10.0`. Node runs the TypeScript files on this page directly, by stripping their types.
- An ESM project. With TypeScript, set `"module"` and `"moduleResolution"` to `"nodenext"` (or `"moduleResolution"`
  to `"bundler"`), so the package's subpath exports resolve.

## Install

```sh
mkdir lcp-start && cd lcp-start
npm init -y
npm pkg set type=module
npm install @integraledger/lcp viem
```

`@integraledger/lcp` is the package; [viem](https://viem.sh) signs for the buyer in step 3. Any EIP-712 signer works
in its place: the package holds no key and signs nothing.

## 1. Assemble an ATR

The seller writes the record. `assemble(id, binding, content)` writes one JSON object in a fixed order: the format
marker, the per-transaction id, the binding slot that ties the record to one payment, and then the parties' content,
byte for byte as given. It returns the bytes and H.

Save this as `assemble.ts` and run `node assemble.ts`:

```ts
import { assemble } from "@integraledger/lcp";

const terms = new TextEncoder().encode('{"text":"One market report for 10000 base units of USDC."}');
const atr = await assemble("0f8fad5b-d9cb-469f-a165-70867728950e", ["x402", { accepts: [] }], [["terms", terms]]);
if ("refused" in atr) throw new Error(atr.code);

console.log(new TextDecoder().decode(atr.bytes));
console.log(atr.atrHash);
```

```text
{"atrVersion":"1","id":"0f8fad5b-d9cb-469f-a165-70867728950e","x402":{"accepts":[]},"terms":{"text":"One market report for 10000 base units of USDC."}}
0x505084d776e5fe9e674b530133325906510c09f6cab2ac5e94b416c0f0917189
```

This page fixes the id so your output matches. For a real transaction, pass `newAtrId()`, a random RFC 9562 UUID:
the fresh id makes every H unique, even for identical terms.

Every function in the package returns its result or a [refusal](./concepts/refusals.md), a value with a code, so
check for `refused` before you use a result.

## 2. Compare the bytes with H

The buyer never trusts a record it has not hashed. It fetches the bytes the seller serves, hashes them, and compares
the result with the H the seller advertised. One changed byte, here the final `.` of the terms turned into `!`, gives
another hash:

```ts
import { assemble, hash, hashEquals } from "@integraledger/lcp";

const terms = new TextEncoder().encode('{"text":"One market report for 10000 base units of USDC."}');
const atr = await assemble("0f8fad5b-d9cb-469f-a165-70867728950e", ["x402", { accepts: [] }], [["terms", terms]]);
if ("refused" in atr) throw new Error(atr.code);

const served = atr.bytes.slice();
console.log("as served:", hashEquals(await hash(served), atr.atrHash));

served[served.length - 4] = 0x21;
console.log("one byte changed:", hashEquals(await hash(served), atr.atrHash));
```

```text
as served: true
one byte changed: false
```

`hashEquals` compares the 32 bytes the two strings decode to, in either case. This comparison is the
[buyer gate](./concepts/buyer-gate.md): if it fails, the buyer signs nothing.

## 3. Carry H through one x402 payment

The whole exchange, on `x402/exact/eip155/eip3009`: USDC on Base Sepolia, paid with an EIP-3009 authorization.
Save this as `pay.ts` and run `node pay.ts`:

```ts
import { assemble, hash, hashEquals, newAtrId } from "@integraledger/lcp";
import {
  exactEip3009,
  requestCommitment,
  tie,
  type PaymentRequired,
  type PaymentRequirements,
} from "@integraledger/lcp/x402";
import type { TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Seller: the x402 challenge for GET /v1/report, with one option.
const option: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};
const challenge: PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://api.seller.example/v1/report" },
  accepts: [option],
};

// Seller, a: assemble the ATR for this request. Its binding slot records the options and the request.
const request = await requestCommitment({ method: "GET", target: "/v1/report", body: new Uint8Array() });
if ("refused" in request) throw new Error(request.code);
const terms = new TextEncoder().encode('{"text":"One market report for 10000 base units of USDC."}');
const atr = await assemble(newAtrId(), tie(challenge.accepts, request), [["terms", terms]]);
if ("refused" in atr) throw new Error(atr.code);

// Seller, b: store the bytes at an https link before the challenge goes out.
const link = `https://atr.seller.example/${atr.atrHash}`;
const storage = new Map([[link, atr.bytes]]);

// Seller, c: advertise H and the link in the challenge's legalContext extension.
const advertised = exactEip3009.advertise(challenge, atr.atrHash, link, option);
if ("refused" in advertised) throw new Error(advertised.code);
const info = advertised.extensions?.["legalContext"]?.info as { value?: string } | undefined;
console.log("1. challenge carries H:", info?.value === atr.atrHash);

// Buyer, d: read H and the link, fetch the bytes, and compare.
const offer = exactEip3009.read(advertised);
if ("refused" in offer) throw new Error(offer.code);
const served = storage.get(offer.link);
if (served === undefined || !hashEquals(await hash(served), offer.h)) throw new Error("decline: hash-mismatch");
console.log("2. the served bytes hash to H");

// Buyer, e: build the authorization with H as its nonce, sign it, and complete the payment.
const payer = privateKeyToAccount(generatePrivateKey());
const unsigned = await exactEip3009.build(
  { required: advertised, accepted: offer.offer.options[0]!, from: payer.address, now: Math.floor(Date.now() / 1000) },
  offer.h,
);
if ("refused" in unsigned) throw new Error(unsigned.code);
const { primaryType, message } = unsigned.typedData;
console.log("3. the buyer signs", primaryType, "with nonce H:", message.nonce === offer.h);
const payment = unsigned.complete(await payer.signTypedData(unsigned.typedData as TypedDataDefinition));
if ("refused" in payment) throw new Error(payment.code);

// Seller, f: read H back from what the buyer signed, and match it to the H it issued.
const bound = await exactEip3009.bound(payment);
if (typeof bound !== "string") throw new Error(bound.code);
console.log("4. the payment is bound to the ATR:", hashEquals(bound, atr.atrHash));
```

```text
1. challenge carries H: true
2. the served bytes hash to H
3. the buyer signs TransferWithAuthorization with nonce H: true
4. the payment is bound to the ATR: true
```

What each step did:

| Step | Side | Call | What it gives |
|---|---|---|---|
| a | seller | `requestCommitment`, `tie`, `assemble` | The ATR's bytes and H, with the challenge's options and the request in the binding slot. |
| b | seller | your storage | The bytes at an `https` link, before any buyer can ask for them. |
| c | seller | `advertise` | The challenge with `extensions.legalContext` set to H and the link. |
| d | buyer | `read`, `hash`, `hashEquals` | H and the link from the challenge, and the check that the served bytes hash to H. |
| e | buyer | `build`, `complete` | EIP-712 typed data whose `nonce` is H, and the x402 payment around the buyer's signature. |
| f | seller | `bound` | H read back from the signed authorization. |

On a live network, the buyer sends `payment` in x402's `PAYMENT-SIGNATURE` header, the seller's facilitator verifies
and settles it, and the token contract's `AuthorizationUsed` event carries H on chain. The
[seller guide](./guides/seller.md) continues from step f to the settlement read.

## Next

- **Building a seller?** Read [Seller](./guides/seller.md), then [x402](./guides/x402.md) or [MPP](./guides/mpp.md).
- **Building a buyer?** Read [Buyer](./guides/buyer.md) and [the buyer gate](./concepts/buyer-gate.md). The buyer
  packages in [`integra-agentic-terms`](https://github.com/IntegraLedger/integra-agentic-terms) give you the gate
  ready-made.
- **Paying on another rail?** [Rails](./guides/rails.md) gives the field H rides in on each chain and network.
- **Want the details?** [The ATR](./concepts/atr.md), [the ATR hash](./concepts/atr-hash.md) and
  [binding](./concepts/binding.md) explain each rule the program above relies on.
