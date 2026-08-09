# Discovery

Before anyone commits to anything, two agents have to find out whether they can transact at all. Discovery
is that step, and it has two halves that face opposite directions:

- **`/.well-known/legal-context.json`** — what a service **offers**. The first thing a buyer's agent reads
  about a counterparty.
- **The capability declaration** — what a buyer's principal will **accept**, published where a counterparty
  can pre-filter incompatible offers before either side commits.

[`@integraledger/lcp-discovery`](../../../packages/discovery/README.md) implements both. Because the seller's
document is the first counterparty-authored bytes an agent reads, it is a trust boundary — and it is the
one place in the open layer that validates with Zod rather than relying on TypeScript types.

## What discovery integrity provides

One narrow, checkable property, and it is worth stating precisely:

> Does the `atrHash` a seller advertises in their discovery document match the terms document actually
> being served at the `terms` URL?

That is `checkListingIntegrity`, and it is the check that turns "the seller says these are the terms" into
something a machine can confirm. Without it a buyer has a hash and a link and no reason to believe they
correspond.

A mismatch is **not automatically fraud**. A seller mid-update has a genuinely stale document for a few
seconds. It is, however, the signal a buyer needs before treating the advertised hash as the thing it is
about to commit to.

The result names which case it is:

| `status` | Meaning |
|---|---|
| `ok` | the served bytes hash to the advertised fingerprint |
| `mismatch` | they do not — the served hash is reported alongside the advertised one |
| `listing-format-not-machine-readable` | the listing declares a `termsFormat` outside the machine-readable set, so no stable fingerprint is possible and no comparison is made |

## The seller's document

Only **`terms`** is required. Every other field gates a higher trust level, so a minimal document is not
invalid — it is making a smaller claim.

Two shape decisions are deliberate and they point in opposite directions:

- **`terms` must be a lowercase-`https` absolute URL with no embedded whitespace.** RFC 3986 makes schemes
  case-insensitive and directs normalization to lowercase, so refusing `HTTPS://` is stricter than the URL
  grammar on purpose. Intake is a trust boundary, and this document is what a fingerprint gets computed
  against downstream: accepting several spellings of one URL means the same terms document arrives under
  names that compare unequal, and the fix for that would be a normalize-then-accept step — a fallback path.
  Every publisher can emit the canonical spelling; nobody is locked out.
- **`atrHash` is accepted in any case**, because the specification imposes no lowercase rule on hex digits
  and no normalization is needed to compare two hashes. Normalizing on the way in would make two
  byte-identical documents compare unequal.

The two decisions are independent and both are meant.

**Unrecognized fields are preserved.** The validator checks the shape of the fields it knows and passes
everything else through untouched, so a seller emitting a field this version has never heard of is not an
error and a round trip does not silently drop it.

### Machine-readable formats

`termsFormat` names the format of the served terms. The known tokens are `markdown`, `json`, `plain`,
`html`, `pdf` — and only the first three are machine-readable. The field itself is an open string, so a
token this version has never heard of validates like any other unrecognized value; what narrows is the
integrity check, which compares only against the machine-readable three.

The distinction is load-bearing rather than editorial. A format whose text extraction differs between tools
cannot support a stable fingerprint, which is why page-layout formats are not recommended for agent-facing
terms and why `checkListingIntegrity` declines to compare against one rather than reporting a mismatch it
cannot stand behind.

## The buyer's capability declaration

The mirror of the seller's document: it states what this deployment requires of a counterparty, and it
carries **exactly three** fields.

| Field | |
|---|---|
| `minimumLevel` | **required** — the LCP trust level (1–4) this deployment will not go below |
| `acceptedJurisdictions` | optional |
| `acceptedDisputeMethods` | optional |

The omissions are the design. The specification lists eight policy primitives; the three here are the ones
a counterparty can act on — each states a bar it can tell whether its own offer clears. **Commitment caps
and signing thresholds are deliberately absent, and must stay absent:** publishing the value above which a
human reviews hands a counterparty the exact number to stay under, which is the attack surface the standard
spends a section closing. The remaining three primitives are publishable in principle and are simply out of
scope for this version.

Four rules govern how a declaration behaves:

- **Advertisement, not negotiation.** Emitting one states what this deployment requires. It commits nothing
  on a counterparty's behalf, and reading one obliges nobody — it tells a caller what it would have to
  satisfy and leaves the decision where it was.
- **`required` defaults to `false`.** A2A's flag means the agent will refuse counterparties that do not
  support the extension, which today is nearly all of them. `true` is available and is an explicit,
  documented deployment choice — never a default. A misspelled option key **refuses** rather than quietly
  emitting `required: false`, because the flag that downgrades silently is the one thing that must be an
  explicit choice.
- **Silence is safe in one direction only.** "The counterparty declares no LCP requirement" answers `null`.
  Everything *unreadable* — a declaration at an unknown version, a requirement this build cannot evaluate,
  a spoofed authority binding — **refuses**, because answering `null` there would let an agent transact
  believing it complied when it did not. Declining a transaction that might have completed is the
  recoverable error.
