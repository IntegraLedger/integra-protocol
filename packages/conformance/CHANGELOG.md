# @integraledger/lcp-conformance

## 0.15.1

### Patch Changes

- 83ae16e: 0.15.0 shipped with `atrVersion` as the assembled ATR's first member; its 0.15.0 changelog entry, written
  before that rename landed, names `atr`. This entry corrects the record: from 0.15.0 the first member is
  `atrVersion`.
  
  An assembled ATR's first member is `"atrVersion": "0.3"`, not `"atr": "0.3"`. No published release ever
  emitted `"atr"` as the first member — 0.15.0's code already stamped `atrVersion`, and only its changelog
  entry named the earlier spelling.
  
  Why: a version field names what it versions. `"atr": "0.3"` names the artifact, and a reader can take it
  for an identifier; `"atrVersion": "0.3"` is unmistakable on the wire. The bare `atr` was the only stamped
  name that needed that sentence to be read correctly.
  
  BREAKING for consumers: the `Atr` type's first member is `atrVersion`, `assemble` refuses a caller slot
  named `atrVersion` with `assemble/reserved-slot`, `verify`'s recourse step recognises a kernel-assembled
  ATR by that member, and every derived digest moves with it — every pinned vector hash was re-derived
  independently and its superseded values recorded, and the corpus root moved with them.
- 9c42f73: `assemble` refuses the slot names `lcp` and `atr` with `assemble/reserved-slot`, beside the `atrVersion`
  refusal it already made. `lcp` names the specification, and bare on the wire it is ambiguous between a
  version, a reference and a label; `atr` names the record itself. A profile that records the specification
  version it targets uses an ordinary, clearly named slot — `lcpVersion` — which stays open.
  
  The corpus gains four `atr.assemble` cases: `atrVersion` as a caller's slot refused, which the kernel had
  done since the member existed and the corpus had never pinned; `lcp` refused; `atr` refused; and
  `lcpVersion` preserved verbatim, so the openness is pinned rather than inherited. 848 → 852 cases; the
  corpus root moved.
- e959bf3: Three verification steps proved a rung over a slot they could not read. Each is now shape-screened on the
  rule a sibling step in the same file already applied, so `steps.ts`'s own capitalised rule — ABSENT INPUTS
  NEVER PROVE — holds for the untyped caller these steps exist for.
  
  - `authorityStep` read `parentDelegable` for TRUTHINESS. ATA-3 gate one asks whether the parent was
    permitted to delegate at all, and every non-boolean but `0` and `""` cleared it: the strings `"false"`,
    `"no"` and `"0"`, an empty array, an empty object. It is now type-screened exactly as `revoked` and
    `active` are beside it, and as `authority.walkableGrant` screens `delegable` on the producing side — a
    non-boolean is `not-attempted("malformed-authority-chain")`. An ABSENT flag is unchanged and still
    `failed`: ATA-3 fixes a restrictive default, which is a ruling rather than a gap.
  - `settlementStep` read `.length` on whatever the slot held. `.length` is `undefined` on an object, a
    number and a boolean, and `undefined === 0` is false, so `{}`, `42`, `true`, `"abc"` and the duck-typed
    `{ length: 5 }` all reached `proved` with zero settlements enumerated — on the rung that carries TC-1. A
    non-array is now `not-attempted("no-enumeration-port")`, the same token an absent slot gets and the same
    ruling `authorityStep` makes on a non-array chain.
  - `commitmentStep` screened its two bounds halves with `typeof !== "object"`, which admits an array.
    `Object.keys([])` answers `[]`, so `isWithin` read an array as a bounds with no dimensions — unbounded —
    and skipped all four ATA-2 gates: a $50M commitment cleared ATA-4 containment against a leaf grant that
    was never readable. Both halves now go through `boundsShaped`, the screen written for this and never
    carried here. An empty-object leaf still PROVES, which is correct — an absent dimension is unbounded.
  
  The corpus gains four `verify.authorityWalk` cases: three non-boolean `parentDelegable` shapes, and a
  control pinning that an absent flag still fails rather than joining them as a gap. 852 → 856 cases; the
  corpus root moved.
  
  `verify`'s totality property was asserting only that the walk returns a boolean and a class inside the
  ladder, which a walk that proves every rung over nonsense also satisfies — that is what hid the settlement
  defect through 500 runs a time. It now also asserts that a step handed a slot it cannot read never answers
  `proved`.
