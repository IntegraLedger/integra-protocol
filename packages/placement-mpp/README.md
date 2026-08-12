# @integraledger/lcp-placement-mpp

Places an LCP reference into an [MPP](https://paymentauth.org) (Machine Payments Protocol) charge request
body, and reads it back out.

**The document is the challenge-bound `request` body.** MPP's core scheme carries a base64url(JCS(JSON))
payload in the `request` auth-param of a `WWW-Authenticate: Payment` challenge, and that payload is slot 3 of
the challenge binding. `methodDetails` is an optional member of it, so `methodDetails.atrHash` sits inside the
bound input byte-for-byte. That is this package's central claim, and it is what makes the carrier
integrity-bearing rather than merely advisory.

```bash
npm install @integraledger/lcp-placement-mpp
```

| | |
|---|---|
| **Chain** | none — MPP settles through whichever payment method the challenge names |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `methodDetails.atrHash` — a bare `0x…` hash, `object-path` container |
| **Terms URL** | `methodDetails.legalContextUrl` |
| **Carrier types** | `sha256` only — `bare-value` fixes the type from the field's contract |
| **Spec** | core `draft-httpauth-payment-00`; `draft-payment-intent-charge-00`; gate discharged **2026-07-30** |
| **Depends on** | [`@integraledger/lcp-binding-core`](../binding-core#readme) — `makePlacement` and the manifest vocabulary |

## Use

```ts
import { MPP_PLACEMENT, mppPlacement } from "@integraledger/lcp-placement-mpp";

declare const requestBody: unknown; // the MPP challenge body, as received

const placed = mppPlacement.place({ type: "sha256", value: "0x…" }, requestBody);
const ref = mppPlacement.extract(requestBody);
```

Both members are total: a refusal is a returned value, never a thrown exception.

## Specification provenance — verified against the live host, 2026-07-30 — per method, because MPP is a family

Read against the live specification family published at paymentauth.org and the IETF Datatracker on
2026-07-30. Three findings correct both the design this package was specced from and LCP v1.37 §C.1.

### 1. The core scheme moved one revision, one day after v1.37 was checked

The core scheme is now **`draft-httpauth-payment-00`, 29 July 2026, expires 30 January 2027**. It re-issues
`draft-ryan-httpauth-payment-01` (18 March 2026, expires 19 September 2026) without the personal-submission
prefix, which restarts the revision counter at `-00`. LCP v1.37 §C.1 cites the `-ryan-` revision and was
checked 2026-07-28 — one day before the successor landed, so its citation and its "published March 18, 2026
and expiring September 19, 2026" sentence are now stale by one revision.

Diffing the two bodies, the substantive additions are: §7.4 `Accept-Payment` client-preference negotiation
(plus its IANA registration, ABNF and Appendix B.2 examples), §11.2.2 challenge-binding secret management, a
hardened `id` requirement (REQUIRED, non-empty after parsing, parsers MUST reject a missing or empty one), and
a no-derivative-works notice. **The seven-slot canonicalization is unchanged**: slots 0–6 are `realm`,
`method`, `intent`, `request`, `expires`, `digest`, `opaque`; joined with `|`; absent optional fields appear as
empty segments; HMAC-SHA256 under a server secret; base64url without padding.

### 2. `methodDetails` is inside the bound body — and the guarantee runs in one direction

Confirmed verbatim. `request` is "Base64url-encoded JSON containing payment-method-specific data", JCS-
serialized, and the charge intent (`draft-payment-intent-charge-00` §5.1.2, Table 3) makes `methodDetails` an
optional member of it. Binding the challenge `id` to the challenge parameters is a **server MUST** (core
§5.1.1).

Two corrections to how strong that is:

- The seven-slot HMAC is the **RECOMMENDED** realization, not the required one. §5.1.2.1: "The binding
  mechanism is implementation-defined. Servers MAY use stateful storage (e.g., database lookup) or stateless
  verification." A server that binds by database lookup is fully conformant and computes no MAC at all.
- The key is a server secret. §11.2.2 (new in `-00`) requires implementations to keep it "on trusted
  server-side systems only" and to not disclose it to clients. **So the buyer cannot verify the binding.**

What the carrier therefore gets is **tamper-evidence**: a client cannot alter the advertised values and still
present a credential the server accepts, and a seller cannot honour a credential whose `request` differs from
the one it bound. That is stronger than a bare advisory field. It is *not* a buyer-verifiable seller
commitment, and this package does not describe it as one.

### 3. `methodDetails` is the method's namespace — checked per method

The governing rule is the charge intent §5.3: "Payment methods MAY define additional fields in the
methodDetails object. These fields are method-specific and MUST be documented in the payment method
specification."

The eight charge methods published as of **2026-07-30**, all read that day — `usdc` and `nearintents`
followed and are handled below:

| Method | Draft | `methodDetails` fields it defines | Closes the object? |
|---|---|---|---|
| card | `draft-card-charge-00` | `acceptedNetworks`, `merchantName`, `encryptionJwk`, `jwksUri`, `kid`, `billingRequired` | no |
| evm | `draft-evm-charge-00` | `chainId`, `permit2Address`, `credentialTypes`, `decimals`, `splits` | no |
| tempo | `draft-tempo-charge-00` | `chainId`, `feePayer`, `memo`, `splits`, `supportedModes` | no |
| stripe | `draft-stripe-charge-00` | `networkId`, `paymentMethodTypes`, `metadata` | no |
| solana | `draft-solana-charge-00` | `network`, `decimals`, `tokenProgram`, `feePayer`, `feePayerKey`, `splits` | no |
| stellar | `draft-stellar-charge-00` | `network`, `feePayer` | no |
| lightning | `draft-lightning-charge-00` | `invoice` (authoritative), `paymentHash`, `network` | no |
| hedera | `draft-hedera-charge-00` | `chainId` | no |

**None of the eight closes `methodDetails`, none rejects unknown keys, and none documents a legal-context
field** — and re-reading the full family of ten on 2026-08-08 did not change that. So `atrHash` is tolerated
by every published method today — which is what Tier A means — while sitting in a
namespace whose authority is each method specification. A deployment on a method that later constrains
`methodDetails` must discharge this gate for **that** method rather than assume this one carries over. The
right forward ask is the steward invitation (standard placement per method), not a core-spec change.

Also checked and not required by this package: `draft-payment-discovery-00`, `draft-payment-transport-mcp-00`,
the session and subscription intents, and `draft-nearintents-charge-01` / `draft-usdc-charge-00`.

**Scope: the charge intent.** MPP is no longer charge-only — `draft-payment-intent-subscription-00` and the
per-method session/subscription drafts carry their own `methodDetails`, which this package has never read.
A deployment binding one of those intents needs its own reading rather than this one by inheritance.

**One method constrains `methodDetails`, and it does not exclude us.** `draft-usdc-charge-00` requires
"exactly one profile details object" and makes the other three (`evm`, `stacks`, `gateway`) MUST-be-absent.
That constrains which *profile objects* appear; the draft carries no unknown-key rule, so `atrHash` is
still tolerated. Recorded because it shows a method *can* close part of this namespace — "none of them
ever will" is not a property to rely on.

### The Tier B path, and a spelling correction

A custom parameter on the outer `WWW-Authenticate: Payment` challenge is permitted today — §9.3:
"Implementations MAY define additional parameters in challenges ... Unknown parameters MUST be ignored by
clients." The same section requires lowercase parameter names, so it would have to spell **`legalcontext`**,
not `legalContext` as v1.37 §C.1 writes it. Either way an outer parameter is
outside the seven slots and therefore **unbound**, and bringing it under the binding means extending the
canonicalization input — a coordinated change to the core draft. No Tier B manifest is declared for it:
declaring a shape the host protocol has not defined is exactly the assertion this repository does not make.

## A placement, not a binding

MPP names a payment method; settling through it is that method's business. This package is a
`ReferencePlacementAdapter` — two pure functions and a manifest, no ports, no chain, no lifecycle.

The two MPP **bindings** are separate packages and only they may claim a weld: `binding-evm-mpp` (Id-Reuse,
candidate verification only) and `binding-tempo-mpp` (Native Field). The gate confirmed Tempo's half live —
`draft-tempo-charge-00` §4.2 defines `methodDetails.memo` as a `bytes32` hex value whose presence obliges the
client to call `transferWithMemo` instead of `transfer`, and §7's verification procedure obliges the server to
verify the emitted memo. That is a settlement weld and it does not ride this manifest.

## Why there is no discovery alias

The slot is `bare-value`, which fixes the carrier type from the field's own contract and therefore caps
`carrierTypes` at exactly one. A url-typed `readAlso` would need a second permitted type, so the cap forbids
one — and that is the correct answer rather than a limitation to work around. The terms URL is declared as
`termsUrlField`, labelled as the different datum it is, and a reference read can never silently descend to it:
LCP v1.37 §C.2 forbids substituting a located document for an attested one. `place` writes the hash only; the
URL is the deployment's datum, and a body that already carries one is left untouched.

## Provenance

Cut against the live MPP specification family (paymentauth.org, core `draft-httpauth-payment-00` of 29 July
2026), gate discharged per method **2026-07-30**, and reconciled against LCP v1.37 §C.1 the same day; the family was re-enumerated and §C.1 re-read on
2026-08-08. The
per-method table above is that record.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
