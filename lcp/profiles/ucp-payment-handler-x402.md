**LCP profile `ucp/payment-handler/x402`: the x402 payment handler for UCP, `com.integraledger.lcp.x402`.**

- **Handler name:** `com.integraledger.lcp.x402`
- **Version:** `2026-10-02`
- **Specification:** `https://integraledger.com/lcp/ucp/x402/2026-10-02`, this document
- **Schema:** `https://integraledger.com/lcp/ucp/x402/2026-10-02/schema.json`
- **UCP:** `2026-08-25`

## Introduction

A UCP checkout is paid in x402: the platform's wallet signs an x402 version 2 payment for one option the checkout
offers, and the business settles it on chain. The payment carries the hash of the Agentic Transaction Record (ATR) that
states the checkout's terms, so paying is agreeing to that record.

1. The credential is the buyer's signed x402 payment, whole: `{type: "x402", x402Version: 2, paymentPayload,
   paymentRequirements}`. It is the credential Finance District's `xyz.fd.prism_payment` handler takes, so a wallet
   that builds one builds the other.
2. What this handler adds: the payment carries H, the SHA-256 of the ATR's exact bytes, in the place the LCP profile of
   its x402 pairing defines (for `exact` with EIP-3009, the authorization's `nonce`), and the ATR names the checkout. A
   payment made for one checkout completes no other, and the settled transaction commits to the terms the buyer read.
3. The checkout carries H as well, in its `links[]`, as `ucp/checkout/legal-context` defines.
4. Two schemes: `exact`, a payment now; and `auth-capture`, an authorization into an escrow that the business captures
   later, offered only on a network where that escrow is deployed.
5. The handler has no provider. Nothing is needed from anyone but the business, its x402 facilitator and the platform's
   wallet.

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

No identity is assigned: `identity.access_token` is not used.

### Handler configuration

The schema's `$defs["com.integraledger.lcp.x402"]` holds `business_schema`, `platform_schema`, `response_schema` and
`payment_instrument`, each composed over UCP's `payment_handler.json`. The shapes they use are in its `$defs`:
`business_config`, `platform_config`, `response_config`, `instrument` and `credential`.

| Config variant | Context | Purpose |
|---|---|---|
| `business_config` | the business's profile | The network, the token and the schemes it is paid in; the scale and the disclosure. |
| `platform_config` | a platform's profile | The networks and schemes the platform's wallet pays. |
| `response_config` | a checkout response, from `ready_for_complete` | The x402 `PaymentRequired` that carries H, with the business config's `environment`, `network`, `scale` and `disclosure`. |

#### Business config fields

| Field | Type | Required | Description |
|---|---|---|---|
| `environment` | `"sandbox"` or `"production"` | Yes | `sandbox`: a test network, and a token with no value. |
| `x402Version` | `2` | Yes | The x402 version of every payment. |
| `network` | string, CAIP-2 | Yes | The network every option is on. |
| `asset` | object | Yes | The token: `address`, as x402's `asset` writes it; `symbol`; `decimals`. |
| `schemes` | array of `"exact"`, `"auth-capture"` | Yes | The schemes offered. `auth-capture` only where the escrow is deployed. |
| `scale` | string | Yes | How a price in the checkout's currency is paid in the token, in words. |
| `disclosure` | object | Yes | `{presentation: "disclosure", content}`: what the platform shows beside the checkout's totals. `content` states the scale, and any notice the business requires there. |

The business config has no other member.

#### Response config fields

The response config is an x402 version 2 `PaymentRequired`, with four members added.

| Field | Type | Required | Description |
|---|---|---|---|
| `x402Version` | `2` | Yes | x402's. |
| `resource` | object | Yes | x402's. `resource.url` is the checkout's URL: with UCP's REST binding, `{endpoint}/checkout-sessions/{id}`. |
| `accepts` | array, 1 to 32 | Yes | x402 `PaymentRequirements`, each with `scheme` `exact` or `auth-capture`, `network` equal to `network`, and `payTo` the business's address. |
| `extensions` | object | Yes | `extensions.legalContext` is `{info, schema}`, and `info` is `{"type":"sha256","value":H,"legalContextUrl":L}`, as LCP's x402 profiles place it. |
| `error` | string | No | x402's. |
| `environment`, `network`, `scale`, `disclosure` | | Yes | The business config's. |

#### Example: the business's declaration, in its profile

```json
{
  "com.integraledger.lcp.x402": [
    {
      "id": "lcp_x402",
      "version": "2026-10-02",
      "spec": "https://integraledger.com/lcp/ucp/x402/2026-10-02",
      "schema": "https://integraledger.com/lcp/ucp/x402/2026-10-02/schema.json",
      "available_instruments": [{"type": "x402"}],
      "config": {
        "environment": "sandbox",
        "x402Version": 2,
        "network": "eip155:84532",
        "asset": {"address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "symbol": "USDC", "decimals": 6},
        "schemes": ["exact", "auth-capture"],
        "scale": "Each US dollar is paid as one USDC.",
        "disclosure": {
          "presentation": "disclosure",
          "content": "Each US dollar is paid as one USDC. This checkout is paid on Base Sepolia, a test network: its USDC has no value."
        }
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
   checkout.
3. Each option is offered under an x402 pairing of LCP in which the payment carries H, or a value from which H is
   confirmed. A pairing whose payment carries neither (`http-advisory`) is not offered.
4. The handler's `config` is then the response config for that ATR, and the checkout's `links[]` carries
   `{"type":"legal_context","url":L,"title":"lcp:sha256:"+H}`.
5. The checkout's `messages[]` carries the disclosure as a warning: `code` `com.integraledger.lcp.x402.scale`, `path`
   `$.totals`, the disclosure's `content`, and `presentation` `disclosure`.
6. A change to the terms issues a new ATR, with a new H, a new `config` and a new link. A payment carrying an earlier
   H does not complete the checkout.
7. The handler causes no UCP Actions.

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
        "network": "eip155:84532",
        "scale": "Each US dollar is paid as one USDC.",
        "disclosure": {
          "presentation": "disclosure",
          "content": "Each US dollar is paid as one USDC. This checkout is paid on Base Sepolia, a test network: its USDC has no value."
        }
      }
    }
  ]
}
```

With, in the checkout's `links[]` and `messages[]`:

```json
{
  "links": [
    {
      "type": "legal_context",
      "url": "https://shop.example/atr/0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d",
      "title": "lcp:sha256:0xbfa2dd92ee9bf37520ddc1dc99a9fb0a7a7e87d4c6421ff9c654473701f9e68d"
    }
  ],
  "messages": [
    {
      "type": "warning",
      "code": "com.integraledger.lcp.x402.scale",
      "path": "$.totals",
      "content": "Each US dollar is paid as one USDC. This checkout is paid on Base Sepolia, a test network: its USDC has no value.",
      "presentation": "disclosure"
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
   `not-this-checkout`.
6. **Checks the checkout is still open.** One that has expired is `checkout-expired`.
7. **Settles.** It has the facilitator verify and settle the payment, and maps x402's reasons as [Errors](#errors)
   says.
8. **Returns the checkout.** A settlement broadcast and not yet confirmed (x402's `settlement_pending`) leaves it
   `complete_in_progress`. Once the settlement is confirmed, it is `completed`, with its `order`.

## Platform integration

### Prerequisites

1. A wallet that signs x402 version 2 payments for the network and scheme.
2. The wallet places H as the LCP profile of the option's pairing says. A wallet that draws a random nonce produces a
   payment this handler refuses (`not-this-checkout`).

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
      "spec": "https://integraledger.com/lcp/ucp/x402/2026-10-02",
      "schema": "https://integraledger.com/lcp/ucp/x402/2026-10-02/schema.json",
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
   with H as 32 bytes. Check that the ATR's `x402.request.path` is the checkout's completion path. On any mismatch, do
   not pay.
4. **Show the terms.** Show the buyer the ATR's terms, and the disclosure beside the checkout's totals.
5. **Sign.** Choose one option of `accepts`. The wallet signs it with H where the profile of the option's pairing puts
   it, and echoes `extensions` unchanged.
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
| `insufficient-funds` | The paying account does not hold enough of the token. | `requires_buyer_input` |
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

## Security Considerations

| Requirement | Description |
|---|---|
| **Binding required** | The credential is bound to the checkout through H. The payment carries H, and H is the hash of an ATR whose binding slot names the checkout's completion. |
| **Binding placement** | H is inside the value the payer signs, not beside it. The credential carries no `binding` object, and the business reads none. |
| **Binding verified** | The platform checks the ATR's bytes against H before it signs. The business checks the payment's H before it settles. |
| **One claim** | Each ATR carries a random id, so H is unique to it. A payment carrying H completes its checkout once. |
| **Expiry** | The authorization is valid only inside its own window (`validAfter`, `validBefore`), which the wallet sets within the option's `maxTimeoutSeconds`. An expired checkout takes no payment. |
| **The payee** | The business settles only an option it offered, so the token goes to that option's `payTo`. |
| **The bytes delivered** | The platform hashes the bytes it received from L, never a parsed or re-serialised copy. |
| **What the ATR shows** | Anyone with L can read the ATR, and H is public once the payment settles. The ATR holds only what both parties may show. |
| **Data residency** | The credential holds the payer's address and signature, and no other personal data. |

## References

- **Handler specification:** `https://integraledger.com/lcp/ucp/x402/2026-10-02`
- **Handler schema:** `https://integraledger.com/lcp/ucp/x402/2026-10-02/schema.json` (the configs, the instrument and
  the credential)
- **LCP profiles:** `ucp/checkout/legal-context`, `x402/exact/eip155/eip3009`, `x402/auth-capture/eip155`, and the
  profile of each x402 pairing, at `https://github.com/IntegraLedger/integra-protocol/tree/main/lcp/profiles`
- **x402 version 2:** `https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md`
- **UCP's payment handler guide:** `https://ucp.dev/2026-08-25/specification/payment/guide/`
- **Finance District's `xyz.fd.prism_payment`:** `https://prism-gw.fd.xyz/ucp/prism.md`
