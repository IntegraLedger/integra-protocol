# @integraledger/lcp-placement-ucp

Places an LCP reference into a [UCP](https://ucp.dev) (Universal Commerce Protocol) checkout, and reads it
back out.

**Integrity is Tier A today, via a `policies[]` entry.** The canonical carrier is a policy entry tagged
`com.integraledger.policy.legal_context`, carrying the reference under the reverse-DNS key
`com.integraledger.legal_context`. `policies[]` is in UCP's **base** checkout schema, so it needs no
negotiated intersection, no hosted schema at a namespace authority, and nothing the counterparty can prune.
The `links[type=terms_of_service].url` entry is the declared **discovery** alias: it locates the terms, it
attests nothing about them.

An earlier release wrote into `extensions["com.integraledger.legal-context"]`. **UCP has no such map.**
Verified at `universal-commerce-protocol/ucp` HEAD 2026-08-08: `checkout.json` has eighteen properties and
`extensions` is not among them — its own description reads *"Base checkout schema. Extensions compose onto
this using allOf."* Because the schema is `additionalProperties: true`, the write **landed on every document
and was read by nothing**. A refused write is a bug report; an accepted write nobody reads is a placement
that reports success forever while carrying no legal context at all.

```bash
npm install @integraledger/lcp-placement-ucp
```

| | |
|---|---|
| **Chain** | none — UCP settles through whatever payment method the checkout selects |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `policies[type=com.integraledger.policy.legal_context]` — reference under `com.integraledger.legal_context` |
| **Read also** | `links[type=terms_of_service].url` (discovery, tagged-array) |
| **Carrier types** | `sha256`, `url` |
| **Spec** | UCP checkout + policy schemas, re-verified at HEAD **2026-08-08** |

## Use

```ts
import { UCP_PLACEMENT, ucpPlacement } from "@integraledger/lcp-placement-ucp";

declare const checkout: unknown; // the UCP checkout response, as received
declare const atrHash: `0x${string}`;

// `termsUrl` is REQUIRED beside an integrity-bearing reference on this protocol: the manifest declares a
// terms-URL slot, and a counterparty holding only a hash cannot resolve it. Omitting it refuses
// `ucp/terms-url-missing` rather than writing a reference nobody can follow.
const placed = ucpPlacement.place(
  {
    ref: { type: "sha256", value: atrHash },
    termsUrl: "https://seller.example/.well-known/legal-context.json",
  },
  checkout,
);
const ref = ucpPlacement.extract(checkout);
```

Both members are total: a refusal is a returned value, never a thrown exception. Both also enforce one rule
of UCP's own — a `url`-typed reference must be HTTPS — so `place` will not write what `extract` would
refuse.

## Specification provenance — verified against the live host, 2026-07-29 — and it re-cut the package

Read against the live spec at ucp.dev, version `2026-04-08` (`overview#capabilities`,
`overview#namespace-governance`, `overview#intersection-algorithm`, and the checkout capability page), the
gate falsified the design this package was specced from, twice:

1. **Vendor capabilities are Tier A.** It specced a links-only placement on the premise that UCP's
   strict schema rejects unregistered keys, making the integrity path Tier B. The live spec says the
   opposite: "Vendors MUST use their own reverse-domain namespace for custom capabilities" — no central
   registry, no maintainer approval. What replaces registration is **authority binding**, and it binds the
   `schema` URL alone: "a declared `schema` URL's origin MUST match the namespace authority in its name",
   with a platform obliged to "validate each business-declared `schema` URL before fetching it". The `spec`
   URL is expressly outside the trust path. Built as planned, this package would have shipped a URL and no
   hash while a hash-bearing carrier was available the whole time. (Verified verbatim at UCP HEAD
   2026-08-11. An earlier release quoted the host as also saying platforms "SHOULD reject capabilities where
   the spec origin does not match" — that sentence is nowhere in UCP, and it inverts the rule above;
   `discovery/src/capability-identity.ts` records the search that established it.)
2. **`links[].type` is an OPEN set** ("Businesses MAY define custom types"), not the closed enum the plan
   claimed — that enum is ACP's; an earlier reading conflated the two protocols. `links[]` is REQUIRED on checkout
   responses; entries are `{type (req), url (req), title (opt)}`; `terms_of_service` is a recommended
   well-known type, used here because it is the spelling counterparties already read.

One more finding shapes the failure mode: negotiation **silently prunes** orphaned extensions ("Remove any
capability where extends is set but none of its parent capabilities are in the intersection") — a vendor
capability the counterparty did not declare disappears without a loud rejection, which is why the discovery
alias exists and why `extract` falls to it.

## A placement, not a binding

UCP describes a checkout; settling it is the selected payment method's business. This package is a
`ReferencePlacementAdapter` — two pure functions and a manifest, no ports, no chain, no lifecycle. Where the
selected method is a bound rail, that rail binding welds the record; otherwise this placement is the
record's whole protocol reach and reads with an honest `not-attempted` at settlement-enumeration.

## The one rule the kit cannot know

`makePlacement(UCP_PLACEMENT)` — `makePlacement` comes from [`@integraledger/lcp-binding-core`](../binding-core#readme) — is the whole adapter
except for a single wrap on `extract`: a url-typed
result that does not start with `https://` refuses `ucp/insecure-terms-url`, because an `http:` link is
rewritable in transit and accepting one would put an unauthenticated document behind a reference the record
cites. The wrap is scoped by TYPE — a sha256 answer is never blocked by a bad link sitting beside it; the
`policies[]` entry wins over `links`, and the vectors pin exactly that.

## `description` is required, and it is an object

UCP's policy schema is `required: ["type", "description"]`, so an entry carrying only a tag and a reference
is an invalid document. The manifest therefore declares `constants`, and the writer emits them:

```jsonc
{
  "description": { "plain": "Terms of sale for this order, identified by a Legal Context Protocol reference…" },
  "type": "com.integraledger.policy.legal_context",
  "com.integraledger.legal_context": { "type": "sha256", "value": "0x…" }
}
```

`description` is a **Description object** (`{plain|html|markdown}`, `minProperties: 1`), not a bare string.

The constants are written only when the entry is **created**. If the counterparty already declared this
policy type, they wrote their own prose, and overwriting it in order to place our reference would be an
edit to their document nobody asked for — so `place` merges the reference in and leaves the description
alone. Both arms are pinned as vectors.

## Why the links alias has no `write` flag

The links entry carries the terms **URL** — a different datum than the atrHash — and `place(ad, doc)`
holds one reference, not two data: writing `ref.value` into `links[].url` would put a bare hash where every
UCP client expects a URL. Publishing the links entry is the deployment's act (UCP already makes `links[]`
required on checkout responses), and this placement **reads** it: `extract` falls to the alias when no policy entry is
present, the `url` carrier type itself signalling discovery-not-integrity.

## Provenance

Cut against UCP `2026-04-08` (ucp.dev) and reconciled against LCP v1.37 §C.3; re-read against **v1.38 §C.3**
on 2026-08-12, which now records `policies[]` as a Tier A carrier in the negotiated baseline — the carrier
this package moved to. A deployment advertises under
its own reverse-domain namespace; `org.legalcontextprotocol.*` is reserved for a TSC-ratified capability.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
