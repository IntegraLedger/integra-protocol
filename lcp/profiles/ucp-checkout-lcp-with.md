**LCP profile `ucp/checkout/lcp-with`: what the buyer gives that UCP has no field for, and the purchase, as the UCP checkout extension `com.integraledger.lcp.with`.**

- **Extension name:** `com.integraledger.lcp.with`
- **Version:** `2026-10-02`
- **Extends:** `dev.ucp.shopping.checkout`
- **Specification:** `https://integraledger.com/lcp/ucp/with/2026-10-02`, this document
- **Schema:** `https://integraledger.com/lcp/ucp/with/2026-10-02/schema.json`
- **UCP:** `2026-08-25`

## Overview

An offer may ask the buyer for more than UCP's checkout has fields for: the postcode of a garden to visit, or the plant
and its problem for a diagnosis. This extension carries those asks, and the purchase the checkout's payment makes.

1. `com.integraledger.lcp.with`, in requests and responses: each ask UCP has no field for, by its name, as a string.
2. `com.integraledger.lcp.purchase`, in responses only: the purchase, once the checkout's payment reached the business.
3. Everything the buyer gives, in UCP's fields or in this member, is written into the Agentic Transaction Record (ATR)
   the business issues for the checkout's terms. The ATR is public: anyone with its URL, L, reads it.
4. The purchase member describes a payment that carries the ATR's hash, H, as the payment handler
   `com.integraledger.lcp.x402` makes one.

## Discovery

The business declares the extension in its profile's `ucp.capabilities`, and a platform in its own. The extension is
active for a checkout when both declare version `2026-10-02` and `dev.ucp.shopping.checkout` is active, by UCP's
intersection algorithm. A response then lists it in `ucp.capabilities`.

#### Example: the business's declaration, in its profile

```json
{
  "com.integraledger.lcp.with": [
    {
      "version": "2026-10-02",
      "spec": "https://integraledger.com/lcp/ucp/with/2026-10-02",
      "schema": "https://integraledger.com/lcp/ucp/with/2026-10-02/schema.json",
      "extends": "dev.ucp.shopping.checkout"
    }
  ]
}
```

#### Example: a platform's declaration, in its profile

```json
{
  "com.integraledger.lcp.with": [
    {
      "version": "2026-10-02",
      "spec": "https://integraledger.com/lcp/ucp/with/2026-10-02",
      "schema": "https://integraledger.com/lcp/ucp/with/2026-10-02/schema.json",
      "extends": "dev.ucp.shopping.checkout"
    }
  ]
}
```

## Schema Composition

The schema's `$defs["dev.ucp.shopping.checkout"]` is UCP's `checkout.json` with the two members added, by `allOf`, as
UCP's own extensions compose. The shapes are in its `$defs`: `with` and `purchase`.

| Field | Type | In requests | In responses | Description |
|---|---|---|---|---|
| `com.integraledger.lcp.with` | object, ask to string | `create`, `update`: optional. `complete`: omitted. | The member as the platform last set it. | What the buyer gives that UCP has no field for. |
| `com.integraledger.lcp.purchase` | object | Omitted. | Once the payment reached the business. | The purchase. |

## Schema

### What the buyer gives: `$defs/with`

| Part | Rule |
|---|---|
| Each key | An ask's name: a lowercase letter, then up to 31 lowercase letters, digits or `_`. |
| Each value | A string of 1 to 1000 characters. |

### The purchase: `$defs/purchase`

