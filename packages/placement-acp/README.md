# @integraledger/lcp-placement-acp

Places an LCP reference into an [ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
agentic checkout session, and reads it back out.

```bash
npm install @integraledger/lcp-placement-acp
```

| | |
|---|---|
| **Chain** | none — ACP never settles on one |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `metadata.legal_context` |
| **Also read** | `legal_context` (top-level), `metadata.legalContext` — read only, never written |
| **Carrier types** | `sha256`, `url` |
| **Spec** | ACP agentic checkout, stable `2026-04-17` |
| **Depends on** | [`@integraledger/lcp-binding-core`](../binding-core#readme) — `makePlacement` and the manifest vocabulary |

## A placement, not a binding

ACP describes a checkout conversation; it does not settle. There is no transaction to weld a hash into, so
this package is a `ReferencePlacementAdapter` rather than a `WeldAdapter` — two pure functions and a
manifest, no ports, no chain, no lifecycle. Whatever ACP's selected payment method turns out to be, settling
it is that rail binding's business, not this package's.

```ts
import { ACP_PLACEMENT, acpPlacement } from "@integraledger/lcp-placement-acp";

declare const checkoutSession: unknown; // an ACP checkout session, as received

const placed = acpPlacement.place(
  {
    ref: { type: "sha256", value: "0x…" },
    termsUrl: "https://seller.example/.well-known/legal-context.json",
  },
  checkoutSession,
);
const advertised = acpPlacement.extract(checkoutSession);
```

Both members are total: a refusal is a returned value, never a thrown exception.

## Why `metadata`

`CheckoutSessionBase` is `additionalProperties: false`, so no *ad-hoc* top-level field is available on any
session — the metadata map, documented "Arbitrary metadata for merchant use" with
`additionalProperties: true`, is the only home that asks nothing of the counterparty. (A top-level field is
reachable, but only the one an extension declares and only where it is declared; see below.)
`place` adds one key and preserves every other, because the merchant's own metadata is none of this
package's business.

**This is the only carrier ACP's released schema will accept, and it is written unconditionally.** A
third-party extension under a reverse-domain identifier needs no upstream coordination, and is worth
declaring for discovery and negotiation — but a declaration is not an authorisation, and the field it
appears to add is not one the schema admits. Riding `metadata` is undeclared, unnegotiated, absent from
discovery and carries no published schema. What it buys is that it asks **nothing** of the counterparty: it
works against any conformant ACP implementation on day one.

## The top-level carrier: read, never written

`place` writes exactly one field. A top-level `legal_context` is **read** when a counterparty emits one, and
is never written.

An earlier release wrote it behind a two-term gate — an `ExtensionDeclaration` naming our identifier, plus a
`status` proving the document was a session RESPONSE rather than a create request. Both terms were exact
against the live schema. The conclusion was wrong, and **LCP v1.38 §C.2 withdrew the home**:

> `CheckoutSessionBase` is `additionalProperties: false` and `CheckoutSession` is `allOf: [CheckoutSessionBase]`
> with no properties of its own.

So no `ExtensionDeclaration` can make a new top-level key valid. ACP's own core `discount` extension works
because `discounts` is **already a declared property** of `CheckoutSessionBase` — its `extends` array
documents where the field is, rather than creating one. Measured with ajv 8.20 against `spec/2026-04-17`:

| document | verdict |
|---|---|
| declaration only, no new field | **VALID** |
| `metadata.legal_context` carrier | **VALID** |
| declared *and* gated top-level `legal_context` | **INVALID** — `additionalProperties` |

```jsonc
// a session RESPONSE declaring com.integraledger.legal_context → ONE carrier lands
{ id: "cs_1", status: "ready_for_payment",
  capabilities: { extensions: [{ name: "com.integraledger.legal_context" }] },
  metadata: { legal_context: "lcp:sha256:0x…" } }
```

**The read stays.** A counterparty who emits a top-level `legal_context` holds a real reference, and refusing
to read it would discard evidence over a disagreement about whose schema is right — the same reasoning that
keeps `metadata.legalContext`, Appendix C.2's own illustration, in `readAlso`. Writing it is the asymmetric
half: it would put a document on the wire that a stock ACP validator rejects **in whole**, which is the
hazard the gate was built to avoid.

Recorded so the next reader does not re-derive it: the gate was not removed because it was imprecise. It was
removed because the question it answered — *is this write authorised?* — has no yes.

## Why `http-advisory` and not `protocol-extension`

Because `http-advisory` is the true statement, and it is the weaker-sounding one.

LCP §8.3.6 Protocol Extension means the **host protocol** has defined `atrHash`-aware semantics inside its
own verification and settlement procedure. ACP has not, and we have not asked it to. §8.3.6 is also **Tier B
by definition** — it "fragments adoption until upstream registration lands", because stock implementations
reject the extended variant. That is precisely backwards for this placement: it works **today** against
stock ACP implementations, exactly because it rides a map the protocol designates for arbitrary merchant
use rather than an extension anyone has to adopt first.

§8.3.7 is also honest about what you are getting, and you should read it as a limit: the reference here is
**not on-chain, not zero-party recoverable** (an auditor needs the service's records) and **not
forward-indexable**. Where the dispute forum needs stronger evidence, pair this with one of the six
settlement binding patterns — which is what happens on its own when ACP's selected payment method is a
bound rail: the rail binding welds the record and the class ladder reads it.

**Only *core* registration is Tier B.** Publishing a third-party extension needs no proposal at all (above).
What needs one is registering `legalContext` as a **core** ACP extension — a bare identifier alongside
`discount` — which gives parsers standardized handling without bilateral negotiation. That takes a
Specification Enhancement Proposal, which must find a founding-maintainer sponsor to proceed and may be
closed as dormant if it does not. Until it lands, declaring `protocol-extension` here would claim standing
in ACP's core set that this package does not have.

## Provenance

Cut against ACP's stable `2026-04-17` JSON Schema, re-read 2026-07-28, and reconciled against LCP v1.37
§C.2 the same day; re-read against **v1.38 §C.2** on 2026-08-12. The `http-advisory` determination is
unchanged — §8.3's pattern definitions are byte-identical across v1.36, v1.37 and v1.38 — but §C.2 itself is
not: v1.38 withdrew the top-level carrier this package used to write, which is the change described at the
top of this file.

The conditional write was cut against the same release's `schema.extension.json`, re-read 2026-07-30.
`ExtensionDeclaration` requires only `name`; `Capabilities.extensions` is a `oneOf` whose request arm is
identifier strings and whose response arm is declaration objects, shared by one `Capabilities` definition and
undiscriminated; `extension_identifier` admits `com.integraledger.legal_context` and an optional dated version
suffix; and `extends_target` admits `$.CheckoutSession.legal_context` while rejecting `legal-context` — which
fixes the snake_case spelling of the **extension-declared** field. It fixes nothing about
`metadata.legal_context`: `metadata` is `additionalProperties: true` and takes any key, so that spelling is
ours, following the convention ACP's schema is written in.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
