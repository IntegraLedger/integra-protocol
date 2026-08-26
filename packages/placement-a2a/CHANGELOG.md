# @integraledger/lcp-placement-a2a

## 0.12.3

### Patch Changes

- @integraledger/lcp-binding-core@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-binding-core@0.12.2

## 0.12.1

### Patch Changes

- @integraledger/lcp-binding-core@0.12.1

## 0.12.0

### Patch Changes

- @integraledger/lcp-binding-core@0.12.0

## 0.11.0

### Minor Changes

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

- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-binding-core@0.11.0

## 0.10.1

**0.10.0 was staged and withdrawn before approval; this is that release, re-cut.** The conformance corpus
was re-sealed after 0.10.0 was staged — its root moved `32fa90a6…` → `28bbf4ef…` when the vector tree was
brought inside the prose gates — so the staged `lcp-conformance` tarball carried a seal that no longer
matched the repository. The seal is what proves corpus authenticity to an independent implementer, and a
published version cannot be replaced, so the whole set was rejected and re-cut rather than shipping one
package that disagreed with its own source. No version 0.10.0 exists on the registry.

Released as part of a flat `0.10.1` across the whole suite. One number describes the set that was built,
tested and sealed together, so a consumer never has to work out which combination of versions was verified.

This package has no source change of its own in this release. What moved across the suite: three exported
names were corrected before anyone depends on them — `USDC_DECIMALS` became rail-qualified after it was
found to mean 6 on three rails and 7 on Stellar under one name, `VISA_TAP_PLACEMENT_TIER_A` lost the tier
it had baked into an identifier, and the memo codecs were named for the carrier they encode. Two wire
identities were respelled to match the vocabulary they are written into. Five gates were added or widened,
and a large number of documentation claims were corrected against the host specifications at HEAD.

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