- 2959833: `verify()` was not total: two slots reached a primitive that raises, so a malformed record became a
  `TypeError` at the callsite instead of a report. `steps.ts` states the opposite in capitals — EVERY STEP
  IS TOTAL, "because the callers they exist for are untyped", and "a walk that throws cannot report the
  malformation it was handed".
  
  - `fingerprintStep` handed `atrBytes` to `SubtleCrypto.digest`, which does its own type check and throws.
    A JSON-decoded byte array — what an HTTP intake produces for `{"atrBytes":[123,34,97,125]}`, the live
    path — an object, a number, a string and a boolean all raised. A slot that is not a `BufferSource` now
    reads `not-attempted("malformed-atr-bytes")`. Not `indeterminate`: that says the ATR could not be
    retrieved, and here something was supplied.
  - `recourseStep` handed `evidenceRoles` to `new Set`, which throws on a non-iterable — and a STRING, which
    IS iterable, quietly became a package of one role per character, so `"atr"` read as `a`, `t`, `r`. A
    non-array now reads `not-attempted("no-evidence-package")`, the token an absent slot gets. A real empty
    array is untouched and still `evidence-package-incomplete`: supplied and short is not absent.
  
  Both are reachable only past a SECOND slot — `fingerprintStep` returns `indeterminate` before hashing
  unless a settled hash is also present, `recourseStep` stops at four earlier guards unless the ATR parses
  and carries both elections — which is why neither had a case.
  
  The corpus gains three `verify.recourse` cases. 856 → 859; the corpus root moved.
  
  The property test whose title is "never throws, whatever shape the caller supplies" had **no `atrBytes`
  key in its generator at all**, so every one of its 500 runs short-circuited at the first guard of both
  steps. A generator that omits a slot is not a weak oracle; nothing downstream of the omission is under
  test. It now generates `atrBytes` and `settledAtrHash` — real bytes, a real ATR, and the untyped shapes
  including the JSON byte array — and both throws reproduce from it.
- Updated dependencies [83ae16e]
- Updated dependencies [431b8ec]
- Updated dependencies [9c42f73]
- Updated dependencies [e959bf3]
- Updated dependencies [2959833]
  - @integraledger/lcp-kernel@0.15.1
  - @integraledger/lcp-verify@0.15.1
  - @integraledger/lcp-binding-core@0.15.1
  - @integraledger/lcp-authority@0.15.1
  - @integraledger/lcp-discovery@0.15.1
  - @integraledger/lcp-evidence@0.15.1
  - @integraledger/lcp-placement-x402@0.15.1
  - @integraledger/lcp-placements@0.15.1

## 0.15.0

### Minor Changes

- 42fb196: The ATR's type is named `Atr`, its bytes `atrBytes`, and one assembly input a `Slot`. The format version is
  stamped as `atrVersion` rather than `lcp`, which collided with the specification's own version line.
  
  BREAKING for consumers: `Envelope` → `Atr`, `AtrFile`/`atrFile` → `AtrBytes`/`atrBytes`,
  `Component` → `Slot`, refusal code `assemble/component-shape` → `assemble/slot-shape`, and an assembled ATR's
  first member is now `"atrVersion": "0.3"`. Every derived digest moves with that first member; the corpus areas
  `envelope.assemble` and `envelope.schema` are now `atr.assemble` and `atr.schema`, every pinned vector hash
  was re-derived independently with its superseded value recorded, and `verify`'s recourse step recognises a
  kernel-assembled ATR by the new member. "Envelope" is reserved for what carries a record — the AP2 transport
  envelope, the EIP-712 acceptance envelope — and names nothing the kernel mints.
  
  ⚠️ CORRECTED AFTER PUBLISH — the registry's copy of this entry says `atr` in both places above. It was
  generated from a changeset that named the member `atr`, and the rename to `atrVersion` landed before the
  release was approved. The published CODE has only ever stamped `atrVersion`, so no record in use has ever
  carried `"atr"`: the tarball's text was wrong on the day it shipped rather than overtaken afterwards. An
  npm version is immutable, so that copy stands and this one is the correct account.

### Patch Changes

- 49431e0: Correct a conformance vector that attributed LCP v1.37's withdrawn RFC-2119 capitals to the x402
  specification itself.
  
  `vectors/placement/x402.json`'s sibling-extension case was named *"clients MUST NOT delete or overwrite"*
  and its `$comment` called that "x402's own rule about x402's own map". Neither half survives measurement.
  The host states the rule in lower case and about the DATA rather than the map — the client "must include at
  least the info received; it may append additional info but cannot delete or overwrite existing info" — and
  `placement-x402`'s own README already records that v1.37 rendered it in capitals and that **v1.38 §C.4
  withdrew that rendering**. So the package documentation and the shipped corpus disagreed about a
  quotation, with the corpus carrying the superseded one into every consumer that reads the vectors.
  
  The case now quotes the host verbatim and names the revision that changed. Behaviour is unchanged: only the
  case name and its comment move, so the corpus counts hold at 44 areas / 847 cases / 82 files and only the
  seal root moves.
  
  Also adds `scorecard.yml`, which ran in the sibling public repository and not here — this repository
  publishes thirty-one packages to that one's two — and a standing rule in `CLAUDE.md` that everything
  written here is world-readable, which was stated only about commit history.
