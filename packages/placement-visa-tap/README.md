# @integraledger/lcp-placement-visa-tap

**The header this package writes is not covered by any Visa TAP signature, and that is the first thing to
know about it.** TAP's agent recognition signature covers exactly two derived components — `@authority` and
`@path` — and RFC 9421 puts only the components enumerated in `Signature-Input` into the signature base.
A custom header sits outside that base, so any party in the request path may replace it and every TAP
signature still verifies. This placement makes an ATR reference **available** on a TAP request. It proves
nothing about integrity of the transport, and `verify` treats it as a placement — it never raises the class
ladder, so an unbound header can never be mistaken for evidence of a weld.

```bash
npm install @integraledger/lcp-placement-visa-tap
```

| | |
|---|---|
| **Chain** | none — TAP authorizes a payment, it settles nothing on-chain |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `headers.x-lcp-hash` — the only `header-map` container in the placement set |
| **Carrier types** | `sha256` only |
| **Signature coverage** | **none** — the header is outside `Signature-Input`'s covered components |
| **Spec** | Visa TAP specifications (Visa Developer) + RFC 9421, gate discharged **2026-07-30** |

## Use

```ts
import { VISA_TAP_PLACEMENT, visaTapPlacement } from "@integraledger/lcp-placement-visa-tap";

declare const request: { headers: Record<string, string> }; // the TAP request, as received

const placed = visaTapPlacement.place({ type: "sha256", value: "0x…" }, { headers: {} });
const ref = visaTapPlacement.extract(request);
```

## Specification provenance — verified against the live host, 2026-07-30

Read against the live Visa TAP specification published at Visa Developer
(`developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications`), the
`visa/trusted-agent-protocol` reference implementation's RFC 9421 documentation, and RFC 9421 itself. Three
claims were put to the spec, and all three hold:

1. **The three-signature model is real, and its shapes differ.** TAP carries an *Agent Recognition
   Signature* "provided in the message header (HTTP header, REST API header or similar message header)", a
   *Consumer/Device Identity Signature* "provided in the message request body", and a *Payment Container
   Signature* also in the request body. Two of the three are body objects — the Agentic Consumer Recognition
   Object and the Agentic Payment Container.

2. **`Signature-Input` names the covered components, and TAP names two of them.** The agent recognition
   signature covers `@authority` (the target URI authority) and `@path` (the absolute path), plus the
   signature parameters `created`, `expires`, `keyid`, `alg`, `nonce` and `tag` (`agent-browser-auth` or
   `agent-payer-auth`). RFC 9421 §1.1 defines covered components as "an ordered set of HTTP message
   component identifiers … that indicates the set of message components covered by the signature", and §2.5
   builds the signature base from exactly that set. **A header absent from the enumeration is not in the
   signature base**, which is what makes `x-lcp-hash` replaceable in transit without invalidating anything.
   The reference implementation's documentation records the same two derived components.

3. **A sibling body object lacking its own `nonce`/`kid`/`alg`/`signature` quartet is genuinely unbound.**
   Both existing body objects carry that quartet, with the object's `nonce` **matching the message
   signature's nonce** — so a nonce mismatch invalidates the binding even where the object's own signature
   verifies. An LCP reference dropped into the body as a bare `{ type, value }` sibling inherits nothing
   from that chain: no key identifier, no algorithm, no signature, no nonce to mismatch. It would be
   silently replaceable while *looking* bound to a reader, which is strictly worse than an honestly
   advertised header.

**Drift against LCP §C.6: none material, and v1.38 closed the one wording gap.** v1.37 §C.6 did not name
TAP's RFC 9421 signature parameters; v1.38 does — `created`, `expires`, `keyid`, `alg`, `nonce`, `tag`,
noting `keyid` rather than `kid` and what `tag` distinguishes — which is the distinction this package draws
below. The appendix is an illustration; the host spec is binding
— the host's live specification is what binds. §C.6's description of the covered components, the body-object quartet and the nonce-match rule all
survive the live read. Two notes for the record: the covered-component limitation is stated for the agent
recognition signature in the specification and repeated for the reference implementation, so it is the
protocol's shape and not one demo's shortcut; and no TAP extension registry or change-management process
surfaced anywhere in the specification index, matching §C.6's own finding. TAP's only extensibility language
is that "an Agent or a Payment Scheme may optionally define additional fields that could be part of the
signature" — a coordinated arrangement, not a filing.

