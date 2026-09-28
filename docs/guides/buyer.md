---
title: Buyer
description: Read the challenge, compare the served bytes with H, build and sign, and finish.
---

# Buyer

The buyer's side of the binding is the [buyer gate](../concepts/buyer-gate.md): compare, then build and sign, then
finish. This guide writes it with this package's pieces on x402 with `x402/exact/eip155/eip3009`. For a ready-made
gate with the fetch bounds and declines already in place, use the buyer packages in
[`integra-agentic-terms`](https://github.com/IntegraLedger/integra-agentic-terms).

## 1. Compare

`read(doc)` gives H, the link, and the options the pairing can pay. Fetch the link with bounds, keep the bytes exactly
as received, and compare their hash with H. On any failure, stop before anything is signed.

The fetch below is the one the shared vectors fix: one `GET`, no redirects, a 10-second deadline over headers and
body, and at most 1 MiB, counted as the body streams. It asks with `redirect: "manual"` and reads a `3xx` answer, or the
`opaqueredirect` answer with status `0` that browsers give, as a failure. Cloudflare Workers refuse
`redirect: "error"` with a `TypeError`, and under `"manual"` a Worker's `fetch` answers a redirect with the `3xx`
itself (measured on Cloudflare's runtime with wrangler 4.141.0).

## 2. Build and sign

`build(choice, h)` returns what the signer signs with H in its place. On `x402/exact/eip155/eip3009` that is EIP-712
typed data for `TransferWithAuthorization` whose `nonce` is H, valid until `now` plus the option's
`maxTimeoutSeconds`. Your signer signs it; this package never holds a key.

Pass the H you compared. Never read H from the document again between the comparison and `build`.

Where the buyer supplies the transaction the payer signs, `build` compares it with the option before anything reaches
the signer. On Stellar (`x402/exact/stellar` and `mpp/charge/stellar`) the choice carries the buyer's simulated Soroban
`transfer` and the `payer` account. `build` refuses a transfer whose token contract is not the option's asset
(`stellar/asset-mismatch`), whose amount is not the option's amount exactly (`stellar/amount-mismatch`: x402's Stellar
scheme requires that argument 2, the amount, *"MUST equal `requirements.amount` exactly"*), or whose `from` is not the
`payer` (`stellar/payer-mismatch`).

## 3. Finish

`complete(signature)` gives the x402 payment, echoing the challenge's `resource` and `extensions` unchanged. Before
sending it, read H back with `bound(payment)` and check that it equals the H you compared: the signer signed what
you asked it to sign.

## The whole flow

The seller's challenge below was advertised for an ATR the buyer can fetch. A stand-in `fetch` serves the bytes, so no
network is used.

```ts
import { hash, hashEquals, isRefusal } from "@integraledger/lcp";
import { exactEip3009, type PaymentRequired } from "@integraledger/lcp/x402";
import type { TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const MAX_ATR_BYTES = 1_048_576;

/** One GET, no redirects, a 10-second deadline, and at most 1 MiB. The bytes as received, or why not. */
async function fetchAtr(link: string, get: typeof fetch = fetch): Promise<Uint8Array | string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await get(link, { redirect: "manual", signal: controller.signal });
    const redirected = response.type === "opaqueredirect" || (response.status >= 300 && response.status <= 399);
    if (redirected || response.status !== 200 || response.body === null) return "atr-unfetchable";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_ATR_BYTES) {
        controller.abort();
        return "atr-too-large";
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return bytes;
  } catch {
    return "atr-unfetchable";
  } finally {
    clearTimeout(timer);
  }
}

// What the seller served: the ATR's bytes at the link, and the 402 challenge that advertises their hash.
const atrBytes = new TextEncoder().encode('{"atrVersion":"1","id":"0f8fad5b-d9cb-469f-a165-70867728950e","terms":"10000 units"}');
const link = "https://atr.seller.example/quote-0001";
const H = await hash(atrBytes);
const challenge: PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://api.seller.example/v1/quote" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    },
  ],
  extensions: {
    legalContext: {
      info: { type: "sha256", value: H, legalContextUrl: link },
      schema: {},
    },
  },
};
const sellerFetch: typeof fetch = async () => new Response(atrBytes);

// 1. Compare.
const offer = exactEip3009.read(challenge);
if (isRefusal(offer)) throw new Error(`decline: ${offer.code}`);
const served = await fetchAtr(offer.link, sellerFetch);
if (typeof served === "string") throw new Error(`decline: ${served}`);
if (!hashEquals(await hash(served), offer.h)) throw new Error("decline: hash-mismatch");
console.log("compared:", offer.h === H);

// 2. Build and sign.
const payer = privateKeyToAccount(generatePrivateKey());
const accepted = offer.offer.options[0]!;
const unsigned = await exactEip3009.build(
  { required: challenge, accepted, from: payer.address, now: Math.floor(Date.now() / 1000) },
  offer.h,
);
if (isRefusal(unsigned)) throw new Error(`decline: ${unsigned.code}`);
console.log("signing:", unsigned.typedData.primaryType, "with nonce H:", unsigned.typedData.message.nonce === offer.h);
const signature = await payer.signTypedData(unsigned.typedData as TypedDataDefinition);

// 3. Finish.
const payment = unsigned.complete(signature);
if (isRefusal(payment)) throw new Error(`decline: ${payment.code}`);
const signed = await exactEip3009.bound(payment);
if (typeof signed !== "string" || !hashEquals(signed, offer.h)) throw new Error("decline: signed-not-bound");
console.log("finished: the payment carries H");
```

```text
compared: true
signing: TransferWithAuthorization with nonce H: true
finished: the payment carries H
```

Send `payment` to the seller in x402's `PAYMENT-SIGNATURE` header, as the x402 specification describes, and keep
`served`: it is your copy of what you agreed to.

## Choosing among options

A challenge may offer several options on several rails. `pairingOf(option)` names the pairing that serves each one,
and each pairing's `read` returns only the options it can pay. Choose an option your accounts can pay, then use that
pairing's `build`. The same H rides in whichever you choose.

## When the challenge carries an agreement URL

Some pairings' payments carry H in nothing public. For those, `read` also returns `agreement`: an `https` URL the
buyer pays first, whose payment carries H publicly. The agreement payment is approved like any other: hand the agent
its amount, token, payee and network, and sign it only once the agent approves. Pay the full payment only after the
agreement's `200` receipt names the same H. See [the agreement URL](../concepts/buyer-gate.md#the-agreement-url).

## Channels and sessions

In a channel, the buyer compares once, at the opening: one ATR covers the whole channel. See
[Channels, sessions and subscriptions](./sessions.md).
