**LCP profile `ucp/payment-handler/x402`: the x402 payment handler for UCP, `com.integraledger.lcp.x402`.**

- **Handler name:** `com.integraledger.lcp.x402`
- **Version:** `2026-10-02`
- **Specification:** `https://lcp.integraledger.com/ucp/x402/2026-10-02`, this document
- **Schema:** `https://lcp.integraledger.com/ucp/x402/2026-10-02/schema.json`
- **UCP:** `2026-08-25`

## Introduction

A UCP checkout is paid in x402: the platform's wallet signs an x402 version 2 payment for one option the checkout
offers, and the business settles it on chain. Without AP2 mandates, the payment carries the hash of the Agentic
Transaction Record (ATR) that states the checkout's terms, and a payment the buyer approves that carries that hash is
proof that the buyer accepted that record.

1. The credential is the buyer's signed x402 payment, whole: `{type: "x402", x402Version: 2, paymentPayload,
   paymentRequirements}`. It is the credential Finance District's `xyz.fd.prism_payment` handler takes, so a wallet
   that builds one builds the other.
2. What this handler adds, without AP2 mandates: the payment carries H, the SHA-256 of the ATR's exact bytes, in the
   place the LCP profile of its x402 pairing defines (for `exact` with EIP-3009, the authorization's `nonce`), and the
   ATR names the checkout. A payment made for one checkout completes no other, and the settled transaction commits to
   the terms the buyer read.
3. The checkout carries H as well, in its `links[]`, as `ucp/checkout/legal-context` defines.
4. Two schemes: `exact`, a payment now; and `auth-capture`, an authorization into an escrow that the business captures
   later, offered only on a network where that escrow is deployed.
5. The handler has no provider. Nothing is needed from anyone but the business, its x402 facilitator and the platform's
   wallet.
6. Under UCP's AP2 Mandates extension, `dev.ucp.common.payment.ap2_mandate`, the buyer's checkout mandate commits to
   the checkout the business signed, whose `legal_context` link carries H, and the buyer first pays an agreement step
   whose `nonce` is H. [Under AP2 mandates](#under-ap2-mandates) states the rules.

## Participants

| Participant | Role | Prerequisites |
|---|---|---|
| **Business** | Advertises the handler; issues an ATR for each state of the checkout's terms; offers x402 options that pay its own address; checks and settles the payment. | Yes: an address on the network, a facilitator, an ATR host. |
| **Platform** | Discovers the handler; checks the ATR against H; has its wallet sign one option; completes the checkout. | Yes: a wallet that signs x402 version 2 and places H. |
| **Facilitator** | An x402 facilitator that verifies and settles the payment on the network. The business may settle itself. | It serves the option's scheme and network. |
| **ATR host** | Serves the ATR's exact bytes over `https` at L. The business may host it. | No. |

No member of this handler is named `merchant_*`.

```text
Platform                        Business                     ATR host          Facilitator
   |  create, update checkout      |                             |                   |
   |------------------------------>|  assemble the ATR, H        |                   |
   |<----- ready_for_complete -----|  config: x402 challenge with H; links[]: H      |
   |  GET L ------------------------------------------------->   |                   |
   |<---------------------------------- the ATR's bytes ---------|                   |
   |  SHA-256 of the bytes = H; the wallet signs an option carrying H                |
   |  complete_checkout: x402 instrument --->|                   |                   |
   |                               |  check H and the option ----------------------->|
   |                               |<------------------------------ settled ---------|
   |<----- completed, order -------|                             |                   |
