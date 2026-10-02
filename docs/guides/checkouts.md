---
title: Agentic checkouts
description: The ATR hash on ACP, UCP, AP2 and ACK checkouts, on card networks, and in A2A task metadata.
---

# Agentic checkouts

Not every agent pays through a `402` challenge. Many buy through a checkout: the seller opens a checkout or a payment
request, the buyer's agent completes it, and a payment service provider, a card network or a credential provider
moves the money. This package binds H into each of these checkouts in the field its protocol provides, and says so
plainly where the protocol gives the buyer nothing to sign.

The members are the ones [every pairing has](../concepts/pairings.md#the-members). What differs is the document the
seller advertises into and what the buyer presents:

| Protocol | Entry point | Pairings | Where H rides | Buyer signs H |
|---|---|---|---|---|
| ACP | `@integraledger/lcp/acp` | `acp/checkout/delegated`, `acp/checkout/undelegated` | The checkout session's `id`, and the delegate-payment allowance's `checkout_session_id` where the handler requires one. | no |
| UCP | `@integraledger/lcp/ucp` | `ucp/checkout/ap2-mandate`, `ucp/checkout/unsigned`, `ucp/booking/ap2-mandate`, `ucp/booking/unsigned` | A `legal_context` entry in the checkout's `links[]`, before the business signs the checkout. | with an AP2 mandate |
| AP2 | `@integraledger/lcp/ap2` | `ap2/checkout-mandate` | The `legalContext` member of the merchant-signed `checkout_jwt`, which the buyer's Checkout Mandate commits to. | yes |
| ACK | `@integraledger/lcp/ack` | `ack/payment-request` | The `id` of the seller-signed Payment Request, as H's LCP string. | no |
| Card networks | `@integraledger/lcp/card` | `card/visa-tap`, `card/mastercard-vi/immediate`, `card/mastercard-vi/autonomous`, `card/seller-reference` | A covered `lcp-hash` field of the agent's message signature, the `checkout_jwt` a Verifiable Intent mandate signs, or the seller's processor reference. | Visa TAP and Verifiable Intent |
| A2A | `@integraledger/lcp/a2a` | none | The Task's `metadata`, under the extension's URI. Delivery only. | no |

The "Buyer signs H" column is each pairing's `pattern.buyerSigns`. The
[pairings reference](../reference/pairings.md#what-each-binding-proves) gives the sentence each pairing's record
states about what a payment through it proves, including which signatures this package verifies and which it leaves
to the network or the provider.

Where the buyer's approval does not sign H, the seller may advertise an
[agreement URL](../concepts/buyer-gate.md#the-agreement-url) beside the link. Every checkout pairing's `advertise`
takes it as its last argument and writes it where the protocol keeps the link, and its `read` returns it as
`agreement`.

## ACP

In the [Agentic Commerce Protocol](https://www.agenticcommerce.dev), the seller creates a checkout session and the
buyer's agent completes it with a payment handler. This package makes H the session's `id`, and puts the link beside
it in the session's `metadata.legal_context`, in snake case:

```json no-check
{
  "id": "0x1be27e75ea3728b55834ec54ff6709669427b11c9ba47a6d9f182b0be46513be",
  "metadata": {
    "legal_context": {
      "type": "sha256",
      "value": "0x1be27e75ea3728b55834ec54ff6709669427b11c9ba47a6d9f182b0be46513be",
      "legal_context_url": "https://atr.seller.example/0x1be27e75ea3728b55834ec54ff6709669427b11c9ba47a6d9f182b0be46513be"
    }
  }
}
```

The ATR's binding slot, `tie(options)`, holds one option per kind of payment handler the session offers, each ACP's
own `{ "requires_delegate_payment": boolean }`, and nothing from the checkout. The two pairings differ in that flag:

- **`acp/checkout/delegated`**: the handler requires `delegate_payment`. `build` returns the allowance the agent's
  `delegate_payment` request carries: ACP's six members, with `reason` `"one_time"` and `checkout_session_id` set to
  H. The agent signs its request; `complete(request)` returns the request only when its allowance is exactly the one
  built, and refuses `acp/allowance-changed` otherwise. `bound` reads `checkout_session_id` back. It verifies no
  signature.
- **`acp/checkout/undelegated`**: nothing the buyer signs names the session. `build` refuses `acp/nothing-to-sign` and
  `bound` refuses `acp/not-buyer-signed`.

```ts
import { assemble, hash, hashEquals, isRefusal, newAtrId } from "@integraledger/lcp";
import { delegated, tie, type HandlerOption, type Session } from "@integraledger/lcp/acp";

// Seller: the session offers a handler that requires delegate_payment.
const handler: HandlerOption = { requires_delegate_payment: true };
const terms = new TextEncoder().encode('{"line_items":[{"id":"li_1","quantity":1}],"total":19900}');
const atr = await assemble(newAtrId(), tie([handler]), [["order", terms]]);
if (isRefusal(atr)) throw new Error(atr.code);
const link = `https://atr.seller.example/${atr.atrHash}`;
const opened: Session = { currency: "usd", metadata: { order_ref: "A-100" } };
const session = delegated.advertise(opened, atr.atrHash, link, handler);
if (isRefusal(session)) throw new Error(String(session.code));
console.log("session id is H:", session.id === atr.atrHash, Object.keys(session.metadata ?? {}));

// Buyer: read H and the link, fetch and compare, then build the allowance.
const offer = delegated.read(session);
if (isRefusal(offer)) throw new Error(offer.code);
if (!hashEquals(await hash(atr.bytes), offer.h)) throw new Error("decline: hash-mismatch");
const unsigned = await delegated.build(
  { session, max_amount: 19900, currency: "usd", merchant_id: "acme", expires_at: "2026-10-01T00:00:00Z" },
  offer.h,
);
if (isRefusal(unsigned)) throw new Error(unsigned.code);
const { checkout_session_id, ...rest } = unsigned.allowance;
console.log("checkout_session_id is H:", checkout_session_id === offer.h, rest);

// Buyer: the agent's own stack builds and signs its delegate_payment request around the allowance.
// complete returns the request only when the allowance in it is the one built.
const request = unsigned.complete({ allowance: unsigned.allowance, payment_method: { type: "card" } });
if (isRefusal(request)) throw new Error(String(request.code));
const changed = unsigned.complete({ allowance: { ...unsigned.allowance, max_amount: 99900 } });
console.log(isRefusal(changed) ? changed.code : "accepted");

// Seller: H back out of what the agent signed.
const bound = await delegated.bound(request);
console.log("bound to H:", typeof bound === "string" && hashEquals(bound, atr.atrHash));
```

```text
session id is H: true [ 'order_ref', 'legal_context' ]
checkout_session_id is H: true {
  reason: 'one_time',
  max_amount: 19900,
  currency: 'usd',
  merchant_id: 'acme',
  expires_at: '2026-10-01T00:00:00Z'
}
acp/allowance-changed
bound to H: true
```

`advertise` keeps every other member and metadata key, sets the session `id` only when it is absent or already H
(`acp/id-conflict` otherwise), and refuses a session larger than 1 MiB as JSON. `read` takes H from `id` alone and
refuses a `metadata.legal_context` whose value is another hash (`acp/legal-context-conflict`). The LCP profile
[`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) states the rules.

## UCP

In the [Universal Commerce Protocol](https://ucp.dev), the business returns a checkout, and, under UCP's AP2 Mandates
extension, signs it (`ap2.merchant_authorization`). This package appends one entry to the checkout's `links[]` before
the business signs it:

```json no-check
{ "type": "legal_context", "url": "https://atr.seller.example/0x…", "title": "lcp:sha256:0x…" }
```

and, with an agreement URL, a second entry of type `legal_context_agreement`. The option names the checkout or the
booking by its own `id` (`{ "checkout": "…" }` or `{ "booking": "…" }`), and `tie(options)` records those ids.
`advertise` refuses a checkout the business has already signed (`ucp/already-signed`) and one whose `id` is not the
option's (`ucp/option-not-this-checkout`).

| Pairing | Buyer side | `bound` |
|---|---|---|
| `ucp/checkout/ap2-mandate`, `ucp/booking/ap2-mandate` | `read` requires the business's `ap2.merchant_authorization` (`ucp/ap2-not-active` otherwise). `build` returns the checkout unchanged for the buyer's mandate issuer, once its link carries H, and `complete(checkout_mandate)` gives what the buyer presents. | Checks AP2's `checkout_hash` against the checkout inside the buyer's mandate, then reads H from that checkout's `legal_context` link. It verifies no signature. |
| `ucp/checkout/unsigned`, `ucp/booking/unsigned` | `read` gives H and the link. `build` refuses `ucp/nothing-to-sign`: UCP without the AP2 Mandates extension defines no buyer signature. | Refuses `ucp/not-buyer-signed`. |

`legalContextLink(checkout)` reads the one `legal_context` entry of any checkout: two such entries are
`ucp/legal-context-conflict`. The LCP profile
[`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) states the rules.

```ts
import { hash, isRefusal } from "@integraledger/lcp";
import { legalContextLink, unsigned, type Checkout } from "@integraledger/lcp/ucp";

const h = await hash(new TextEncoder().encode("the ATR's bytes"));
const link = `https://atr.seller.example/${h}`;
const checkout: Checkout = {
  id: "chk_123",
  status: "ready_for_complete",
  links: [{ type: "terms_of_service", url: "https://seller.example/tos" }],
};

const placed = unsigned.advertise(checkout, h, link, { checkout: "chk_123" });
if (isRefusal(placed)) throw new Error(String(placed.code));
console.log(placed.links);

const found = legalContextLink(placed);
console.log(isRefusal(found) ? found.code : found.h === h);
const wrong = unsigned.advertise(checkout, h, link, { checkout: "chk_999" });
console.log(isRefusal(wrong) ? wrong.code : "placed");
console.log(isRefusal(await unsigned.build({ checkout: placed }, h)));
```

```text
[
  { type: 'terms_of_service', url: 'https://seller.example/tos' },
  {
    type: 'legal_context',
    url: 'https://atr.seller.example/0x3283f4fc90a2f6d2782b0345c3b274acbe0218ec84ce2d8c3a1fdbe6d1cff263',
    title: 'lcp:sha256:0x3283f4fc90a2f6d2782b0345c3b274acbe0218ec84ce2d8c3a1fdbe6d1cff263'
  }
]
true
ucp/option-not-this-checkout
true
```

A UCP checkout paid in x402 goes through the payment handler `com.integraledger.lcp.x402`. Its `config` in the
checkout is the x402 `PaymentRequired` that carries H, its credential is the buyer's signed x402 payment, and the
payment carries H where the option's x402 pairing places it. The checkout's ATR takes that pairing's binding slot, whose
request is the checkout's completion, so the ATR names the checkout. The LCP profile
[`ucp/payment-handler/x402`](../../lcp/profiles/ucp-payment-handler-x402.md) is the handler's specification, and
[`ucp-payment-handler-x402.schema.json`](../../lcp/profiles/ucp-payment-handler-x402.schema.json) its schema. Their
addresses are `https://integraledger.com/lcp/ucp/x402/2026-10-02` and
`https://integraledger.com/lcp/ucp/x402/2026-10-02/schema.json`.

What the buyer gives that UCP has no field for travels in the checkout extension `com.integraledger.lcp.with`, which is
written into the ATR, and in a response the extension also carries the purchase. The LCP profile
[`ucp/checkout/lcp-with`](../../lcp/profiles/ucp-checkout-lcp-with.md) is its specification, at
`https://integraledger.com/lcp/ucp/with/2026-10-02`, with its schema
[`ucp-checkout-lcp-with.schema.json`](../../lcp/profiles/ucp-checkout-lcp-with.schema.json).

## AP2

In [AP2](https://ap2-protocol.org), the merchant signs a `checkout_jwt` and the buyer's closed Checkout Mandate
commits to it through `checkout_hash`, the SHA-256 of that JWT. This package puts H in the JWT's payload:

- **Seller.** `advertise(payload, h, link, { checkout: id })` appends a `legalContext` member,
  `{"type":"sha256","value":H,"legalContextUrl":link}`, to the checkout payload whose `id` is the option's. The
  seller's own stack signs the result as its `checkout_jwt`.
- **Buyer.** `read(checkoutJwt)` decodes the JWT's payload and returns H, the link and the checkout. `build(offer, h)`
  returns the Checkout Mandate's required claims: `vct` `"mandate.checkout.1"`, the `checkout_jwt`, and
  `checkout_hash`, the unpadded base64url of SHA-256 over the JWT. The buyer's mandate signer issues the mandate as
  an SD-JWT, and `complete(checkout_mandate)` gives what the buyer presents: the mandate and the JWT.
- **Seller, on payment.** `bound(presented)` finds the one closed Checkout Mandate in the SD-JWT, checks that its
  `checkout_hash` is the hash of the presented `checkout_jwt` (`ap2/checkout-not-latest` otherwise), and reads H from
  that JWT's payload. It verifies no signature.

`jwsPayload`, `readMandate` and `checkoutBinding` expose those steps one by one. The LCP profile
[`ap2/checkout-mandate`](../../lcp/profiles/ap2-checkout-mandate.md) states the rules.

```ts
import { hash, isRefusal } from "@integraledger/lcp";
import { checkoutMandate } from "@integraledger/lcp/ap2";

const h = await hash(new TextEncoder().encode("the ATR's bytes"));
const checkout = { id: "chk_42", total: { currency: "USD", value: "19.90" } };
const payload = checkoutMandate.advertise(checkout, h, `https://atr.seller.example/${h}`, { checkout: "chk_42" });
if (isRefusal(payload)) throw new Error(String(payload.code));
console.log(Object.keys(payload));

// The seller's stack signs the payload. A placeholder signature stands in: the buyer's side verifies none.
const segment = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
const signature = Buffer.from("signature").toString("base64url");
const checkoutJwt = `${segment({ alg: "ES256", typ: "JWT" })}.${segment(payload)}.${signature}`;

const offer = checkoutMandate.read(checkoutJwt);
if (isRefusal(offer)) throw new Error(offer.code);
const unsigned = await checkoutMandate.build(offer.offer, offer.h);
if (isRefusal(unsigned)) throw new Error(unsigned.code);
console.log(unsigned.content.vct, unsigned.content.checkout_hash.length);
```

```text
[ 'id', 'total', 'legalContext' ]
mandate.checkout.1 43
```

## ACK

In the payment flow of the [Agent Commerce Kit (ACK)](https://www.agentcommercekit.com), the seller answers with a
`402` whose body carries a signed Payment Request token, and a receipt issued after settlement embeds that token. This package makes H the
Payment Request's `id`, in LCP string form, and puts the link beside the request in the `402` body:

- **Seller.** `advertise({}, h, link, option)` returns the values the seller's stack places: `paymentRequestId`,
  `lcp:sha256:0x…`, for the token it signs, and `legalContext`, `{type, value, legalContextUrl}`, for the body beside
  it. `tie(options)` records the Payment Request's options exactly as issued.
- **Buyer.** `read(body)` takes H from the signed token's `id`, which must equal the body's `legalContext`
  (`ack/legal-context-conflict` otherwise), and returns the token's payment options. The body's unsigned
  `paymentRequest` copy is never read. The token's signature is not verified here.
- **After settlement.** `fromReceipt(credentialSubject)` reads H from the Payment Request token a receipt embeds. It
  verifies nothing: call it on a receipt you have verified.

ACK defines no payer signature, so there is no place for H in what the buyer signs. `build` and `bound` refuse
`ack/no-signed-place`. The LCP profile [`ack/payment-request`](../../lcp/profiles/ack-payment-request.md) states the
rules.

## Card networks

The `card` entry point covers three ways to pay a card checkout. The option is the seller's own
`{ scheme, checkout }`, where `scheme` is `"visa-tap"`, `"mastercard-vi"` or `"seller-reference"` and `checkout` is
the seller's checkout id; `pairingsOf(option)` names the pairings that pay it. `advertise` gives the same values for
every card pairing: the `legalContext` the seller shows before payment, and `reference`, H's LCP string, for the
seller to place in its processor reference.

- **[Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol).** The agent sends
  H in an `lcp-hash` field and lists that field among the covered components of every `agent-payer-auth` message
  signature it sends (RFC 9421). `build` returns the field for the agent's signer to add:
  `{ field: "lcp-hash", value: H, component: "lcp-hash" }`. `bound` reads the one `lcp-hash` line when every
  `agent-payer-auth` signature in the request lists `"lcp-hash"` without parameters, so whichever payer signature the
  seller's TAP recognition verifies covers H. It verifies no signature, key, window or nonce. The LCP profile
  [`card/visa-tap`](../../lcp/profiles/card-visa-tap.md) states the rules.
- **[Mastercard Verifiable Intent](https://github.com/agent-intent/verifiable-intent).** H rides in the merchant's
  `checkout_jwt` as its `legalContext`, and a mandate signs that JWT's SHA-256 as `checkout_hash`. `build` returns the
  checkout mandate to sign and the payment mandate's `transactionId`, both that digest.
  `card/mastercard-vi/immediate` reads H from the checkout mandate the user's L2 mandate references, and checks the
  `checkout_hash` and any disclosed `transaction_id`; it verifies no signature. `card/mastercard-vi/autonomous` reads
  H from the agent's L3b checkout mandate, and verifies the ES256 signatures of L2 and L3b and their `sd_hash` links,
  but not the L1 issuer's signature. The LCP profile [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md)
  states the rules.
- **`card/seller-reference`.** A plain card checkout: nothing the buyer signs carries H. The seller shows H and the
  link before payment and places `reference` in its processor reference. `build` and `bound` refuse
  `card/no-signed-place`.

```ts
import { hash, isRefusal } from "@integraledger/lcp";
import { pairingsOf, visaTap, type CardOption } from "@integraledger/lcp/card";

const h = await hash(new TextEncoder().encode("the ATR's bytes"));
const option: CardOption = { scheme: "visa-tap", checkout: "order-7731" };
console.log(pairingsOf(option), pairingsOf({ scheme: "mastercard-vi", checkout: "order-7731" }));

const shown = visaTap.advertise({}, h, `https://atr.seller.example/${h}`, option);
if (isRefusal(shown)) throw new Error(shown.code);
console.log(shown.reference === `lcp:sha256:${h}`);

const field = await visaTap.build(shown, h);
if (isRefusal(field)) throw new Error(field.code);
console.log(field.field, field.component, field.value === h);
```

```text
[ 'card/visa-tap' ] [ 'card/mastercard-vi/immediate', 'card/mastercard-vi/autonomous' ]
true
lcp-hash lcp-hash true
```

## A2A

The [Agent2Agent protocol](https://a2a-protocol.org) signs nothing per transaction, so it has no place for H in a
payment. What it can do is deliver H and the link with the task. This package defines an A2A extension for that, and
exports no pairing: `binding` is the refusal `a2a/no-signed-place`, and the payment made for the task uses its own
pairing, whose record states what it proves.

| Export | What it does |
|---|---|
| `A2A_EXTENSION_URIS` | The extension's URI: `https://integraledger.com/lcp/a2a/legal-context/v1`. |
| `agentExtension({ required? })` | The Agent Card `capabilities.extensions[]` entry that declares it. |
| `requested(header)` | Whether a request's `A2A-Extensions` header value names the extension. |
| `place(task, h, link, header?)` | A copy of the Task with `{type, value, legalContextUrl}` in its `metadata`, under the extension's URI. Other metadata is kept. |
| `read(task)` | H and the link from the Task's `metadata`. |
| `delivery.proves` | What the delivery shows: nothing about the payment. |

```ts
import { hash, isRefusal } from "@integraledger/lcp";
import { agentExtension, place, read, requested, type A2aTask } from "@integraledger/lcp/a2a";

console.log(agentExtension()[0]?.uri);

const h = await hash(new TextEncoder().encode("the ATR's bytes"));
const header = "https://integraledger.com/lcp/a2a/legal-context/v1";
console.log(requested(header));

const task: A2aTask = { id: "task-1", contextId: "ctx-1", status: { state: "input-required" }, kind: "task" };
const delivered = place(task, h, `https://atr.seller.example/${h}`, header);
if (isRefusal(delivered)) throw new Error(String(delivered.code));
const got = read(delivered);
console.log(isRefusal(got) ? got.code : got.h === h && got.link.endsWith(h));
console.log(read(task));
```

```text
https://integraledger.com/lcp/a2a/legal-context/v1
true
true
{ refused: true, code: 'a2a/no-legal-context' }
```

The LCP profile [`a2a-legal-context-v1`](../../lcp/profiles/a2a-legal-context-v1.md) states the extension's rules.

## Next

- [Buyer](./buyer.md): the gate every checkout on this page runs before the buyer approves.
- [Pairings reference](../reference/pairings.md): each checkout pairing's pattern and what its record proves.