- **Strict where the seller's document is loose.** `legal-context.json` preserves fields it has never heard
  of; a capability declaration refuses them. An unknown field in the first is a claim a reader may ignore;
  an unknown field in the second is a requirement placed *on* the reader. The cost is stated: a future
  primitive is a version bump, not a tolerated extra key.

An empty `acceptedJurisdictions: []` is refused for the same family of reasons — read literally it accepts
nothing, so it would decline every counterparty on earth. A deployment that constrains nothing omits the
field.

### The two host shapes

The declaration is protocol-neutral; where it rides is not. The specification says the exposure mechanism
is protocol-specific and out of scope, so the shapes come from the host protocols' live specifications:

| | A2A Agent Card | UCP profile |
|---|---|---|
| **Slot** | a `capabilities.extensions[]` entry | an array under a vendor capability name in `ucp.capabilities` |
| **Requirements ride** | `params` | `config` |
| **Can demand support?** | yes — `required` | **no such notion**; a capability the counterparty does not declare is silently pruned |
| **Authority binding** | none — a URI is only an identifier | **enforced**: the `spec` and `schema` origins must match the namespace authority |
| **Versioning** | a new URI per breaking change | a `YYYY-MM-DD` version, one array entry per version |

The asymmetry is the host protocols', not LCP's. UCP's authority binding is the stronger property — the
party asserting legal context is provably the party controlling the domain that documents it — and
`readUcpProfile` performs the platform-side check the host makes mandatory. A2A gives a reader no
equivalent: matching an extension URI proves only that the card's author typed it.

Two operational notes belong with that table. Declaring an A2A extension is **not activating** it —
extensions default to inactive and a client activates by naming URIs in a request header — which is why the
per-transaction reference rides task metadata instead (see
[bindings-vs-placements.md](bindings-vs-placements.md)). And advertising the UCP capability on a live
profile additionally requires *serving* the documents its `spec` and `schema` URLs name, because a platform
validating the binding may fetch as well as compare origins. That is a deployment precondition, not a
requirement of this package.

The `org.legalcontextprotocol.*` namespace is **reserved** for a capability the LCP Technical Steering
Committee has ratified, and is never emitted. Nothing here can be configured to emit it.

## Emitting a document, and checking what it advertises

```ts
import { checkListingIntegrity, emit } from "@integraledger/lcp-discovery";
import { hashAtr } from "@integraledger/lcp-kernel";

const terms = new TextEncoder().encode(
  "Example Seller supplies Example Buyer with 1000 API calls for 25.00 USDC.\n",
);
const advertised = await hashAtr(terms);

// `emit` drops undefined fields, then validates — an absent optional never serializes as null.
const listing = emit({
  terms: "https://seller.example/terms.md",
  atrHash: advertised,
  termsFormat: "markdown",
});
console.log(JSON.stringify(listing));

// The buyer fetched the terms URL and got these bytes back.
const served = await checkListingIntegrity(listing, terms, advertised);
console.log(served.ok, served.status, "|", served.detail);

// The seller updated the document but not the advertised hash.
const stale = new TextEncoder().encode("Superseded terms.\n");
const drifted = await checkListingIntegrity(listing, stale, advertised);
console.log(drifted.ok, drifted.status, "|", drifted.servedAtrHash);
```

```text
{"terms":"https://seller.example/terms.md","termsFormat":"markdown","atrHash":"0x52c0d88ce7f4432d2ad0b0c2f00eeaba84189de6e1aea0f7bc386c8920685d0c"}
true ok | served terms match the advertised fingerprint (DSC-2)
false mismatch | 0xa2c847ebf0d21a15a74abc141ecc079c385f7378153095368ad32668186dc0c1
```

The mismatch reports **both** hashes. A buyer that only learned "these disagree" would have nothing to act
on; a buyer holding the served hash can decide whether the document it actually fetched is one it is
willing to proceed under.

## What discovery does not provide

- **Not the walk.** An integrity check compares an advertised hash to served bytes. It establishes nothing
  about a settlement, an acceptance, or an authority chain. See
  [verification-walk.md](verification-walk.md).
- **Not an ATR.** The terms document a listing points at is an *input* to a record — the thing a `terms`
  slot references. The record is assembled separately. See [atr.md](atr.md).
- **Not a commitment.** Reading a counterparty's declaration tells a caller what it would have to satisfy.
  It does not bind either side to anything.
- **Not a registry.** Every document here is served by the party it describes, from that party's own
  origin. Nothing in this repository operates a shared index of them.

## Where next

- [atr.md](atr.md) — the record whose fingerprint a listing advertises.
- [verification-walk.md](verification-walk.md) — where a discovery check becomes the
  `discovery-integrity` step of a TC-4 walk.
- [evidence.md](evidence.md) — retaining the `referenced terms document` the listing pointed at.
- [discovery README](../../../packages/discovery/README.md) — the API, the host-specification readings
  behind each shape, and the reserved-namespace rule.