```

## Business integration

### Prerequisites

1. An address on the network that receives the token. Every option names it as `payTo`.
2. An x402 facilitator that verifies and settles the option's scheme on the network, or the business's own settlement.
3. An `https` URL, L, for each ATR, that serves its exact bytes.
4. An implementation of LCP that assembles the ATR, hashes it and places H. `@integraledger/lcp` does each step.
5. Under AP2 mandates: a signing key in its profile's `keys[]`, for `ap2.merchant_authorization`; and an agreement step
   for each ATR.

No identity is assigned: `identity.access_token` is not used.

### Handler configuration

The schema's `$defs["com.integraledger.lcp.x402"]` holds `business_schema`, `platform_schema`, `response_schema` and
`payment_instrument`, each composed over UCP's `payment_handler.json`. The shapes they use are in its `$defs`:
`business_config`, `platform_config`, `response_config`, `instrument` and `credential`.

| Config variant | Context | Purpose |
|---|---|---|
| `business_config` | the business's profile | The network, the token and the schemes it is paid in. |
| `platform_config` | a platform's profile | The networks and schemes the platform's wallet pays. |
| `response_config` | a checkout response, from `ready_for_complete` | The x402 `PaymentRequired` that carries H, with the business config's `environment` and `network`. |

#### Business config fields

| Field | Type | Required | Description |
|---|---|---|---|
| `environment` | `"sandbox"` or `"production"` | Yes | `sandbox`: a test network, and a token with no value. |
| `x402Version` | `2` | Yes | The x402 version of every payment. |
| `network` | string, CAIP-2 | Yes | The network every option is on. |
| `asset` | object | Yes | The token: `address`, as x402's `asset` writes it; `symbol`; `decimals`. |
| `schemes` | array of `"exact"`, `"auth-capture"` | Yes | The schemes offered. `auth-capture` only where the escrow is deployed. |

The business config has no other member.

#### Response config fields

The response config is an x402 version 2 `PaymentRequired`, with two members added.

| Field | Type | Required | Description |
|---|---|---|---|
| `x402Version` | `2` | Yes | x402's. |
| `resource` | object | Yes | x402's. `resource.url` is the checkout's URL: with UCP's REST binding, `{endpoint}/checkout-sessions/{id}`. |
| `accepts` | array, 1 to 32 | Yes | x402 `PaymentRequirements`, each with `scheme` `exact` or `auth-capture`, `network` equal to `network`, and `payTo` the business's address. |
| `extensions` | object | Yes | `extensions.legalContext` is `{info, schema}`, and `info` is `{"type":"sha256","value":H,"legalContextUrl":L}`, as LCP's x402 profiles place it. |
| `error` | string | No | x402's. |
| `environment`, `network` | | Yes | The business config's. |

#### Example: the business's declaration, in its profile

```json
{
  "com.integraledger.lcp.x402": [
    {
      "id": "lcp_x402",
      "version": "2026-10-02",
      "spec": "https://lcp.integraledger.com/ucp/x402/2026-10-02",
      "schema": "https://lcp.integraledger.com/ucp/x402/2026-10-02/schema.json",
      "available_instruments": [{"type": "x402"}],
      "config": {
        "environment": "sandbox",
        "x402Version": 2,
        "network": "eip155:84532",
        "asset": {"address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "symbol": "USDC", "decimals": 6},
        "schemes": ["exact", "auth-capture"]
      }
    }
  ]
}
```

### The checkout

1. Until the checkout is `ready_for_complete` it has no ATR, and the handler's `config` in its responses is the
   business config.
2. At `ready_for_complete` the business assembles the ATR for the checkout's terms. Its binding slot is the x402
   pairing's, `x402: {accepts, request}`. `accepts` holds the options exactly as offered. `request` commits to a
   `POST` to the checkout's completion path, the path of `resource.url` followed by `/complete`, whose body is the
   business's statement of the checkout's terms: `bodyDigest` is SHA-256 over those bytes. So the ATR names the
   checkout. Under AP2 mandates the slot names the checkout's `id` instead: [Under AP2 mandates](#under-ap2-mandates).
3. Each option is offered under an x402 pairing of LCP in which the payment carries H, or a value from which H is
   confirmed. A pairing whose payment carries neither (`http-advisory`) is not offered.
4. The handler's `config` is then the response config for that ATR, and the checkout's `links[]` carries
   `{"type":"legal_context","url":L,"title":"lcp:sha256:"+H}`.
5. A change to the terms issues a new ATR, with a new H, a new `config` and a new link. Without AP2 mandates, a payment
   carrying an earlier H does not complete the checkout.
6. The handler causes no UCP Actions.

#### Example: the ATR's binding slot

```json
{
  "x402": {
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "amount": "18000000",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "payTo": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        "maxTimeoutSeconds": 300,
        "extra": {"name": "USDC", "version": "2"}
      }
    ],
    "request": {
      "method": "POST",
      "path": "/checkout-sessions/chk_123/complete",
      "query": "",
      "bodyDigest": "0x31e9ee275992a0de4f4ffb61742435428a23d8872fb0e5c3aa2a421651aca8d4"
    }
  }
}
```

#### Example: the handler in the checkout at `ready_for_complete`

```json
{
  "com.integraledger.lcp.x402": [
    {
      "id": "lcp_x402",
      "version": "2026-10-02",
      "available_instruments": [{"type": "x402"}],
      "config": {
        "x402Version": 2,
        "resource": {
          "url": "https://shop.example/checkout-sessions/chk_123",
          "description": "House roast, 1 lb",
          "mimeType": "application/json"
        },
        "accepts": [
          {
            "scheme": "exact",
            "network": "eip155:84532",
            "amount": "18000000",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "payTo": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
            "maxTimeoutSeconds": 300,
            "extra": {"name": "USDC", "version": "2"}
          }
        ],
        "extensions": {
          "legalContext": {
            "info": {
              "type": "sha256",
              "value": "0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d",
              "legalContextUrl": "https://shop.example/atr/0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d"
            },
            "schema": {
              "$schema": "https://json-schema.org/draft/2020-12/schema",
              "type": "object",
              "properties": {
                "type": {"const": "sha256"},
                "value": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
                "legalContextUrl": {"type": "string", "pattern": "^https://"}
              },
              "required": ["type", "value", "legalContextUrl"]
            }
          }
        },
        "environment": "sandbox",
        "network": "eip155:84532"
      }
    }
  ]
}
```

With, in the checkout's `links[]`:

```json
{
  "links": [
    {
      "type": "legal_context",
      "url": "https://shop.example/atr/0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d",
      "title": "lcp:sha256:0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d"
    }
  ]
}
```

### Processing payments

On completion the business:

1. **Validates the handler.** Exactly one instrument, whose `handler_id` is the `id` of this handler in the checkout,
   and whose `type` is `x402`. Otherwise `instrument-invalid`.
2. **Ensures idempotency.** A checkout already completed returns its earlier result. A payment is never settled twice.
3. **Reads the credential.** `type` is `x402`, `x402Version` is `2`, and `paymentPayload.accepted` equals
   `paymentRequirements`. Otherwise `credential-malformed`.
4. **Checks the option.** `paymentRequirements` is one of `accepts` in the checkout's current `config`, member for
   member. Otherwise `not-this-checkout`.
5. **Checks the binding.** The payment carries the checkout's current H where the LCP profile of the option's pairing
   puts it: for `exact` with EIP-3009, `authorization.nonce` is H; for `auth-capture`, the escrow payment's salt, or
   its salt nonce. A payment carrying an earlier H of this checkout is `agreement-changed`; any other is
   `not-this-checkout`. Under AP2 mandates, rules 5 and 6 of [Under AP2 mandates](#under-ap2-mandates) check the
   binding.
6. **Checks the checkout is still open.** One that has expired is `checkout-expired`.
7. **Settles.** It has the facilitator verify and settle the payment, and maps x402's reasons as [Errors](#errors)
   says.
8. **Returns the checkout.** A settlement broadcast and not yet confirmed (x402's `settlement_pending`) leaves it
   `complete_in_progress`. Once the settlement is confirmed, it is `completed`, with its `order`.

### Under AP2 mandates

When the checkout negotiates UCP's AP2 Mandates extension, `dev.ucp.common.payment.ap2_mandate`, every checkout
response carries the business's `ap2.merchant_authorization`, and `complete` carries the buyer's checkout mandate in
`ap2.checkout_mandate`, as the extension says. The checkout mandate commits to the checkout the business signed, and
that checkout's `legal_context` link carries H; an agreement step the buyer pays first puts H on chain. The payment
mandate, and how the payment is bound to it, are outside this handler: the business's payment service provider
verifies the payment mandate as AP2 says. These rules replace rules 2 and 3 of [The checkout](#the-checkout) and step 5
of [Processing payments](#processing-payments). Every other rule holds.

1. **The ATR** is issued under LCP's `ucp/checkout/ap2-mandate` pairing. Its binding slot is
   `ucp: {options: [{checkout: <id>}]}`, the checkout's own `id`, and it commits to no request.
2. **The agreement step** is an x402 resource at an `https` URL, A, whose payment is `exact` with EIP-3009 and carries
   H as its `nonce`. One is served for each ATR, by the business or on its behalf.
3. **The links.** The checkout's `links[]` carries the `legal_context` link, then
   `{"type":"legal_context_agreement","url":A}`. Both are written before `ap2.merchant_authorization` is computed, so
   the business's signature covers them.
4. **The options.** The handler's `config` is the response config, and carries H and L as it does without the
   extension.
5. **The checkout mandate binds H.** The business reads H from the checkout mandate's closed hop, its last SD-JWT, and
   the `checkout_jwt` it discloses, as `ucp/checkout/ap2-mandate`'s `bound` reads them: `checkout_hash` is the
   base64url SHA-256 of `checkout_jwt`, and H is the title of that checkout's `legal_context` link. It is the
   checkout's current H: a checkout mandate over an earlier state of the checkout is `mandate_scope_mismatch`.
6. **The agreement step comes first.** The business settles the payment only once the agreement step's payment,
   carrying H, has settled. Until then it answers `agreement_payment_required`, and nothing is taken.

On completion the business verifies the checkout mandate, as the extension's Business Verification says: its first
SD-JWT with the key its `kid` names in the platform's profile `keys[]`, each later one with the key the one before it
delegates to (`cnf`), and none expired. The checkout mandate's `checkout_jwt` is the business's own
`ap2.merchant_authorization` with its payload attached, and that payload is the checkout's current state: the same
`id`, `line_items`, `totals` and `legal_context` link. A refusal is one of [the errors under AP2 mandates](#errors).

#### Example: the checkout's links, under AP2 mandates

The same checkout under AP2 mandates has its own ATR, whose slot is `ucp`, and so its own H.

```json
{
  "links": [
    {
      "type": "legal_context",
      "url": "https://shop.example/atr/0x361389f6b79a94991e87f16550b8a20186ea958dd728b10f148d8ff295ec6775",
      "title": "lcp:sha256:0x361389f6b79a94991e87f16550b8a20186ea958dd728b10f148d8ff295ec6775"
    },
    {
      "type": "legal_context_agreement",
      "url": "https://shop.example/agreement/0x361389f6b79a94991e87f16550b8a20186ea958dd728b10f148d8ff295ec6775"
    }
  ]
}
```

## Platform integration

### Prerequisites

1. A wallet that signs x402 version 2 payments for the network and scheme.
2. Without AP2 mandates, the wallet places H as the LCP profile of the option's pairing says: a wallet that draws a
   random nonce produces a payment this handler refuses (`not-this-checkout`).
3. Under AP2 mandates: a key in its profile's `keys[]` that issues the mandates, and a wallet that also pays the
   agreement step.

No identity is assigned: `identity.access_token` is not used.

### Handler configuration

#### Platform config fields

| Field | Type | Required | Description |
|---|---|---|---|
| `environment` | `"sandbox"` or `"production"` | No | The environment the platform pays in. |
| `x402Version` | `2` | No | The x402 version its wallet signs. |
| `networks` | array of CAIP-2 strings | No | The networks its wallet pays on. |
| `schemes` | array of `"exact"`, `"auth-capture"` | No | The schemes its wallet signs. |

Other members are the platform's own.

#### Example: a platform's declaration, in its profile

```json
{
  "com.integraledger.lcp.x402": [
    {
      "id": "wallet_x402",
      "version": "2026-10-02",
      "spec": "https://lcp.integraledger.com/ucp/x402/2026-10-02",
      "schema": "https://lcp.integraledger.com/ucp/x402/2026-10-02/schema.json",
      "available_instruments": [{"type": "x402"}],
      "config": {"environment": "sandbox", "x402Version": 2, "networks": ["eip155:84532"], "schemes": ["exact"]}
    }
  ]
}
```

### Payment protocol

1. **Discover the handler.** `com.integraledger.lcp.x402` is in the business's `/.well-known/ucp`, and its `network`,
   `asset` and `schemes` are ones the wallet pays. The schema is fetched only from its declared URL, and a redirect is
   not followed.
2. **Create the checkout,** and update it until it is `ready_for_complete`. The handler's `config` is then the response
   config.
3. **Check the ATR.** Take H and L from `config.extensions.legalContext.info`. Check that the checkout's
   `legal_context` link carries the same H. Fetch L, compute SHA-256 over the bytes received, and compare the result
   with H as 32 bytes. Check that the ATR names the checkout: its `x402.request.path` is the checkout's completion
   path, or, under AP2 mandates, its `ucp` slot holds the checkout's `id`. On any mismatch, do not pay.
4. **Show the terms.** Show the buyer the ATR's terms.
5. **Sign.** Choose one option of `accepts`. The wallet signs it with H where the profile of the option's pairing puts
   it, and echoes `extensions` unchanged. Under AP2 mandates, steps 5 and 6 are
   [Paying under AP2 mandates](#paying-under-ap2-mandates).
6. **Complete the checkout** with one instrument: `id`, `handler_id` the `id` of this handler in the checkout, `type`
   `x402`, and the credential `{type: "x402", x402Version: 2, paymentPayload, paymentRequirements}`, where
   `paymentPayload` is the wallet's signed payment and `paymentRequirements` the option it signed.
7. **Read the answer.** `completed`, with the order; `complete_in_progress`, then get the checkout again; or an error in
   `messages[]`.

#### Example: the instrument at completion

```json
{
  "payment": {
    "instruments": [
      {
        "id": "instr_1",
        "handler_id": "lcp_x402",
        "type": "x402",
        "credential": {
          "type": "x402",
          "x402Version": 2,
          "paymentPayload": {
            "x402Version": 2,
            "resource": {
              "url": "https://shop.example/checkout-sessions/chk_123",
              "description": "House roast, 1 lb",
              "mimeType": "application/json"
            },
            "accepted": {
              "scheme": "exact",
              "network": "eip155:84532",
              "amount": "18000000",
              "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              "payTo": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
              "maxTimeoutSeconds": 300,
              "extra": {"name": "USDC", "version": "2"}
            },
            "payload": {
              "signature": "0x49a2b3ff1d2d184d1e2cb21e0e7f56dac4d5d535da864f78998b06890460304002da36d582d5419d39690e4c1ab0357315afa855d1da2fad9d815c1d5893cc511b",
              "authorization": {
                "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                "to": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
                "value": "18000000",
                "validAfter": "0",
                "validBefore": "1791000000",
                "nonce": "0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d"
              }
            },
            "extensions": {
              "legalContext": {
                "info": {
                  "type": "sha256",
                  "value": "0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d",
                  "legalContextUrl": "https://shop.example/atr/0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d"
                },
                "schema": {
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "type": "object",
                  "properties": {
                    "type": {"const": "sha256"},
                    "value": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
                    "legalContextUrl": {"type": "string", "pattern": "^https://"}
                  },
                  "required": ["type", "value", "legalContextUrl"]
                }
              }
            }
          },
          "paymentRequirements": {
            "scheme": "exact",
            "network": "eip155:84532",
            "amount": "18000000",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "payTo": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
            "maxTimeoutSeconds": 300,
            "extra": {"name": "USDC", "version": "2"}
          }
        }
      }
    ]
  }
}
```

### Paying under AP2 mandates

When the checkout negotiates the extension, these steps take the place of steps 5 and 6:

1. **Pay the agreement step first.** Fetch A, the url of the checkout's `legal_context_agreement` link, and check that
   its x402 challenge carries the same H. Pay it, `exact` with EIP-3009 and H as its `nonce`, and wait for its
   receipt, which names H.
2. **Make the checkout mandate,** once the buyer approves, after checking `ap2.merchant_authorization` as the
   extension says: `mandate.checkout.1`, whose `checkout_jwt` is `ap2.merchant_authorization` with its payload
   attached (the checkout without `ap2`, in RFC 8785 form, base64url), and whose `checkout_hash` is the base64url
   SHA-256 of `checkout_jwt`.
3. **Sign.** Choose one option of `accepts`. The wallet signs it, and echoes `extensions` unchanged.
4. **Complete the checkout** with `ap2.checkout_mandate`, and one instrument as step 6 says.
5. **Read the answer** as step 7 says. `agreement_payment_required` means the agreement step's payment has not settled
   yet: complete again with the same payment once it has.

## Errors

A failure answers with one error in the checkout's `messages[]`: `code` `payment_failed`, `path` the instrument's, and
the severity below. The checkout's `status` follows from the severity, as UCP's checkout says.

| Failure | When | Severity |
|---|---|---|
| `instrument-invalid` | Not exactly one instrument, or one through a handler the checkout did not advertise. | `recoverable` |
| `credential-malformed` | The credential is not an x402 version 2 payment of this form. | `recoverable` |
| `not-this-checkout` | The payment does not carry this checkout's H, or pays an option the `config` did not offer. | `recoverable` |
| `agreement-changed` | The terms changed after the payment was signed: it carries an earlier H of this checkout. | `requires_buyer_review` |
| `payment-invalid` | The facilitator refused the payment as invalid. | `recoverable` |
| `payment-expired` | The authorization is not valid now. | `recoverable` |
| `insufficient-funds` | The paying account does not hold enough of the token. | `recoverable` |
| `settle-failed` | Nothing was broadcast, or the transfer failed on chain. Nothing was taken. | `recoverable` |
| `checkout-expired` | The checkout expired before it was paid. | `unrecoverable` |

x402's reasons, as the facilitator returns them:

| x402 reason | Failure |
|---|---|
| `insufficient_funds` | `insufficient-funds` |
| one ending `_valid_before` or `_valid_after` | `payment-expired` |
| `unexpected_settle_error`, `invalid_transaction_state` | `settle-failed` |
| any other | `payment-invalid` |

`settlement_pending` is not a failure: the checkout is `complete_in_progress`.

Under AP2 mandates, a mandate refused at completion answers with one error whose `code` is the extension's, at the
mandate's `path`, `$.ap2.checkout_mandate`, `recoverable`: the checkout stays as it was, and the platform may complete
again.

| Code | When |
|---|---|
| `mandate_required` | `ap2.checkout_mandate` is missing. |
| `agent_missing_key` | The platform's profile has no key with the `kid` of a mandate's first SD-JWT. |
| `mandate_invalid_signature` | A mandate's signature does not verify, or it does not hold exactly one mandate of its type. |
| `mandate_expired` | A mandate has expired. |
| `merchant_authorization_invalid` | The `checkout_jwt` is not the business's own signature over a checkout. |
| `mandate_scope_mismatch` | The checkout mandate commits to another state of the checkout. |
| `agreement_payment_required` | The agreement step's payment has not settled. The `path` is `$.links[?(@.type=='legal_context_agreement')]`. Nothing was taken. |

## Security Considerations

| Requirement | Description |
|---|---|
| **Binding required** | Without AP2 mandates, the credential is bound to the checkout through H: the payment carries H, and H is the hash of an ATR whose binding slot names the checkout's completion. |
| **Binding placement** | H is inside the value the payer signs, not beside it. The credential carries no `binding` object, and the business reads none. |
| **Binding verified** | The platform checks the ATR's bytes against H before it signs. Without AP2 mandates, the business checks the payment's H before it settles. |
| **Binding under AP2 mandates** | The buyer's checkout mandate commits to the checkout the business signed, whose `legal_context` link carries H. H itself is on chain in the agreement step's payment, which settles before the checkout's. |
| **One claim** | Each ATR carries a random id, so H is unique to it. A payment carrying H completes its checkout once. |
| **Expiry** | The authorization is valid only inside its own window (`validAfter`, `validBefore`), which the wallet sets within the option's `maxTimeoutSeconds`. An expired checkout takes no payment. |
| **The payee** | The business settles only an option it offered, so the token goes to that option's `payTo`. |
| **The bytes delivered** | The platform hashes the bytes it received from L, never a parsed or re-serialised copy. |
| **What the ATR shows** | Anyone with L can read the ATR, and H is public once the payment settles. The ATR holds only what both parties may show. |
| **Data residency** | The credential holds the payer's address and signature, and no other personal data. |

## References

- **Handler specification:** `https://lcp.integraledger.com/ucp/x402/2026-10-02`
- **Handler schema:** `https://lcp.integraledger.com/ucp/x402/2026-10-02/schema.json` (the configs, the instrument and
  the credential)
- **LCP profiles:** `ucp/checkout/legal-context`, `x402/exact/eip155/eip3009`, `x402/auth-capture/eip155`, and the
  profile of each x402 pairing, at `https://github.com/IntegraLedger/integra-protocol/tree/main/lcp/profiles`
- **x402 version 2:** `https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md`
- **UCP's payment handler guide:** `https://ucp.dev/2026-08-25/specification/payment/guide/`
- **UCP's AP2 Mandates extension:** `https://ucp.dev/2026-08-25/specification/payment/extensions/ap2-mandates/`
- **AP2 version 0.2:** `https://github.com/google-agentic-commerce/AP2/tree/v0.2.0`
- **Finance District's `xyz.fd.prism_payment`:** `https://prism-gw.fd.xyz/ucp/prism.md`