## What is Tier B here, and why no manifest declares it

Two integration points would actually be **bound**, and both need TAP's stewards or a payment scheme:

- the reference inside one of the existing signed body objects, under the extensibility clause above; or
- a new sibling object carrying its own `nonce`/`kid`/`alg`/`signature` quartet, mirroring the pattern the
  two existing objects follow.

A third path binds the header itself: add `x-lcp-hash` to the `Signature-Input` covered components. That is
also a coordinated change, and therefore also Tier B.

None of the three is declared as a manifest. A manifest asserting a field shape whose owner has not defined
it asserts a shape the host has not defined, and a manifest is the thing a stranger acts on. The forward
path lives here in prose, honestly, and the stewards are invited to define the placement.

## Not `sidecar-attestation`

LCP §8.3.3 is a separate on-chain transaction anchored to a settlement. **TAP settles nothing on-chain** —
it authorizes a payment that some rail later settles — so there is no settlement transaction to anchor to.
An earlier plan draft assigned that pattern token to this package and it was wrong. The pattern is §8.3.7
HTTP-Layer Advisory, which is exactly what an uncovered header is.

## The surface is deliberately two exports

`visaTapPlacement` is `makePlacement(VISA_TAP_PLACEMENT)` — `makePlacement` comes from
[`@integraledger/lcp-binding-core`](../binding-core#readme) — and nothing else — the manifest *is* the
adapter. Both members are total: a refusal is a returned value, never a thrown exception.

**There is no helper here that builds an unsigned sibling body object, and a test pins the export set so
there never is.** That helper is the single worst thing this package could ship: a body sibling carrying the
reference without the quartet does not inherit TAP's signature chain, is silently replaceable, and would
look bound to a reader. The anti-pattern is unbuildable from this surface rather than discouraged in a
comment.

## Reading the header is case-insensitive; writing preserves the counterparty's spelling

RFC 9110 makes `X-LCP-Hash` and `x-lcp-hash` the same field, so `extract` folds case — that is what reading
this container correctly means, not a heuristic. `place` writes the manifest's own lowercase spelling on a
fresh header and **reuses an existing key's casing** when one folds to a match, because emitting a second
spelling would produce two headers RFC 9110 considers one. Only the declared name is read: a header named
anything else does not exist to this package.

What `place` does **not** do is repair a document that arrives already carrying two spellings of this one
field. The write updates the first key that folds to a match and leaves the other exactly as the counterparty
sent it, stale — and a stack that canonicalizes field names would then collapse the two JSON keys into one
field with two values. That input is malformed at the HTTP layer before this placement ever sees it, and
repairing it would change the kit's header-map rule for every protocol using it, so the state is pinned in
this package's tests rather than fixed here.

## Carrier types are `["sha256"]`, and the list is exactly one on purpose

A header holds a scalar, so the encoding is `bare-value` and the field's own name fixes the type — a bare
value carries no type tag, so a second permitted type would leave a reader unable to tell a hash from a
URL. `url` is absent for the further reason that this carrier is already the weakest one in the set;
offering discovery-grade content through it would compound an uncovered header with an unattested target.

## A placement, not a binding

TAP describes an authorization, not a settlement. This package is a `ReferencePlacementAdapter` — two pure
functions and a manifest, no ports, no chain, no lifecycle. Where the payment TAP authorizes settles on a
bound rail, that rail's binding welds the record; otherwise this placement is the record's whole protocol
reach and reads with an honest `not-attempted` at settlement-enumeration.

## Provenance

Cut against the Visa TAP specification at Visa Developer and RFC 9421, gate discharged **2026-07-30**, and
reconciled against LCP v1.37 §C.6 the same day, and re-read against **v1.38 §C.6** on 2026-08-12.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
