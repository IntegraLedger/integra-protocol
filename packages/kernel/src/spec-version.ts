/**
 * THE LCP SPECIFICATION VERSION THIS IMPLEMENTATION TARGETS — one literal, for every surface that stamps it.
 *
 * FIVE surfaces stamp it and none of them may hold its own copy: `binding-cardano` (written on-chain as
 * the metadatum `v`), `discovery`'s schema `$id` and its description string — both DERIVED from this
 * constant rather than copied — and the two data files, `vectors/legal-context/schema.json` and
 * `vectors/binding/cardano-metadatum.json`, which carry it literally because JSON cannot import.
 * Nothing tied them together, so they drifted — all of them sat at
 * `0.1.36` after every other package had reconciled to v1.37, and no surface said whether that was a
 * deliberate pin or an oversight. Four copies of one fact is the defect; bumping four copies would only
 * have reset the clock on it.
 *
 * WHAT IT MEANS, precisely: the version of the specification whose **§2 conformance surface** this
 * implementation is written against. It is NOT a build number and NOT the version of any package — those
 * move independently and often. It moves when §2 moves, and it also moves to record that this
 * implementation has been re-checked against a newer revision, which is the more common case: v1.37 was a
 * corrections release whose §2 was byte-identical to v1.36.
 *
 * v0.1.38 is likewise a corrections release. §2 — the whole conformance surface — is byte-identical to
 * v0.1.37 except the `atrHash` row, which gains a RECOMMENDED (emit lowercase) and a MUST (compare the
 * decoded bytes, not the strings). Everything else that moved is Appendix C, which is informative. The bump
 * records the revision this tree is measured against; the two §2 additions are implemented in `discovery`,
 * `binding-core` and `atrHashEquals` rather than here.
 *
 * The ATR's own format version is stamped separately by assemble() as `atrVersion` — the wire format of the
 * document, versioned on its own clock. The two stay distinct.
 *
 * It lives in `kernel` because kernel is zero-dependency and every package that stamps the version already
 * depends on it. A constant this widely consumed cannot sit in a leaf package without inverting the tiers.
 *
 * Data files cannot import it. `vectors/legal-context/schema.json` and `vectors/binding/cardano-metadatum.json`
 * carry the string literally, so the repository's spec-version drift gate asserts they equal this constant — the same
 * shape as the manifest drift checks elsewhere in the tree. Change this value and those tests name the files
 * that have not followed.
 */
export const LCP_SPEC_VERSION = "0.1.38";
