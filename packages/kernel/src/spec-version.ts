/**
 * THE LCP SPECIFICATION EDITION THIS IMPLEMENTATION TARGETS — one literal, for every surface that stamps it.
 *
 * ⛔⛔ **IT IS THE PUBLISHED EDITION, AND IT MUST NEVER AGAIN BE A PRIVATE REVISION NUMBER.** This constant
 * carried one until 2026-09-07 — a number from a working series no reader of the specification can
 * resolve, and which a public package has no business publishing. The specification
 * is published at `github.com/legal-context-protocol/legal-context-protocol` and its header says
 * **Version: 1.0**. That is the only version an implementation can honestly claim to target, because it is
 * the only one a counterparty can go and read.
 *
 * ⚠️ **The old value was not merely private, it was BROKEN.** `discovery` derives its schema `$id` from
 * this constant, so every discovery document this library produced carried
 * that private number in its schema URL — measured 2026-09-07: a **404**, at every value the constant had
 * ever held. The `$id` is now the canonical one
 * the specification itself publishes, which is UNVERSIONED and returns 200; see `discovery/src/schema.ts`.
 *
 * WHAT IT MEANS, precisely: the edition of the specification whose **§2 conformance surface** this
 * implementation is written against. It is NOT a build number and NOT the version of any package — those
 * move independently and often. It moves when the published edition moves.
 *
 * ⭐ **Re-measured against the published text on 2026-09-07, and §2 carries what this tree implements.**
 * The `atrHash` row states both rules this implementation was built to: *"lowercase hex is RECOMMENDED for
 * emission"*, and *"Two `atrHash` values are equal when their decoded 32-byte values are equal, so
 * implementations MUST compare the decoded bytes rather than the strings."* Those are implemented in
 * `discovery`, `binding-core` and `atrHashEquals` rather than here.
 *
 * The ATR's own format version is stamped separately by assemble() as `atrVersion` — the wire format of the
 * document, versioned on its own clock. The two stay distinct.
 *
 * It lives in `kernel` because kernel is zero-dependency and every package that stamps the version already
 * depends on it. A constant this widely consumed cannot sit in a leaf package without inverting the tiers.
 *
 * Data files cannot import it. `vectors/legal-context/schema.json` and `vectors/binding/cardano-metadatum.json`
 * carry the string literally, so `scripts/spec-drift.mjs` asserts they equal this constant. Change this value
 * and that gate names the files that have not followed.
 */
export const LCP_SPEC_VERSION = "1.0";