| Field | Type | Required | Description |
|---|---|---|---|
| `state` | `"settling"`, `"paid"`, `"authorised"` or `"anchored"` | Yes | `settling`: the payment was sent and is not yet confirmed. Once it settled, by how the offer is paid: `paid`, now; `authorised`, into an escrow the business collects from later; `anchored`, later, the anchoring payment settled and the price owed. |
| `headline` | string | Yes | What the purchase is, in words. |
| `checkout` | string | Yes | The business's id of the purchase. Once the checkout is `completed`, it is `order.id`. |
| `offer` | string | Yes | The product bought. |
| `atrHash` | string | Yes | H, of the ATR the payment agreed to: `0x` and 64 lowercase hex. |
| `transaction` | string | No | The payment's transaction on `network`, once it is known. |
| `network` | string, CAIP-2 | Yes | The network the transaction is on. |
| `proof` | string, URL | Yes | The purchase's proof page: the business's origin, then `/proof/` and H. |
| `delivery` | object | No | What was bought: only in the answer to `complete` that settled the payment. |
| `capture` | object | No | Authorise now, collect later: `due`, when the business collects; then `state` and `transaction`. |
| `owed` | object | No | Pay later: `price`, in dollars and cents, and `due`. |
| `demonstration` | string | No | On a test network, always: the sentence that the purchase is a demonstration with test money. |

`delivery` is one of five kinds, by `kind`:

| `kind` | What it holds |
|---|---|
| `file` | The file's bytes in base64, with its name, media type, size and SHA-256. |
| `booking` | The booking's reference, start, end and time zone, an `.ics` file, and its URL. |
| `access` | A pass, good until `until`, for each file at its URL. |
| `answer` | The work itself, as text, and the URL of its order. |
| `order` | The order's number, its items, what it goes to, its URL, and a note. |

## Which asks go where

UCP's own fields come first. Only what UCP has no field for goes in this member.

| The ask | Where the checkout carries it | The path a `missing` error names |
|---|---|---|
| `name` | `buyer.first_name` and `buyer.last_name`, joined by a space | `$.buyer.first_name` |
| `email` | `buyer.email` | `$.buyer.email` |
| `phone` | `buyer.phone_number` | `$.buyer.phone_number` |
| `address` | a `shipping` method's selected destination in `fulfillment`, written as one line | `$.fulfillment` |
| a booking's time, `slot` | the line item's variant: `item.id` is the product's id, `:`, and the start | `$.line_items[0].item.id` |
| any other | this member, under the ask's name | `$['com.integraledger.lcp.with'].<ask>` |

1. A product's asks are in the catalogue's `metadata.asks`. Whatever the catalogue says, the checkout names each ask not
   given in a `missing` error, at its path.
2. A platform gives each ask in UCP's field where UCP has one. The business does not read an entry of this member
   named for one of those asks.
3. The business reads from this member only the asks its offer makes, and echoes the member as the platform set it.
4. A value of only white space is not given.
5. An update replaces the member whole, as it replaces every member the platform sets. An update without it gives
   nothing in it.

#### Example: a create request, for a booking that asks for a name and a postcode

```json
{
  "line_items": [{"item": {"id": "garden-visit:2026-10-03T13:00:00.000Z"}, "quantity": 1}],
  "buyer": {"first_name": "Ada", "last_name": "Gardener"},
  "com.integraledger.lcp.with": {"postcode": "SY1 1AA"}
}
```

#### Example: the response, `ready_for_complete`, cut to the members this extension bears on

```json
{
  "ucp": {
    "version": "2026-08-25",
    "capabilities": {
      "dev.ucp.shopping.checkout": [{"version": "2026-08-25"}],
      "dev.ucp.shopping.discount": [{"version": "2026-08-25"}],
      "dev.ucp.shopping.fulfillment": [{"version": "2026-08-25"}],
      "dev.ucp.common.payment.terms": [{"version": "2026-08-25"}],
      "com.integraledger.lcp.with": [{"version": "2026-10-02"}]
    }
  },
  "id": "chk_TfJdlZwvfqyRJ4sRZnf-wvzY",
  "line_items": [
    {
      "id": "li_1",
      "item": {
        "id": "garden-visit:2026-10-03T13:00:00.000Z",
        "title": "One-hour garden visit, 2026-10-03T13:00:00.000Z",
        "price": 4500
      },
      "quantity": 1
    }
  ],
  "buyer": {"first_name": "Ada", "last_name": "Gardener"},
  "status": "ready_for_complete",
  "messages": [
    {
      "type": "info",
      "code": "public_agreement",
      "content": "What the buyer gives is written into the agreement, which is public: give an invented name and address in a demonstration."
    }
  ],
  "com.integraledger.lcp.with": {"postcode": "SY1 1AA"}
}
```

