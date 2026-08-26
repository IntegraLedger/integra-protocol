# @integraledger/lcp-discovery

## 0.12.3

### Patch Changes

- e34ea79: `LCP_MCP_EXTENSION_ID` — the fourth wire identity, spelled in MCP's vocabulary.

  MCP revision 2026-07-28 advertises optional extensions in the `extensions` field of capabilities, keyed by
  a `{vendor-prefix}/{extension-name}` identifier with the prefix mandatory. This package already owns every
  identifier of that class — `LCP_CAPABILITY_NAME` for UCP, `A2A_LCP_EXTENSION_URI` for A2A — and
  `check:wire` in the buyer-side repo derives its seal by importing this package, so an MCP identifier
  declared anywhere else would be both a second home for a wire identity and invisible to the gate that
  exists to catch drift.

  ⭐ **SLASH AND HYPHEN, BY THE HOUSE RULE RATHER THAN BY TASTE.** _Follow the vocabulary you are writing
  into_ is what gave `LCP_CAPABILITY_NAME` its underscore, because UCP spells its own vocabulary that way.
  Applied to MCP the same rule gives the opposite answer: MCP's own extensions are
  `io.modelcontextprotocol/ui`, `/tasks` and `/oauth-client-credentials` — a slash after the prefix and
  hyphens in the name half. So this is `com.integraledger/legal-context`, one character from UCP's
  `com.integraledger.legal_context` and deliberately not the same string. Same deployment, same claim, two
  hosts, two spellings; that is the one-vocabulary property working rather than a collision.

  ⭐ **NO VERSION SEGMENT, AND THE CONTRAST WITH A2A IS THE REASON.** `A2A_LCP_EXTENSION_URI` carries `/v1`
  because A2A requires a NEW URI on a breaking change and forbids falling back. MCP versions the same event
  by requiring a new IDENTIFIER — a `-v2` suffix on the name half — and prefers capability flags or settings
  fields over a rename outright. Retrofitting `-v1` would invent a spelling the host does not use and would
  make every future non-breaking revision look like it owed an explanation.

  ⛔⛔ **THE RESERVED-NAMESPACE GUARD WAS A HAND-WRITTEN LIST, AND THIS EXPORT IS EXACTLY THE EDIT IT
  POLICES.** The test that holds `org.legalcontextprotocol.*` shut iterated five named constants — a set that
  stays exhaustive only until someone adds a sixth, and adding a sixth is the thing it exists to catch. It
  now derives its subjects from the module's own string exports, so a new wire identity is covered on the day
  it is written rather than when somebody remembers. Safe to derive here because the EXPECTATION stays a
  fixed literal: the tree supplies the subjects, never the rule they are judged against. **Proven with a
  planted sixth constant carrying the reserved namespace — the old list passed it, the derived guard fails
  it.**

  Three further canaries drive the new assertions red and the tree restores green: the UCP underscore
  smuggled into the MCP id, the dot form in place of the mandatory slash, and a retrofitted `-v1`.

  MCP reserves any prefix whose SECOND label is `modelcontextprotocol` or `mcp`, so `io.modelcontextprotocol/`,
  `dev.mcp/` and `com.mcp.tools/` are closed while `com.example.mcp/` is not. Ours is `integraledger`: the
  prefix is available on the host's own terms rather than by our forbearance.

  ⚠️ Nothing emits this yet. It is a constant with a specification behind it (the buyer-side repo's
  `2026-08-25-lcp-mcp-extension-specification.md`) and no declaration; wiring it into a server is a separate
  change against a re-pinned tree.

  - @integraledger/lcp-kernel@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-kernel@0.12.2

## 0.12.1

### Patch Changes

- @integraledger/lcp-kernel@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0

## 0.11.0

### Minor Changes

- 618ef2b: Publish the authority documents behind the capability's advertised URLs, and ship the index that says which
  documents exist.

  Four URLs are advertised under `integraledger.com/lcp/`: the UCP capability specification and its
  configuration schema, the A2A extension specification, and the x402 carrier schema. Two of the four had a
  document; the specification and the extension URLs had none, and every one of the four resolved to the
  marketing site's SPA index — HTTP 200, `text/html`, identical bytes, including for paths that do not exist.
  A counterparty that followed one got success and a document that was not the one advertised, which no
  absence check detects. The capability name is constant across deployments, so every seller advertising it
  advertised the same four URLs.

  The two prose specifications are now authored, at paths equal to the URLs that serve them. `authority/` ships
  with the package, so the worker that serves these URLs and the package that advertises them read one source.

  `AUTHORITY_DOCUMENTS` is the new export: one entry per advertised URL, naming the file that answers it and
  the media type it is served as. Schemas are `application/schema+json`, which is what `json-schema.org` serves
  its own meta-schemas as and what RFC 6839's `+json` suffix makes parseable as JSON; prose is
  `text/markdown; charset=utf-8`. Neither UCP nor A2A names a media type for these fetches.