- Updated dependencies [42fb196]
  - @integraledger/lcp-kernel@0.15.0
  - @integraledger/lcp-verify@0.15.0
  - @integraledger/lcp-authority@0.15.0
  - @integraledger/lcp-binding-core@0.15.0
  - @integraledger/lcp-discovery@0.15.0
  - @integraledger/lcp-evidence@0.15.0
  - @integraledger/lcp-placement-x402@0.15.0
  - @integraledger/lcp-placements@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [aca5978]
  - @integraledger/lcp-kernel@0.14.0
  - @integraledger/lcp-authority@0.14.0
  - @integraledger/lcp-binding-core@0.14.0
  - @integraledger/lcp-discovery@0.14.0
  - @integraledger/lcp-evidence@0.14.0
  - @integraledger/lcp-verify@0.14.0
  - @integraledger/lcp-placement-x402@0.14.0
  - @integraledger/lcp-placements@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-discovery@0.13.0
  - @integraledger/lcp-authority@0.13.0
  - @integraledger/lcp-binding-core@0.13.0
  - @integraledger/lcp-evidence@0.13.0
  - @integraledger/lcp-kernel@0.13.0
  - @integraledger/lcp-placement-x402@0.13.0
  - @integraledger/lcp-placements@0.13.0
  - @integraledger/lcp-verify@0.13.0

## 0.12.3

### Patch Changes

- Updated dependencies [e34ea79]
  - @integraledger/lcp-discovery@0.12.3
  - @integraledger/lcp-authority@0.12.3
  - @integraledger/lcp-binding-core@0.12.3
  - @integraledger/lcp-evidence@0.12.3
  - @integraledger/lcp-kernel@0.12.3
  - @integraledger/lcp-placement-x402@0.12.3
  - @integraledger/lcp-placements@0.12.3
  - @integraledger/lcp-verify@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-authority@0.12.2
- @integraledger/lcp-binding-core@0.12.2
- @integraledger/lcp-discovery@0.12.2
- @integraledger/lcp-evidence@0.12.2
- @integraledger/lcp-kernel@0.12.2
- @integraledger/lcp-placement-x402@0.12.2
- @integraledger/lcp-placements@0.12.2
- @integraledger/lcp-verify@0.12.2

## 0.12.1

### Patch Changes

- 353352f: MPP-EVM: the §8.3.5 discharge is not checked in this package, and the profile said it was

  `MPP_EVM_MANIFEST`'s finality note read _"The tree checks it as OFR — `offerBoundStep`, required at TC-4"_
  about the §8.3.5 discharge, which per LCP §C.1 rests on the ATR **stating the transaction parameters**.
  `offerBoundStep` is, in full, `c?.offerBound ? proved : not-attempted("no-offer")` — one boolean off the
  composition slot. It never sees an ATR and cannot establish anything about what the hashed document states.

  That claim is published: it ships in `vectors/binding/mpp-evm-profile.json` and the `binding.profiles`
  corpus case, where a stranger's auditor reads it as a check this software performs.

  The note now says what is true — that nothing in this package establishes the discharge and no verifier
  reading the wire alone can, because whether the ATR states the parameters is a property of the bytes the
  seller hashed, checkable only against the ATR itself. It names `offerBoundStep` explicitly as the thing
  sometimes mistaken for it, and says what that step actually reports.

  `offerBoundStep`'s contract is now pinned beside the step in `verify`'s own suite: it proves on the flag
  alone with every field of the charge absent, and an unbound offer is incompleteness rather than a failure.
  A future change that made it a real parameter check fails that test and forces the profiles describing it to
  be revisited.

  ⚠️ No behaviour changes. The corpus root moves because the profile document is part of the sealed corpus.

  - @integraledger/lcp-authority@0.12.1
  - @integraledger/lcp-binding-core@0.12.1
  - @integraledger/lcp-discovery@0.12.1
  - @integraledger/lcp-evidence@0.12.1
  - @integraledger/lcp-kernel@0.12.1
  - @integraledger/lcp-placement-x402@0.12.1
  - @integraledger/lcp-placements@0.12.1
  - @integraledger/lcp-verify@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0
  - @integraledger/lcp-authority@0.12.0
  - @integraledger/lcp-binding-core@0.12.0
  - @integraledger/lcp-discovery@0.12.0
  - @integraledger/lcp-evidence@0.12.0
  - @integraledger/lcp-verify@0.12.0
  - @integraledger/lcp-placement-x402@0.12.0
  - @integraledger/lcp-placements@0.12.0

## 0.11.0

### Minor Changes

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

- Updated dependencies [618ef2b]
- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-discovery@0.11.0
  - @integraledger/lcp-verify@0.11.0
  - @integraledger/lcp-binding-core@0.11.0
  - @integraledger/lcp-placement-x402@0.11.0
  - @integraledger/lcp-placements@0.11.0
  - @integraledger/lcp-authority@0.10.2
  - @integraledger/lcp-evidence@0.10.2
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

### Patch Changes

- Updated dependencies [3f2d2e3]
  - @integraledger/lcp-discovery@0.10.0
  - @integraledger/lcp-placements@0.9.1

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