#### Example: an ask not given

```json
{
  "status": "incomplete",
  "messages": [
    {
      "type": "error",
      "code": "missing",
      "path": "$['com.integraledger.lcp.with'].problem",
      "content": "This offer asks for \"problem\": give it in com.integraledger.lcp.with.problem. It is written into the agreement, which is public.",
      "severity": "recoverable"
    }
  ],
  "com.integraledger.lcp.with": {"plant": "Tomato, Gardener's Delight"}
}
```

## The agreement

1. At `ready_for_complete` the business issues the ATR for the checkout's terms. The ATR records every value the buyer
   gave: from UCP's fields and from this member.
2. A change to any value issues a new ATR, with a new H, as a change to the terms does (`ucp/checkout/legal-context`,
   rule 5). A payment carrying an earlier H does not complete the checkout.
3. Once the buyer gave anything the offer asks for, the checkout's `messages[]` carries an `info` message with `code`
   `public_agreement`, which says the values are public.
4. Before it pays, the platform can read each value in the ATR's bytes at L, after their hash is checked against H.

## A platform that does not declare it

1. The business neither reads this member from the platform's requests nor writes either member in its responses, and
   the response's `ucp.capabilities` leaves the extension out.
2. An offer whose asks all have UCP fields is bought as it would be without the extension.
3. An offer that asks for anything else stays `incomplete`: each such ask has a `missing` error at this member's path.
4. The platform reads the purchase from `order` and from the order's own endpoint, not from this extension.

#### Example: the response to a platform that does not declare it

```json
{
  "ucp": {
    "version": "2026-08-25",
    "capabilities": {
      "dev.ucp.shopping.checkout": [{"version": "2026-08-25"}],
      "dev.ucp.shopping.discount": [{"version": "2026-08-25"}],
      "dev.ucp.shopping.fulfillment": [{"version": "2026-08-25"}]
    }
  },
  "status": "incomplete",
  "messages": [
    {
      "type": "error",
      "code": "missing",
      "path": "$['com.integraledger.lcp.with'].plant",
      "content": "This offer asks for \"plant\": give it in com.integraledger.lcp.with.plant. It is written into the agreement, which is public.",
      "severity": "recoverable"
    },
    {
      "type": "error",
      "code": "missing",
      "path": "$['com.integraledger.lcp.with'].problem",
      "content": "This offer asks for \"problem\": give it in com.integraledger.lcp.with.problem. It is written into the agreement, which is public.",
      "severity": "recoverable"
    }
  ]
}
```

## The purchase

1. The purchase member appears once the checkout's payment reached the business: with `complete_in_progress`, its
   `state` is `settling`; with `completed`, the payment settled.
2. The answer to `complete` that settled the payment holds what was bought, in `delivery`. Every later answer leaves
   `delivery` out, so what was bought goes only to the payer, and only once.
3. `checkout` is `order.id`. `proof` shows the ATR and the payment: anyone with it can check H against the settled
   transaction.

#### Example: the answer to `complete`

