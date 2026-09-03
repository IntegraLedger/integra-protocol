# @integraledger/lcp-kernel

## 0.15.0

### Minor Changes

- 42fb196: The ATR's type is named `Atr`, its bytes `atrBytes`, and one assembly input a `Slot`. The format version is
  stamped as `atr` rather than `lcp`, which collided with the specification's own version line.
  
  BREAKING for consumers: `Envelope` → `Atr`, `AtrFile`/`atrFile` → `AtrBytes`/`atrBytes`,
  `Component` → `Slot`, refusal code `assemble/component-shape` → `assemble/slot-shape`, and an assembled ATR's
  first member is now `"atr": "0.3"`. Every derived digest moves with that first member; the corpus areas
  `envelope.assemble` and `envelope.schema` are now `atr.assemble` and `atr.schema`, every pinned vector hash
  was re-derived independently with its superseded value recorded, and `verify`'s recourse step recognises a
  kernel-assembled ATR by the new member. "Envelope" is reserved for what carries a record — the AP2 transport
  envelope, the EIP-712 acceptance envelope — and names nothing the kernel mints.

## 0.14.0

### Minor Changes

- aca5978: 0.14.0 — four runtime dependency pins move, one of them a major, and they must ship deliberately.
  
  ⛔⛔ **FOUR DEPENDENCY COMMITS LANDED WITH NO CHANGESET, AND THAT IS THE HAZARD THIS ONE EXISTS TO REMOVE.**
  `920325c`, `031ffd4`, `ae5df9a` and `fb9514d` moved the catalog and `.changeset/` held only `config.json`
  afterwards. The bindings declare these as `catalog:`, so they become **published, exact dependency pins**
  the moment anything is released — which means whatever changeset landed next would have carried them out
  at ITS bump level. A patch-level changeset would have shipped a major dependency change as a patch.
  
  **What actually changes on the published surface** — measured against what `0.13.0` declares, not narrated:
  
  | package | `0.13.0` declares | `0.14.0` will declare |
  |---|---|---|
  | `lcp-binding-stellar` | `@stellar/stellar-sdk` **16.2.0** | **17.0.0** — a MAJOR |
  | `lcp-binding-evm-common` | `viem` 2.55.11 | 2.55.19 |
  | `lcp-binding-sui` | `@mysten/sui` 2.23.2 | 2.26.2 |
  | `lcp-binding-aptos` | `@aptos-labs/ts-sdk` 7.2.0 | 7.3.0 |
  
  ⭐ **MINOR, because on a `0.x` line that is the breaking level.** A consumer's tree cannot hold two copies
  of these: `viem`'s client type is structural, and a `PublicClient` built from one copy is not assignable to
  a parameter typed against the other — measured in both directions, so it is not a question of which is
  newer. `@stellar/stellar-sdk` 16 → 17 is a major on the same footing.
  
  ⚠️ **`ripple-binary-codec` and `vitest` also moved and are NOT part of this surface.** `binding-xrpl`
  declares no third-party runtime dependency — the ripple packages are dev-only, the opt-in integration lane
  — so neither reaches a published manifest. Stated because the catalog diff shows six entries and only four
  of them are the reason for the bump.
  
  ⛔ **Consumers repin protocol and these four in ONE commit.** `integra-agentic-commerce` pins `viem`
  through its own catalog under a comment that reads *"MUST equal the protocol repo's catalog pin"*, and its
  `protocol-integration` gate — which compiles against this repo's UNRELEASED source — went red the hour
  after `920325c` and stayed red across five of its own unrelated commits. That gate is the reason this
  changeset is deliberate rather than incidental: it put the discovery before the irreversible act, which is
  its stated job.

## 0.13.0

## 0.12.3

## 0.12.2

## 0.12.1

## 0.12.0

### Minor Changes

- Release the protocol as ONE line: every publishable package now versions in lockstep.

  `fixed` covered `kernel`, `binding-core` and `verify` and left the other twenty-eight to bump per
  changeset. The first release under that arrangement cut two lines at once — `0.11.0` for the packages a
  changeset touched, `0.10.2` for the rest — and the two are not independently meaningful. These packages ship
  from one commit, are certified as a set by one conformance corpus, and are only ever installed together; a
  consumer cannot pair `verify@0.11.0` with `binding-xrpl@0.10.1`, because that combination was never built or
  tested. Per-package numbers therefore conveyed no independence a consumer could use, and did convey a
  choice they should never make.

  They also broke the downstream check that exists to stop exactly this class of defect. The product repo
  refuses a tree declaring more than one protocol line — a gate written after both halves of the product
  shipped green and did not interoperate — and a mixed release makes that gate unsatisfiable by any correct
  pin set.

  So the group is now every `@integraledger/lcp-*` package, and one version identifies the line. The private
  `lcp-rail-invariants` is unaffected: changesets does not version private packages.

## 0.11.0

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
