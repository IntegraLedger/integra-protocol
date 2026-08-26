# @integraledger/lcp-placement-ap2

Places an LCP reference into the transport envelope that carries an
[AP2](https://ap2-protocol.org) (Agent Payments Protocol) mandate, and reads it back out.

**The reference rides ALONGSIDE the mandate, never inside it.** The mandate is returned byte-identical,
because the placement writes exactly one path — `metadata.legalContext` on the transport envelope — and the
mandate is not on it. Embedding the reference in the mandate itself is Tier B, it needs an upstream filing,
and this package neither emits it nor reads it.

```bash
npm install @integraledger/lcp-placement-ap2
```

| | |
|---|---|
| **Chain** | none — AP2 secures an authorization; settlement is the payment instrument's business |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `metadata.legalContext` on the transport envelope |
| **Read also** | `metadata.legal_context` (same datum, integrity, never written) |
| **Carrier types** | `sha256`, `url` |
| **Spec** | AP2 `v0.2` (release `0.2.0`, 2026-04-28), gate discharged **2026-07-30** |

## Use

```ts
import { AP2_PLACEMENT, ap2Placement } from "@integraledger/lcp-placement-ap2";

declare const envelope: unknown; // an AP2 mandate envelope, as received

const placed = ap2Placement.place({ ref: { type: "sha256", value: "0x…" } }, envelope);
const ref = ap2Placement.extract(envelope);
```

Both members are total: a refusal is a returned value, never a thrown exception.

## Specification provenance — verified against the live host, 2026-07-30

Read against AP2 v0.2 — `docs/ap2/specification.md`, `docs/ap2/checkout_mandate.md` and
`docs/ap2/payment_mandate.md` at `google-agentic-commerce/AP2` `@ main`, plus the v0.2 reference samples
(`code/samples/python/src/common/constants.py`, `.../a2a_message_builder.py`,
`.../src/roles/merchant_agent/tools.py`) — the gate answered its three questions and amended the plan three
times.

**1. Which transport carries mandates in practice, and is its metadata open?** AP2 defines **no transport**:
"AP2 operates as a security feature within a Commerce Protocol. The exact details of the Commerce Protocol …
are outside the scope of AP2." So a Tier A claim cannot rest on AP2 itself. It rests on the transport AP2's
own samples use, which is **A2A**: an A2A `Message` carries a free-form `metadata` object ("Any metadata to
provide along with the message") with no reserved-key constraint, and AP2 never writes to it. AP2's mandates
ride A2A **DataParts** keyed `ap2.mandates.CheckoutMandateSdJwt` and `ap2.mandates.PaymentMandateSdJwt`,
beside sibling DataParts such as `risk_data` and `debug_mode` — so the envelope's metadata map is genuinely
untouched and genuinely open. That is the discharge: *Tier A because the transport documents this map as
free-form and the host protocol never touches it.*

AP2 names **UCP** as its explicit compatibility target ("AP2 is designed explicitly to be compatible with the
Universal Commerce Protocol (UCP) and integrates seamlessly"). A deployment carrying AP2 mandates over UCP
wants [`@integraledger/lcp-placement-ucp`](../placement-ucp#readme), not this package. Naming the transport a placement
is true of is the honest form of a Tier A claim.

**2. The Open and Closed stages.** Two mandate types, each in two stages. A **closed** Checkout Mandate
(`vct: mandate.checkout.1`) carries the merchant-signed `checkout_jwt` and its `checkout_hash`; an **open**
one (`vct: mandate.checkout.open.1`) carries `constraints` plus a `cnf` key-confirmation claim naming the
agent's public key. The Payment Mandate mirrors it and binds to the same `checkout_hash`. Verifiers *always*
receive a closed mandate; the mode only changes how it was signed.

**3. Where the signing key is invoked** — recorded here so `AP2_HALT_POINT` does not have to discharge
it again. Not this package's concern, but it is the same reading.

- **Human Present (Direct).** The Shopping Agent assembles the closed Checkout and Payment Mandate content
  and passes it to a **Trusted Surface**, which obtains informed user consent and produces the
  **user-signed** closed mandates. The Trusted Surface MUST be non-agentic.
- **Human Not Present (Autonomous).** The user (or a trust-listed Agent Provider) signs the **open**
  mandates, which MUST carry the agent's public key as a `cnf` claim; the Shopping Agent then signs the
  **closed** mandates with its own **Agent Key**.
- **Key binding.** A closed mandate is a `kb+sd-jwt`: the key-binding signature is made at **presentation**,
  over `sd_hash`, not at issuance.
- **Therefore the halt point** is *before the Trusted Surface is invoked*. The closed Checkout Mandate commits
  to `checkout_hash`, the hash of the merchant-signed Checkout JWT, and the Payment Mandate binds to that
  same hash — so once the merchant has signed the Checkout and the Trusted Surface has signed the mandate,
  nothing inside either is mutable and no reference can still be woven in.

### What the gate falsified

1. **The plan's fixtures used AP2 v0.1 vocabulary.** `{ type: "CartMandate", credentialSubject: {} }` is the
   v0.1 VC Data Model shape. v0.2 (2026-04-28) retired `IntentMandate`/`CartMandate` for **Checkout** and
   **Payment** Mandates carried as SD-JWTs — which on the wire are *compact strings*, not JSON objects. The
   vectors are re-cut to the v0.2 envelope.
2. **The plan's `sha512` case expected the wrong refusal code.** A type outside LCP §8.2's registry never
   reaches the permitted-types check: the kit's decoder returns `undefined` and `extract` refuses
   `ap2/reference-malformed`. `ap2/carrier-type-not-permitted` means a *known* carrier type this field may
   not hold, so that case is pinned with `ipfs`/`ar`. Same determination `placement-acp` already pinned.
3. **LCP v1.37 §C.5 overstated how easy Tier B is** — and v1.38 §C.5 no longer does: it now names the
   Mandate Constraints extension point and says the path is a registration advanced through the FIDO
   Alliance working groups, not an added field. Recorded because it is the reasoning below. v1.37 read as
   an extension to the mandate schema. v0.2
   makes it a new credential type: `vct` "MUST match the exact `vct` string, including the version suffix",
   so an added claim is not a tolerated extra field, and the key-binding signature at presentation means
   nothing can be inserted afterwards. v0.2's real forward path is its **Mandate Constraints** extension
   point, which requires a uniquely defined `type`, a schema naming its selectively-disclosable fields, and
   an evaluation algorithm — a filing with the FIDO Payments TWG, not a field. Structurally the same
   invitation §C.7 makes to Mastercard Verifiable Intent, which the same working group holds.

## The live counter-example — precedent, not template

A working AP2 integration was observed placing `atrHash` inside `CartMandateSubject.paymentMethod` and
`legalContextUrl` on `credentialSubject`. It works, and it is **not** what a shipped package may do. That
integration controls both ends, so it could define its own mandate shape — and it is cut against v0.1, whose
`CartMandate` no longer exists. A shipped package can do neither: writing our own mandate fields requires
every AP2 counterparty to accept them, which is exactly the assertion a placement must not make. The vectors
pin the demo's shape as **not read**, so the boundary is a cross-implementation contract rather than a
convention.

## A considered rejection: the sibling DataPart

A DataPart of our own, beside the mandate's — `{ "lcp.legalContext": { … } }` — looks plausible, because the
samples do exactly that with `risk_data`. It is rejected for two independent reasons. AP2 defines no such key,
so declaring one asserts a shape counterparties must accept, which AP2 has not asked them to. And reading it
would need a fourth container kind in the placement kit, matching on *the first part whose `data` object owns
key K* — a shape none of the nine protocols asks for. A2A's free-form `Message.metadata` needs neither.

## A placement, not a binding

AP2 secures an authorization; settling it is the payment instrument's business. This package is a
`ReferencePlacementAdapter` — two pure functions and a manifest, no ports, no chain, no lifecycle, and
nothing that acts. Where the selected instrument is a bound rail, that rail binding welds the record;
otherwise this placement is the record's whole protocol reach and reads with an honest `not-attempted` at
settlement-enumeration.

## Why there is no protocol rule layered on the kit

`makePlacement(AP2_PLACEMENT)` — `makePlacement` comes from
[`@integraledger/lcp-binding-core`](../binding-core#readme) — is the whole adapter. UCP needed one wrap
because its discovery carrier holds a *link*, which had to be forced to HTTPS; AP2's carrier holds the
reference itself, and every rule about a reference is already binding-core's codec. A second override here
would mean a container kind is missing, not that this package is special.

## Conceptual relationship

AP2 mandates capture *what was authorized*. LCP captures *what terms govern that authorization*. They are
complementary and travel together in a complete record, which is why riding alongside the mandate loses
nothing an integrator actually needs. For a Checkout Mandate in its **open** stage — delegated authority
before the cart is final — the natural-language intent can be paired with machine-readable LCP constraints
describing the legal framework the agent may act within, extending the agent's authorization scope from
financial constraints to legal ones.

## Provenance

Cut against AP2 `v0.2` (`google-agentic-commerce/AP2` `@ main`, release `0.2.0` dated 2026-04-28), gate
discharged 2026-07-30, and reconciled against LCP v1.37 §C.5 the same day; re-read against **v1.38 §C.5** on
2026-08-12, which adopted item 3 above. Stewardship is moving to the FIDO
Alliance Payments Technical Working Group, which also holds Mastercard Verifiable Intent (§C.7).

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
