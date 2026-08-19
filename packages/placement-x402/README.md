# @integraledger/lcp-placement-x402

Places an LCP reference into an [x402](https://x402.org) v2 payment challenge, and reads it back out.

**This is the HTTP-layer carrier, not the x402 weld.** [`@integraledger/lcp-binding-evm-x402`](../binding-evm-x402#readme) binds `atrHash`
into the EIP-3009 authorization nonce — that is the settlement binding, and it answers *what did the money
commit to?* This package answers a different question — *where does the reference ride on the wire?* — and
both are true at the same time. x402 is the proof that one protocol can need a binding **and** a placement.
It is also the reason this package exists at all: the carrier it declares was previously only a private
TypeScript interface inside a seller implementation, and a private convention nobody outside that codebase
can read is not an artifact.

```bash
npm install @integraledger/lcp-placement-x402
```

| | |
|---|---|
| **Chain** | none here — settlement is `binding-evm-x402`'s, on whichever EVM rail the scheme selects |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `extensions.legalContext.info` — the top-level extensions map, the carrier x402 protects |
| **Read also** | `accepts.0.extra.atrHash` — a **bare** hash, its own encoding (integrity) |
| **Terms URL** | `extensions.legalContext.info.legalContextUrl` — declared, never written by `place` |
| **Carrier types** | `sha256`, `url` |
| **Spec** | x402 v2 (`x402-foundation/x402@1fec3aa04e41`, `specs/x402-specification-v2.md`), gate discharged **2026-07-30** |

## Use

```ts
import { X402_PLACEMENT, x402Placement } from "@integraledger/lcp-placement-x402";

declare const challenge: unknown; // the x402 402 challenge document, as received

const placed = x402Placement.place(
  { ref: { type: "sha256", value: "0x…" }, termsUrl: "https://seller.example/.well-known/legal-context.json" },
  challenge);
const ref = x402Placement.extract(challenge); // reads either carrier, canonical first
```

Both members are total: a refusal is a returned value, never a thrown exception. Entries **beside** our own in
the `extensions` map are preserved on every `place`. That is narrower than x402's echo rule, which protects the
`legalContext` entry's *contents* too — see *Known limitations*: `place` replaces our entry whole, so it is a
seller's write verb, not a buyer's echo verb.

## Specification provenance — verified against the live host, 2026-07-30

Read against the live x402 v2 specification in the x402 repository (`specs/x402-specification-v2.md`, §5.1.2
and the PaymentRequirements table), four facts were confirmed and each one decides something here:

1. **`extensions` is carried on `PaymentRequired`, `PaymentPayload` and `SettlementResponse`.** A reference
   placed there is on the **receipt**, not only the proposal — so the record can bind at execution time.
2. **Each entry carries `info` and `schema`** — `info` is "Extension-specific data provided by the server",
   `schema` is a "JSON Schema defining the expected structure of `info`". Nothing in the spec fetches or
   validates `schema`; it is a pointer. That `{info, schema}` wrapper is why this is the one placement in the
   plan that overrides the kit's `place` (see below).
3. **The echo rule:** "The client must include at least the info received; it may append additional info but
   cannot delete or overwrite existing info." This is the carrier the **protocol itself protects**, which is
   why it is canonical here rather than the per-requirement object.
4. **`extra` is "Scheme-specific additional information"** on a `PaymentRequirements` entry — the payment
   scheme's object, whose contents that scheme defines. So `place` **never writes there**; the alias is
   read-only, and that is a decision about whose namespace it is, not an omission.

Extension identifiers are implementation-defined strings — no registry, no reverse-domain rule — so the
`legalContext` key is available today and this placement is Tier A on the wire.

### Drift from LCP v1.37 §C.4 — recorded then adopted by v1.38

The host governs: its live specification is binding and LCP's Appendix C is an illustration.
Two differences, neither of which changes the design:

- v1.37 rendered the echo rule in RFC-2119 capitals ("MAY append to but **MUST NOT** delete or overwrite")
  where the host states it in lower case and about the data rather than the map. **v1.38 §C.4 now says
  exactly that**, so this item is discharged; it is kept because it is why the package reads the way it does
  and states it about the extensions map. The live spec states it in lower case and about the `info` payload.
  Same rule, weaker modality, one level lower.
- The live spec also carries `extra` on `PaymentPayload.accepted`, which §C.4 does not mention.

### Drift from a strict buyer-side reader, recorded for the same reason

Buyer gates that parse this wire document already exist. The **paths and shapes** match field for field — `accepts[0].extra.atrHash`, `accepts[0].extra.legalContextUrl`,
`extensions.legalContext.info.{type,value,legalContextUrl}`. The **resolution semantics do not**, and three
differences are real. Recording them is the whole point of declaring the carrier: an undisclosed
divergence between two readers of one document is the drift this package exists to end, not a smaller version
of it.

1. **Carrier precedence is inverted.** This placement answers with the **canonical `extensions` slot** when
   both carriers are present — the manifest's declared field wins, which is `binding-core`'s rule for every
   protocol in the set. A buyer gate may instead prefer **`accepts[].extra`**, on the ground that it is the
   per-requirement carrier and binds to the requirement actually being paid.
   Measured on one challenge carrying `0xaa…` in `extensions` and `0xbb…` in `extra`, this package answers
   `0xaa…`.
2. **Carrier disagreement is resolved here and REFUSED by a strict reader.** A buyer gate may refuse outright
   rather than pick, because two values on one challenge would let a seller advertise different terms to
   different readers. A placement is structural — it reads the strongest
   declared carrier and does not adjudicate the host's document — so it answers with the canonical value and
   says nothing. A caller that needs the commerce reader's guarantee must compare both carriers itself:
   `readDeclaredPaths` returns the first hit, not the set.
3. **A `url` carrier is placeable here and rejected there.** `carrierTypes` permits `sha256` and `url`;
   a strict buyer gate refuses `extensions.legalContext.info.type !== "sha256"` outright, because it compares
   the advertised value against a recomputed record hash and nothing but a hash can be. See
   *Known limitations*.

Reconciling 1 and 2 belongs to a universal buyer parser that reads both carriers through this manifest; a
follow-on re-expresses the seller's private carrier interface in terms of this manifest and touches the
**writer** only. Neither is done here.

### Tier B forward work — prose only, no manifest

§C.4's two forward paths are real and neither is shippable: a reference inside the **signed** Offer/Receipt
artifact (the EIP-712 types are closed structures and any change to them is a breaking version change; under
JWS an added claim is signed but explicitly uninterpreted), and a **registered** extension identifier with a
published schema (a standardization step, not a protocol change). No Tier B manifest is declared for either —
a manifest carrying a shape whose owner has not defined it is exactly the assertion this seam refuses.

## The one override, and why it earns it

`extract` is the kit's, unchanged: reading `extensions.legalContext.info` is an ordinary object-path read,
and the bare-hash alias is handled by its own declared `encoding`. `place` is overridden, because x402's slot
does not hold the reference — it holds `{ info, schema }`, a **wrapper** that no container kind models.
Inventing an `x402-extension` container kind would put one protocol's name inside a generic enum, which is
the abstraction leaking. One overridden member is composition; the test suite asserts `extract` still behaves
exactly as a freshly built kit adapter does, over every accept-and-refuse path, so a later edit cannot
quietly fork the read half too.

**The override changes the shape it writes, never which documents it will write into.** `place` refuses
exactly what a kit adapter built from this manifest alone refuses, over the same inputs and with the same
codes, and a test pins that equality. Two rules do the work:

- **Own properties only.** A challenge with zero own properties does not inherit an `extensions` map into the
  document we emit. `extract` reports such a document as `reference-absent`, and the two halves must agree
  about what is present — a `place` document is exactly as attacker-influenced as an `extract` one.
- **An `extensions` that is present and is not a map REFUSES** (`x402/document-malformed`), rather than being
  replaced. The declared field is `extensions.legalContext.info`, so `legalContext` is the field's direct
  holder and `extensions` sits one level **above** it: `binding-core`'s malformed-container rule replaces at
  the holder and refuses above it, because replacing an intermediate discards everything beneath. Absent is
  still created — that is the extension point working — and our own entry, being the direct holder, is still
  replaced.

## Two carriers, and the alias has a different SHAPE

x402 is the only protocol in the set whose alias is encoded differently from its canonical field. The
canonical slot holds an LCP §8.1 `{type, value}` object; `accepts[0].extra.atrHash` holds a **bare** hash.
Writing `lcp:sha256:0x…` into `extra.atrHash` would emit a field neither our own seller nor any x402
counterparty parses. This is the reason a `readAlso` entry declares its own encoding at all.

The alias is **index 0 only**. A locator names one path, and `accepts[0]` is what the shipped buyer parser
reads: the reference must bind to the requirement actually being paid, and searching every requirement would
let a seller park a second set of terms on an alternative it never expects to be chosen.

Reaching that path is also the reason `binding-core`'s `readAtPath` now indexes arrays — narrowly, on a
canonical non-negative integer segment only, so `length` and every other array property stay unreachable.
That relaxation lives in the kit rather than in a private loop here, because a read rule nobody can find is
the same defect as a carrier nobody can find.

## Limitations, and the three this version resolved

The predecessor recorded four limitations here. Three were one defect wearing different clothes —
integra-protocol#8, a seller built on this package emitting a challenge the published buyer refuses — and
are resolved rather than recorded:

- **`place` now writes the whole advertisement.** `place({ ref, termsUrl }, doc)` puts the reference and
  the terms URL on the wire together, at every slot `termsUrlFields` declares — the `info` member the
  authority schema requires and the `accepts[0].extra` mirror §C.4's illustration carries — and REFUSES an
  integrity-bearing advertisement with no URL, because a hash no counterparty can resolve is unverifiable
  by construction. The predecessor's "place writes the hash, never the terms URL" division put the URL in
  no published writer at all while every published reader demanded it.
- **Both URL spellings are declared, and both are written.** `termsUrlFields` is plural; the singular
  member could not express the second spelling and the shipped carrier's `extra`-side URL lived only in
  this README.
- **Our own entry is still replaced whole — and no longer costs the URL.** `place` rebuilds
  `{info, schema}` wholesale (junk a counterparty parked inside our entry does not ride our wire), and the
  URL survives because the rebuild happens after the kit has written it into `info`. The predecessor
  measured the opposite: the leaf-write dropped `legalContextUrl` on the very document sellers emit.

One limitation is withdrawn rather than resolved: **the `url` carrier admission is gone.**
`carrierTypes` is `sha256` alone. A `url` here was well-formed against the manifest and refused by every
shipped reader — a permission no reader accepts is a claim about the ecosystem, not a description of it —
and the schema this package itself puts on the wire (the authority document's shape, drift-gated in
`@integraledger/lcp-conformance`) is `const: "sha256"`, so a `url` reference would emit a challenge that
violates its own adjacent schema.

What remains, and is a fact rather than a defect: **`readDeclaredPaths` labels a canonical-field hit
`carrierClass: "integrity"` unconditionally.** That is `binding-core` behaviour shared by every placement,
and `requireIntegrity()` (from
[`@integraledger/lcp-binding-core`](../binding-core#readme), like `makePlacement`) is where a caller that
needs a content-addressed value says so — it checks the decoded type as well as the slot's label.

## Provenance

Cut against x402 v2 (`x402-foundation/x402@1fec3aa04e41`, `specs/x402-specification-v2.md`, read 2026-07-30) and reconciled
against LCP v1.37 §C.4 the same day, and re-read against **v1.38 §C.4** on 2026-08-12 — which adopted the
drift items below and added §6.1's reserved keys. The **paths and shapes** are matched field-for-field against the
shipped seller carrier and the buyer parsers that read it; the **resolution semantics diverge from a strict
buyer gate in three recorded ways**, and *Drift from a strict buyer-side reader*
above states each one and who closes it. Both drift sections are the disclosure, not a to-do list — a
divergence written down is governed; the same divergence unwritten is the undisclosed-drift defect wearing
a new name.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
