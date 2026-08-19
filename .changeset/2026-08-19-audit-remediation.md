---
"@integraledger/lcp-verify": minor
"@integraledger/lcp-binding-core": minor
"@integraledger/lcp-placement-ucp": minor
"@integraledger/lcp-placement-x402": patch
"@integraledger/lcp-placement-mastercard-vi": patch
"@integraledger/lcp-discovery": patch
"@integraledger/lcp-binding-evm-escrow": patch
"@integraledger/lcp-binding-evm-x402": patch
"@integraledger/lcp-binding-evm-mpp": patch
"@integraledger/lcp-conformance": minor
---

Report the class a record actually supports, place a terms URL on UCP, and stop refusing a conformant UCP
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
