# @integraledger/lcp-discovery

Both sides of the bilateral handshake (LCP §4.1). The `/.well-known/legal-context.json` document — emitting
it, validating it, and checking that what a seller advertises still matches what they serve — and the
**capability declaration** a buyer's agent publishes about what it requires of a counterparty before
interacting (§4.5).

This is the first thing a buyer's agent reads about a counterparty, which makes it a trust boundary — so
it is the one place in the open layer that validates with Zod rather than relying on TypeScript types.

```bash
npm install @integraledger/lcp-discovery
```

Depends on [`@integraledger/lcp-kernel`](../kernel#readme) — the atrHash it recomputes a served terms document against — and on **zod**, which validates the trust boundary described above.

## Parse and emit

```ts
import { parseLegalContextJson, emit } from "@integraledger/lcp-discovery";

const doc = parseLegalContextJson({
  terms: "https://seller.example/terms.md",
  atrHash: "0xabab…",
  termsFormat: "text/markdown",
});

parseLegalContextJson({ terms: "http://seller.example/terms.md" }); // throws — HTTPS is required
```

Only `terms` is required. Every other field gates a higher trust level (LCP §3), so a document is not
invalid for being minimal — it is simply making a smaller claim.

## Unrecognized fields are preserved

The validator checks the **shape** of the fields it knows and passes everything else through untouched.
A seller emitting a field this version has never heard of is not an error, and a round trip does not
silently drop it. `atrHash` is accepted in any case, because the specification imposes no lowercase
requirement — normalizing on the way in would make two byte-identical documents compare unequal.

## Listing integrity

```ts
import {
  checkListingIntegrity,
  type LegalContextJson,
} from "@integraledger/lcp-discovery";

declare const listing: LegalContextJson;
declare const servedTermsBytes: Uint8Array;
declare const advertisedAtrHash: `0x${string}`;

const result = await checkListingIntegrity(listing, servedTermsBytes, advertisedAtrHash);
// Read the fields, not just `ok`: a PDF whose hash MATCHES is `ok: false` with
// `status: "listing-format-not-machine-readable"` and `hashesAgree: true`.
console.log(result.status);
```

The question this answers is narrow and worth stating precisely: does the `atrHash` a seller advertises
in their discovery document match the terms document actually being served at the `terms` URL?

A mismatch is not automatically fraud — a seller mid-update has a genuinely stale document for a few
seconds. It is, however, the signal a buyer needs before treating the advertised hash as the thing they
are about to commit to, and it is the check that turns "the seller says these are the terms" into
something a machine can confirm.

## Capability declaration — what an agent requires of a counterparty

`legal-context.json` says what a service **offers**. This says what a buyer's principal will **accept**, and
publishes it where a counterparty can pre-filter incompatible offers before either side commits (§4.5).

```ts
import {
  emitAgentCardExtension,
  emitUcpCapability,
  readAgentCard,
  readUcpProfile,
} from "@integraledger/lcp-discovery";

const declaration = {
  minimumLevel: 2,
  acceptedJurisdictions: ["New York, USA"],
  acceptedDisputeMethods: ["Commercial Arbitration Rules"],
} as const;

// A2A — one entry for the Agent Card's capabilities.extensions[]
emitAgentCardExtension(declaration);
// UCP — one entry to spread into ucp.capabilities in /.well-known/ucp
emitUcpCapability(declaration);

declare const theirCard: unknown; // a counterparty A2A Agent Card, as fetched
declare const theirUcp: unknown;  // a counterparty /.well-known/ucp document

readAgentCard(theirCard); // → { required, declaration } | null
readUcpProfile(theirUcp); // → declaration | null
```

**Exactly three requirements, and the omissions are the design.** §4.2 lists eight policy primitives; §4.5
permits publishing "a subset ... typically the minimum required level and the acceptable jurisdictions". The
three here are the ones a counterparty can act on. Commitment caps and signing thresholds are deliberately
absent: publishing the value above which a human reviews hands a counterparty the exact number to stay under,
which is the §12.7 attack surface the standard spends a section closing.

**Advertisement, not negotiation.** Emitting a declaration states what this deployment requires. It commits
nothing on a counterparty's behalf, and reading one obliges nobody — it tells a caller what it would have to
satisfy and leaves the decision where it was.

**`required` defaults to `false`.** A2A's flag means the agent will refuse counterparties that do not support
the extension, which today is nearly all of them. `true` is available and is an explicit, documented
deployment choice — never a default.

**Silence is safe in one direction only.** "The counterparty declares no LCP requirement" answers `null`.
Everything unreadable — a declaration at an unknown version, `params` carrying a requirement this build
cannot evaluate, a spoofed authority binding — **refuses**, because answering `null` there would let an agent
transact believing it complied when it did not. Declining a transaction that might have completed is the
recoverable error.

**Strict where the discovery document is loose.** `legal-context.json` preserves fields it has never heard of
(§2.5). A capability declaration refuses them, because an unknown field there is a claim a reader may ignore
while an unknown field here is a requirement placed *on* the reader — and A2A says the plain part out loud:
"the client must understand and comply with the extension's requirements". The cost is real and stated: a
future primitive is a version bump, not a tolerated extra key. The same rule covers the Agent Card options
bag: a misspelled `requird` **refuses** rather than quietly emitting `required: false`, because the flag that
downgrades silently is the one thing this unit's constraint says must be an explicit choice, and TypeScript's
excess-property check never fires on options read from a config file.

**Emit is strict, read follows the host's JSON mapping — on two fields, and only those two.** The declaration
validator is shared in both directions, because a requirement means the same thing whoever wrote it.
`description` and `required` are not requirements; they are A2A's own fields, so the host's encoding
decides what a conformant counterparty may send. Neither has proto3 presence, so `{"description": "",
"required": false}` and `{"description": null}` are legal encodings of a card carrying no description and no
demand — the exact document a stock serializer produces from what `emitAgentCardExtension` returns.
`readAgentCard` maps those to absent and `false`; it still refuses a `description` that is a number and a
`required` that is `1`. Emitting a blank description is refused, because that is a choice about our own output.
A single guard for both directions would make the reader refuse conformant cards, which is the pre-filter
failure this whole surface exists to prevent. A UCP profile is JSON-native and has no such mapping behind it,
so `readUcpProfile` needs no equivalent.

**Both readers walk own properties only** (`Object.hasOwn`, every segment), the rule `binding-core`'s document
walker states for attacker-influenced input. A document whose fields are all inherited declares nothing.

### The two host shapes, and what differs between them

| | A2A Agent Card | UCP profile |
|---|---|---|
| **Slot** | `capabilities.extensions[]` entry | `ucp.capabilities["com.integraledger.legal_context"]`, an array |
| **Requirements ride** | `params` | `config` |
| **Can demand support?** | yes — `required` | **no such notion**; a capability the counterparty does not declare is silently pruned |
| **Authority binding** | none — a URI is only an identifier | **enforced**: a declared `schema` URL's origin MUST match the namespace authority; `spec` is outside the binding and MUST only be `https` |
| **Versioning** | a new URI per breaking change | `version`, `YYYY-MM-DD`, one array entry per version |

The asymmetry is the host protocols', not ours — we describe what each specifies, we do not level them. UCP's authority binding is the stronger property — the
party asserting legal context is provably the party controlling the domain that documents it — and
`readUcpProfile` performs the platform-side check the host makes mandatory. A2A gives a reader no equivalent:
matching our extension URI proves only that the card's author typed it.

`org.legalcontextprotocol.*` is **reserved** for a capability the LCP TSC has ratified and is never emitted.
Nothing here can be configured to emit it, and a package test holds that shut.

### Specification provenance — verified against the live host, 2026-07-30

Read against each host's live specification, never LCP's informative Appendix C.

**A2A** — `specification/a2a.proto`, `docs/topics/extensions.md` and
`docs/topics/extension-and-binding-governance.md` in `a2aproject/A2A` at commit `0ef1b02` (`main`,
2026-07-23; deliberately after the `v1.0.1` tag, and every proto line below is that tree's).

1. `AgentCapabilities.extensions` is `repeated AgentExtension` (proto 418). `AgentCard.capabilities` carries
   `field_behavior = REQUIRED` (proto 380) — so an absent `capabilities` is a malformed card, while an absent
   `extensions` is a conformant "none", because proto3 JSON omits an empty repeated field. The reader draws
   exactly that line.
2. **`AgentExtension` has FOUR fields, not three** — `uri` (1), `description` (2), `required` (3), `params`
   (4), proto 424–433. LCP v1.37 §C.8 listed three; **v1.38 §C.8 lists four**, so the drift note below is a
   record rather than an outstanding item.
3. `required` is a proto3 non-optional `bool` (proto 430) and `description` a non-optional `string`
   (proto 428), so **neither has presence tracking**: their defaults are `false` and `""`, and the wire omits
   them — or, under a serializer with default emission (Go `protojson`'s `EmitUnpopulated`, protobuf-es's
   `emitDefaultValues`), prints both. proto3 JSON separately accepts `null` for any field as that field's
   default. **The round trip is gate item 3**, and it is the reason emit and read differ on these two fields
   — see below.
4. **Declaration is not activation.** "Extensions default to being inactive"; a client activates by naming
   URIs in the `A2A-Extensions` request header and the agent SHOULD echo the activated set. A card that only
   declares is never exercised — which is why `placement-a2a` puts the per-transaction reference in task
   `metadata`, where nothing is negotiated.
5. **Forward drift.** Extension governance defines an official tier under the `a2aproject` organization with
   a TSC vote, but "Anyone is able to define, publish, and implement an extension", so official status gates
   nothing. A new URI MUST be used for a breaking change, and an agent asked for an unsupported version "MUST
   NOT fall back to a different version" — hence the `/v1` in the URI and no fallback in code.

**UCP** — the live specification at `ucp.dev`, version `2026-04-08` (`specification/overview`, namespace
governance and the capability definition; profile shape cross-read against a published implementer profile).

1. A capability declaration requires `version`; `capability.json` then requires `schema` of a
   business-declared capability and `spec` as well of a platform-declared one, leaving `{ id, config,
   extends }` optional. The value under a capability name in `ucp.capabilities` is an **array** — one entry
   per supported version. `config` is "Entity-specific configuration. Structure defined by each entity's
   schema", which is where the requirements ride.
2. **Authority binding replaces registration.** "Vendors MUST use their own reverse-domain namespace for
   custom capabilities", and what replaces registration is a binding on ONE of the two URLs: "a declared
   `schema` URL's origin MUST match the namespace authority in its name", derived "from the `schema` URL
   host". The `spec` URL is explicitly outside it — "its origin is **not** authority-bound: it **MUST** be
   `https` but **MAY** be served from any host". A platform "MUST validate each business-declared `schema`
   URL before fetching it" and MUST reject the entity on a mismatch. No central registry, no maintainer
   approval. `readUcpProfile` implements the platform side against a business document: it binds the origin
   of `schema` alone and holds a **declared** `spec` to `https` only, which is what the host actually says.
   An omitted `spec` is conformant there — the MUST is on the value's scheme, and only a platform-declared
   capability must carry the member — so requiring its presence would refuse a conformant counterparty.

   *Every quotation in this section was re-verified verbatim against `universal-commerce-protocol/ucp` at
   HEAD on 2026-08-11.*
3. **No `required`.** The host has no notion of a capability being mandatory of a counterparty; capabilities
   activate only inside the negotiated intersection. A2A's flag has no analogue here and none is invented.
4. **No `extends`.** The intersection algorithm removes "any capability where extends is set but none of its
   parent capabilities are in the intersection", repeating until stable. An extension of
   `dev.ucp.shopping.checkout` would vanish exactly when checkout was not negotiated, so this is declared as
   a root capability.
5. Naming is `[reverse-domain].{service}.{capability}`. Three components is the host's own vendor pattern
   (`com.example.*`, `org.acme.*`) and its registered names run to five
   (`dev.ucp.shopping.catalog.search`), so the template describes the naming rather than fixing a segment
   count — and `com.integraledger.legal_context` is the spelling `placement-ucp` already writes.

**MCP is not here.** LCP §10 and §C.9 — unchanged on this point from v1.37 to v1.38 — put MCP's surface in
the delivery layer, and its capability
advertisement belongs to the MCP server package rather than to this one.

### Recorded drift from LCP §C.8 — recorded in prose, not encoded

The appendix is informative and the host specification governs. **One item**, carried through from
`placement-a2a`'s gate, which recorded exactly one and filed it as this unit's input:

- **`AgentExtension` has a fourth field.** §C.8's illustration shows `uri`, `required`, `params`. The proto
  declares `description` as field 2 of four (proto 424–433). It is accepted, emitted in proto field order,
  and returned by the reader — a reader that silently dropped it would re-hide the field.

**The activation-header rename is not drift from §C.8.** The header was `X-A2A-Extensions` through A2A v0.3.0
(`docs/topics/extensions.md` line 110 at the `v0.3.0` tag) and is `A2A-Extensions` in released v1.0 (same
file, lines 172–189 at `0ef1b02`) — but **§C.8 already shows the v1.0 spelling**, so the appendix is correct
and there is nothing to record against it. It is a host-version fact this unit had to get right, and
`placement-a2a` passed it along as one rather than as a drift. Only the released name is exported, and nothing
accepts the old one: an agent on v0.3.0 is on a superseded protocol version, and a deployment needs to know
that rather than have it papered over.

**Not a drift.** §C.8's "The URI is an identifier, not a location — A2A does not expect it to be
dereferenced" is the host's own position, stated verbatim for the official namespace. A2A's Implementation
Considerations separately say an author's specification document "**should**" be hosted at the extension's
URI and encourage a permanent identifier service such as `w3id.org`. A SHOULD is not an obligation: the
hosting is intended, and `w3id.org` is declined with a reason — UCP already requires this capability's
documents to be served from the namespace authority, and routing the A2A identifier through a third-party
redirector would give one capability two custodians.

### Outstanding, and it gates UCP advertisement only

The two UCP URLs (`spec`, `schema`) and the A2A extension URI point at documents **not yet served** from
`https://integraledger.com/`. Nothing in this package fetches them, and reading or writing a declaration does
not depend on them.

**The failure mode is worse than a 404, and it is measured rather than predicted.** Both UCP URLs answer
**HTTP 200 with the site's SPA index** — `text/html`, 2241 bytes, re-measured 2026-08-11. A platform that
only compares origins is unaffected; one that also FETCHES gets a success and a document that is not the one
advertised, which no absence check detects. So **publishing those documents is a precondition for
advertising the capability in a live `/.well-known/ucp`**, not for using this package — and do not rely on a
404 reading as "not yet". `placement-ucp`'s README records the same debt for the same reason.

## Machine-readable formats

`termsFormat` distinguishes formats whose text extraction is deterministic (Markdown, JSON, plain text)
from those whose extraction is ambiguous and tooling-dependent. The distinction is load-bearing for an
agent: a format whose extraction differs between tools cannot support a stable fingerprint, which is why
page-layout formats are not recommended for agent-facing terms.

## Requirement ids

This package's source and its messages cite short ids — `ATA-3`, `RCS-5`, `CMP-6` and their kin.
**They are not LCP clause numbers.** LCP is cited by section (`§8.3.1`, `§C.2`); anything shaped `XXX-n`
comes from Integra's functional specification of what a complete agent transaction requires, the fourteen
families below. Nothing in this package's behaviour depends on them, and where an id and an LCP section
disagree the section governs.

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