- 822190a: Give the terms URL the write path the published set never had, and certify the composition that broke
  without it (integra-protocol#8).

  A third party assembling a seller from published parts emitted a 402 the published buyer refuses: every
  published reader demanded `legalContextUrl` and no published writer placed it, and the schema
  `placement-x402` inlined onto the wire (`required: ["type","value"]`, closed) contradicted the authority
  document integraledger.com serves (`required: ["type","value","legalContextUrl"]`, closed) — two
  definitions of one `info`, no document valid against both, each package self-consistent. Three structural
  gaps let it ship: the manifest's `termsUrlField` was singular and read-only (declared, hygiene-checked,
  never written — and x402's wire carries the URL in two slots, so one path could not even name the shape),
  nothing compared the inlined schema to the authority document, and the corpus certified `place` and
  `extract` separately but never fed one to the other.

  `binding-core` — the placement seam now moves an ADVERTISEMENT, not a bare reference. `place` takes
  `{ ref, termsUrl? }` and writes the URL at every slot the manifest's new `termsUrlFields` (plural,
  replacing `termsUrlField`) declares; it REFUSES an integrity-bearing advertisement with no URL where slots
  are declared (a hash no counterparty can resolve is unverifiable by construction), a URL where no slot
  exists (silent dropping is fail-open), and a non-https URL on either side of the seam. `extract` returns
  `{ ref, termsUrl }` with absence as a typed value — `no-field-declared` is a fact about the protocol,
  `declared-fields-empty` a fact about the document, and the gate decides what an absence means — while two
  slots that disagree, or a malformed value in either, refuse. The object-path writer learned to descend
  into an EXISTING array element (never minting one, never extending a list, refusing an index segment it
  would have to create), which is what lets x402's `accepts[0].extra` mirrors land.

  `placement-x402` — the inlined wire schema now IS the authority document minus `$id` and `$defs`
  (Bazaar forbids both on the wire), drift-gated in `lcp-conformance` where the two packages meet.
  `termsUrlFields` declares both slots the wire carries; the bare-hash alias is written (`extra` stopped
  being wholly scheme-private when x402 §6.1 reserved names inside it, and LCP v1.38 §C.4's own Tier A
  illustration carries the pair there); the `url` carrier admission is withdrawn (`carrierTypes` is
  `sha256` alone — the schema on the wire is `const: "sha256"`, and no shipped reader ever accepted a url
  in this slot). The `place` override shrinks to composition: the kit performs the whole placement and the
  override adds only the `{info, schema}` wrapper.

  `placement-mpp` / `placement-acp` — the singular member becomes the one-entry `termsUrlFields`; the kit
  now writes the slot their buyer parsers always demanded and refuses first at the seller.

  `lcp-conformance` — the corpus grows 812 → 844: a `roundtrip` op (place then extract in one case, the
  composition certification whose absence let two separately-conformant halves ship jointly broken),
  advertisement-rule refusals for every manifest, and the authority↔wire drift gate. Extract expectations
  across every placement area become the extracted advertisement.

  `lcp-verify` — `referencePlacementStep` reads the advertisement (`extracted.ref.value`) and deliberately
  ignores `termsUrl`: where the terms live is the gate's fetch concern, not a fact the record can
  contradict.

  `lcp-discovery` — the x402 authority document restates the atrHash pattern inline in both definitions
  (no `$defs` indirection the wire copy would have to rewrite) and moves the two-definitions rationale into
  `$defs.receipt`, so the challenge-time root is byte-derivable for the wire.

### Patch Changes