```json
{
  "status": "completed",
  "order": {"id": "Zg9nqrRYZin6js-Y8dwa5iBc", "permalink_url": "https://shop.example/orders/Zg9nqrRYZin6js-Y8dwa5iBc"},
  "com.integraledger.lcp.purchase": {
    "state": "paid",
    "headline": "Paid",
    "checkout": "Zg9nqrRYZin6js-Y8dwa5iBc",
    "offer": "cream-tea",
    "atrHash": "0x5a67eab30f4aedb80bb8c0d89c1c6acbb1035e0407e98ecb936d9292eb91b8ab",
    "transaction": "0xa52320ff323810b13ac667aea34e510d2ddbd98370717921d41b462dff723e62",
    "proof": "https://shop.example/proof/0x5a67eab30f4aedb80bb8c0d89c1c6acbb1035e0407e98ecb936d9292eb91b8ab",
    "delivery": {
      "kind": "order",
      "number": "ORD-ZG9NQRRY",
      "items": [{"offer": "cream-tea", "name": "Cream tea for two", "quantity": 1}],
      "to": {"name": "Ada Lovelace"},
      "url": "https://shop.example/orders/Zg9nqrRYZin6js-Y8dwa5iBc",
      "note": "The order is recorded and the stock is reduced. Nothing is sent."
    },
    "demonstration": "For demonstration only. This transaction runs on a test network with test money, and has no value.",
    "network": "eip155:84532"
  }
}
```

#### Example: the checkout read later

```json
{
  "status": "completed",
  "order": {"id": "Zg9nqrRYZin6js-Y8dwa5iBc", "permalink_url": "https://shop.example/orders/Zg9nqrRYZin6js-Y8dwa5iBc"},
  "com.integraledger.lcp.purchase": {
    "state": "paid",
    "headline": "Paid",
    "checkout": "Zg9nqrRYZin6js-Y8dwa5iBc",
    "offer": "cream-tea",
    "atrHash": "0x5a67eab30f4aedb80bb8c0d89c1c6acbb1035e0407e98ecb936d9292eb91b8ab",
    "transaction": "0xa52320ff323810b13ac667aea34e510d2ddbd98370717921d41b462dff723e62",
    "network": "eip155:84532",
    "proof": "https://shop.example/proof/0x5a67eab30f4aedb80bb8c0d89c1c6acbb1035e0407e98ecb936d9292eb91b8ab",
    "demonstration": "For demonstration only. This transaction runs on a test network with test money, and has no value."
  }
}
```

## Errors

An error is one entry in the checkout's `messages[]`. While any ask is `missing`, the checkout is `incomplete`.

| `code` | `path` | Severity | When |
|---|---|---|---|
| `missing` | the ask's path, as the table above says | `recoverable` | An ask the offer makes is not given. |
| `invalid` | `$['com.integraledger.lcp.with']` | `recoverable` | The member is not an object whose every value is a string. The business keeps none of it, so each ask it held is `missing`. |

## Security Considerations

| Requirement | Description |
|---|---|
| **Public by design** | Every value is in the ATR, which anyone with L reads, and H is on chain once the payment settles. A platform never puts in this member what the buyer may not show: no card number, password or secret. |
| **Said before it is given** | The business says the values are public (`public_agreement`), and the platform tells the buyer before it gives one. |
| **Bound to the payment** | The values are in the ATR whose H the payment carries, so the payment commits to them. A changed value is a new H, and a payment for the earlier one does not complete the checkout. |
| **Read only where asked** | The business reads only the asks its offer makes, each at most 1000 characters. |
| **What was bought** | `delivery` may be a file or a pass. It is only in the answer to the request that completed with the payer's payment, never in a later read. |
| **Data residency** | The values are what the buyer chose to give, held in a public record that cannot be withdrawn. Give the least the offer needs. |

## References

- **Extension specification:** `https://integraledger.com/lcp/ucp/with/2026-10-02`
- **Extension schema:** `https://integraledger.com/lcp/ucp/with/2026-10-02/schema.json` (the two members, and the checkout
  composed with them)
- **LCP profiles:** `ucp/checkout/legal-context` and `ucp/payment-handler/x402`, at
  `https://github.com/IntegraLedger/integra-protocol/tree/main/lcp/profiles`
- **UCP's checkout:** `https://ucp.dev/2026-08-25/specification/shopping/checkout/`
- **UCP's negotiation:** `https://ucp.dev/2026-08-25/specification/overview/`
- **UCP's schema authoring guide:** `https://ucp.dev/2026-08-25/documentation/schema-authoring/`
