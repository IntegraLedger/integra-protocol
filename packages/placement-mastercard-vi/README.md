# @integraledger/lcp-placement-mastercard-vi

**This is a Tier B placement, and that is the first thing to know about it.** Verifiable Intent permits the
custom Layer-2 constraint type this package writes — but it carries constraints in *open* mandates only, and
a verifier **MUST reject an open mandate containing a constraint type it does not recognize**. So a stock
verifier does not skip an LCP constraint; it rejects the whole mandate. The shape is legal, the deployment is
not available today, and nothing here pretends otherwise. What lifts it is registering an LCP-aware Layer-2
constraint type with the Verifiable Intent stewards.

```bash
npm install @integraledger/lcp-placement-mastercard-vi
```

| | |
|---|---|
| **Chain** | none — a mandate authorizes a payment, it settles nothing on-chain |
| **Pattern** | `opaque-challenge` (LCP §8.3.4) — the first placement in the set to use it |
| **Tier** | **B** — a stock verifier rejects an open mandate carrying an unrecognized constraint type |
| **Field** | `constraints[type=<reverse-domain>.lcp-terms-hash].value` — a `tagged-array` container |
| **Write** | **none — declaration only.** `place` refuses; `extract` reads |
| **Carrier types** | `sha256` only |
| **Signature** | inherited — Layer 2's claims are signed with the key bound in Layer 1's `cnf.jwk` |
| **Spec** | Verifiable Intent specification; withdrawn from writing per LCP v1.38 §C.7, **2026-08-08** |
| **Depends on** | [`@integraledger/lcp-binding-core`](../binding-core#readme) — `makePlacement` and the manifest vocabulary |

## Use

```ts
import { makeMastercardViPlacement } from "@integraledger/lcp-placement-mastercard-vi";

const placement = makeMastercardViPlacement("com.example"); // your own reverse domain
const placed = placement.place(
  { type: "sha256", value: "0x…" },
  { vct: "mandate.checkout.open.1", constraints: [/* the registered ones */] },
);
```

## Declaration only — `place` refuses

`place` returns `mastercard-vi/tier-b-not-writable` on every document. LCP v1.38 §C.7:

> A deployment **MUST NOT** write an unregistered legal-context constraint into a VI mandate and expect it
> to travel.

The host leaves no carrier, and the reasoning is its own: only the **open** mandates carry a `constraints`
array, and there *"regardless of strictness mode, verifiers MUST reject open mandates containing unknown
constraint types"* — an unevaluable constraint would leave the agent's authority unbounded. The
**Immediate-mode** credentials a permissive verifier would tolerate carry no `constraints` array at all. So
the permissive skip rule has nothing to skip in, and a written constraint does not degrade gracefully: it
gets the **whole mandate rejected**, which is worse for the deployment than the carrier simply not existing.

Until 2026-08-08 this package wrote the constraint anyway, behind a `writeCondition` permitting the two open
mandates. The condition was exact and the docblock stated the hazard correctly — and it shipped a writer,
because `binding-core` gates `place()` on `writeCondition` alone and never reads `tier`. **`tier: "B"` was a
label, not a gate.**

**`extract` is unchanged, and it is what this package is for.** A counterparty who does write such a
constraint — a deployment controlling both ends, where the mandate never meets a stock verifier — holds a
real reference, and reading it costs nothing.

## Naming is not the obstacle

A previous release said the registered type "has a name only the FIDO Alliance Payments TWG can assign".
LCP v1.38 §C.7 records the opposite: the `mandate.checkout.*` and `mandate.payment.*` namespaces are *"open
for extension by implementers"*, registration is a **SHOULD** for interoperability, and collision-resistant
URI naming (a URN such as `urn:example:loyalty-points`) is available for types outside them.

What blocks the carrier is **recognition, not spelling** — the rejection rule *"turns on whether the verifier
recognizes the type, not on how it is spelled"*. The `x-` private prefix exists but MUST NOT appear in
production credentials crossing organizational boundaries, so it is unavailable to LCP.


## Specification provenance — verified against the live host, 2026-07-30

Read against the live Verifiable Intent specification at `verifiableintent.dev/spec/` (§9.1 Constraint Type
Registry, the credential-layer model, §10 Conformance) and `verifiableintent.dev/spec/constraints/`. Three
claims were put to the spec. **Two hold; the third fails, and the failure is what sets the tier.**

1. **The eight registered Layer-2 constraint types are real and verifiers MUST support them** —
   `mandate.checkout.allowed_merchants`, `mandate.checkout.line_items`, `mandate.payment.allowed_payees`,
   `mandate.payment.amount_range`, `mandate.payment.budget`, `mandate.payment.recurrence`,
   `mandate.payment.agent_recurrence`, `mandate.payment.reference`. **Holds.**

2. **Implementations may define custom types, and reverse-domain naming is admitted.** §9.1 permits
   URI-namespaced custom types with no registration and no coordination — "Verifiers that do not recognize a
   URI-namespaced type SHOULD skip it in permissive mode" — and the constraints document is explicit about the
   spelling: "Use URN or reverse-domain notation", and "Custom constraint types outside the registered eight
   MUST use collision-resistant naming (URN or reverse-DNS)." A separate `x-` prefix exists for private types,
   which "MUST NOT appear in production credentials exchanged across organizational boundaries" and is
   therefore unavailable to LCP. **Holds.** A custom constraint also inherits Layer 2's signature: the
   constraints array is part of the Layer-2 mandate claims, signed with the key bound in Layer 1's `cnf.jwk`,
   and any modification invalidates that signature.

3. **A custom constraint has a conformant home against a stock verifier. FAILS.** Constraints appear in
   Autonomous-mode Layer 2 open mandates **only** — `vct: "mandate.checkout.open.1"` and
   `vct: "mandate.payment.open.1"` — and the spec says outright: "Constraints do NOT appear in Immediate mode
   credentials (`vct: \"mandate.checkout.1\"` and `vct: \"mandate.payment.1\"`) … where the user directly
   confirms final values rather than delegating to an agent." In the open ones: "**Regardless of strictness
   mode, verifiers MUST reject open mandates containing unknown constraint types.** An unevaluable constraint
   in an open mandate leaves agent authority unbounded." §9.1's skip-in-permissive rule therefore never
   reaches this carrier — the only credentials that could skip an unrecognized type are the only ones that
   must reject it.

The gate has done its job: there is **no Tier A path** here. That is a finding, not a defect, and it is why
this package declares `tier: "B"` rather than shipping a Tier A claim the host would refuse.

## Drift against LCP v1.37 §C.7 — three items, owed back to the appendix

The host governs: its live specification is binding and Appendix C is an illustration. §C.7 was
checked against the Verifiable Intent draft dated 2026-02-18 and has since drifted.

1. **§C.7's Tier A rests on a mandate stage that does not exist.** Its example carries `"stage": "closed"`,
   and its determination is "Tier A — Available today, in closed mandates only", on the reading that a closed
   mandate read by a permissive verifier carries the constraint unevaluated. The live specification has **no
   `stage` field at all** — mode and stage ride `vct` and `typ` — and no closed (Immediate-mode) credential
   carries a `constraints` array. The Tier A determination therefore has no document to stand in.
2. **`"layer": 2` is not a claim in the live payload.** The host's own examples show `vct` and `constraints`
   as sibling top-level claims; the layer is carried by the credential type, not by a member.
3. **The registered types do not share a `value` field.** §C.7 spells `mandate.payment.amount_range` as
   `{ "type": …, "value": "…" }`; live, it is `{ "type": …, "currency": "USD", "min": …, "max": … }`, and the
   only field every constraint shares is `type`. That matters to a placement: the append-or-replace rule must
   leave the registered entries byte-identical, because their shapes are not ours to normalize.

What §C.7 gets right and this package keeps: the mechanism is a custom Layer-2 constraint that inherits the
Layer-2 signature, and the Tier B forward work is registering LCP-aware constraint types — which, in the
appendix's own words, "converts legal context from optionally-skipped to mandatory-to-evaluate, and makes it
safe in open mandates and under strict verification."

## Why `opaque-challenge`, and why not the other three tokens

LCP §8.3.4 is `atrHash` "committed to a signed challenge structure whose fields are cryptographically covered
by the payment authorization signature, but the committed value itself is not transmitted on-chain." That is
this carrier exactly: covered by the consumer's Layer-2 signature, never on a ledger.

- **Not `sidecar-attestation` (§8.3.3).** That pattern is a separate on-chain transaction anchored to a
  settlement. A mandate settles nothing on-chain, so there is no transaction to anchor to. An earlier plan
  draft assigned this token and it was wrong.
- **Not `protocol-extension` (§8.3.6), even at Tier B.** §8.3.6 means the host's own verification procedure is
  `atrHash`-aware. No VI verifier is. (An earlier release added that the type "has a name only the FIDO
  Alliance Payments TWG can assign" — **that is false**, see *Naming is not the obstacle* below.)
- **Not `http-advisory` (§8.3.7).** That is the no-binding baseline, and it would understate a value the
  consumer's device key signs.

Note that §8.3.4's "Tier A where the host protocol defines an opaque parameter inside the signed envelope" is
a trade-off clause, not part of the definition, and its condition fails here: VI's constraint slot is
**evaluated**, not opaque — which is precisely why an unrecognized type is rejected rather than ignored.
Pattern and tier are independent axes, and each is stated on its own evidence.

## The namespace is required, and there is no default

This is the only placement in the set that is **built** rather than exported as a singleton. The reason is not
style: a default namespace would put an Integra-owned domain inside a consumer's signed credential in every
deployment that forgot to pass one. The factory refuses three arguments outright —

- **empty or whitespace**: "a reverse-domain namespace is required and has no default";
- **not a lowercase reverse domain** (`nonsense`, `com.Example`, `urn:example`): a constraint type must be
  collision-resistant *and* have exactly one spelling. DNS labels compare case-insensitively while a
  constraint `type` is a string the host never folds, so two casings of one namespace would claim one carrier;
- **`org.legalcontextprotocol.*`**: reserved for a TSC-ratified capability, and reserved is not available.

The namespace reaches the adapter through the manifest's `container.tag` and is matched **exactly** on read.
Another deployment's `com.other.lcp-terms-hash` is not our reference, and reading it would attribute one
party's terms record to another party's credential.

## The write condition, and the one thing it does not claim

`place` refuses `mastercard-vi/write-condition-unmet` unless the mandate's `vct` is one of the two
constraint-bearing credential types. The reference field *is* the placement, so a document we may not write
into is a document nothing was placed in — a silent skip would leave a caller believing a record exists.

This half of the reading **survives registration**: an Immediate-mode mandate will never grow a `constraints`
array however LCP's standing changes, so the gate is not a stand-in for the tier. What the gate does not
claim is that a permitted mandate will be *accepted* — at Tier B it will not be, by any verifier that has not
adopted the type. Tier carries that fact; the gate carries the document-shape fact.

`extract` is **never** gated. A condition states what we may write; a counterparty's document is evidence
either way, and refusing to read a reference already present would discard evidence because we disapprove of
how it arrived.

## What this package does not do

- It does not validate the mandate. A placement is structural: it declines to corrupt a document, it does not
  adjudicate one. In particular, `place` will create an absent `constraints` array, and a mandate whose only
  constraint is legal context is not a bounded authorization — supplying the registered constraints is the
  credential provider's obligation, not this package's.
- It does not repair a mandate that already carries two entries under one type. The first is replaced and the
  second is left exactly as the host wrote it, matching the read rule so the two halves cannot disagree.
- It does not raise the class ladder. `verify` reads this as a placement, so a signed constraint can
  never be mistaken for evidence of a settlement weld. Recovery is honest: not on-chain, not zero-party
  recoverable — an auditor needs the credential, which suits a forum that can compel it.

## Provenance

Cut against the live Verifiable Intent specification, gate discharged **2026-07-30**, and reconciled against
LCP v1.37 §C.7 the same day — with the three drift items above recorded rather than followed.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