- b2ffecc: Report the class a record actually supports, place a terms URL on UCP, and stop refusing a conformant UCP
  profile — the remediation of the 2026-08-19 conformance re-audit.

  **`verify` now computes `supportedClass` instead of echoing the claim.** It was `anyFailed ? "TC-0" :
claimedClass`, so a record proving nothing — no settlement, no acceptance, no authority chain — reported
  whatever class the caller named, while the field's own published docblock promised "what the record
  honestly supports, not what the caller asked for". It is now the highest class every one of whose required
  steps is `proved`, `TC-0` on any failure, computed from the steps alone: neither capped by the claim (rungs
  that reach TC-3 read TC-3 where the caller claimed TC-2) nor lifted by it. White paper #4 §5 defines the
  class of a transaction as "the highest class whose criteria it fully meets", and this is that.

  The claim is not discarded — the report gains **`claimedClass`**, a required member, because `verified`
  answers "did the record reach the class it claimed?" and cannot be read without it. The two fields are the
  report's two halves: an input echoed, and a finding computed. Where they differ, the record did not reach
  its own shape. An out-of-taxonomy claim now lands only in the echo and can no longer masquerade as a
  finding.

  **UCP can advertise a terms URL.** Its policy object declares `url` — "Optional link to the full policy
  document", `format: uri` — on the very entry this placement writes, and §C.3's illustration carries `url`
  and `atrHash` side by side there. The manifest previously said the protocol had no slot, citing `links[]`,
  which §C.3 separates as "a standing page, not a per-transaction record". The obstacle was mechanical:
  `termsUrlFields` addresses document paths, and a tagged-array entry's index is chosen at write time. The
  `tagged-array` container therefore gains `termsUrlField`, written onto the same entry in the same write, and
  read back through the same first-match rule. UCP was the last shipped protocol that refused an
  advertisement carrying its own locator (integra-protocol#8).

  **`readUcpProfile` no longer refuses a conformant business profile.** `requireHttps` mapped an ABSENT `spec`
  to the same branch as a malformed one, and the live host requires `spec` only of a platform declaration —
  as this repository's own README already said. It is now `requireHttpsIfDeclared`: absence is absence, and a
  declared value is still held to the host's https MUST.

  Also: `requireWritten` replaces an unchecked cast in the x402 override, so a broken postcondition throws
  instead of returning a success carrying no document; six x402 citations move to the revision that actually
  touches the file they name, and a new gate refuses any `owner/repo@sha` in source that `spec-pins.json` does
  not record; four spec citations move from line anchors to section anchors; the escrow binding states why it
  declares no §8.3.1 off-canonical variant, and asserts it; and §C.3's `policies[]` illustration is recorded as
  invalid against the live UCP schema, which shows `description` as a bare string where the host requires an
  object — owed upstream, not a defect here.

  Corpus 844 → 847, root `ec4ad1b02a81538b…`.

  - @integraledger/lcp-kernel@0.11.0

## 0.10.1

**0.10.0 was staged and withdrawn before approval; this is that release, re-cut.** The conformance corpus
was re-sealed after 0.10.0 was staged — its root moved `32fa90a6…` → `28bbf4ef…` when the vector tree was
brought inside the prose gates — so the staged `lcp-conformance` tarball carried a seal that no longer
matched the repository. The seal is what proves corpus authenticity to an independent implementer, and a
published version cannot be replaced, so the whole set was rejected and re-cut rather than shipping one
package that disagreed with its own source. No version 0.10.0 exists on the registry.

### Minor Changes

- 3f2d2e3: **Breaking, two wire identities and one exported name.**

  `LCP_CAPABILITY_NAME` is now `com.integraledger.legal_context` (was `com.integraledger.legal-context`), and
  `LCP_TERMS_HASH_SUFFIX` is now `lcp_terms_hash` (was `lcp-terms-hash`). Both go on a counterparty's wire, and
  both were hyphenated where the host they are written into spells its own vocabulary with underscores
  throughout — UCP (`dev.ucp.shopping.checkout`, `com.example.policy.price_match`) and Verifiable Intent (all
  eight registered constraint types). Our own UCP `policies[]` carrier already used underscores, so one
  deployment identity was spelled two ways. No host forces either spelling, which is why the house had to rule
  it: **follow the vocabulary you are writing into.** `LEGAL_CONTEXT_WELL_KNOWN_PATH` keeps its hyphen for the
  same reason — RFC 8615 well-known names are hyphenated.

  `VISA_TAP_PLACEMENT_TIER_A` is renamed `VISA_TAP_PLACEMENT`, matching every sibling placement. The tier is a
  manifest field because it can move; an identifier carrying the answer could only be corrected by a breaking
  rename, which is the hazard `placement-mastercard-vi` states as `tier: "B"` IS A LABEL, NOT A GATE.

  The conformance corpus is re-sealed: root `32fa90a62eb83930…`, 812/812 across 44 areas, unchanged in size.
  Twenty-two cases pinned the old spellings and were updated; the retired spelling survives deliberately in
  `binding-core`'s kit fixtures, where it is sample input to container-validation cases cut against v1.37
  §C.3's `extensions` shape and asserts nothing about this deployment's identity.

  `minor` rather than `major` because these packages are pre-1.0, where minor is the breaking increment.

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
