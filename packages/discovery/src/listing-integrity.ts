import { atrHashEquals, hashAtr } from "@integraledger/lcp-kernel";
import {
  isMachineReadableTermsFormat,
  type LegalContextJson,
} from "./schema.js";

/** The DSC-2 readout on a discovery listing. **Read the individual fields, not just `ok`** — `ok` is the
 *  conservative composite (hashes agree AND the format is machine-readable), so a `false` may mean the
 *  hash mismatched or merely that the terms are a PDF. Those are different facts about a seller, and
 *  collapsing them once produced a recorded hash mismatch for a document whose hash matched. */
export interface ListingIntegrityResult {
  /**
   * The conservative composite: the hashes agree AND the format is machine-readable. Kept as the single
   * field a caller can gate on without reading the rest.
   */
  readonly ok: boolean;
  readonly status: "ok" | "mismatch" | "listing-format-not-machine-readable";
  /**
   * DID THE SERVED BYTES HASH TO THE ADVERTISED FINGERPRINT — the DSC-2 question, answered independently
   * of the format gate and ALWAYS populated.
   *
   * It exists because `status` cannot carry two facts. A `pdf` listing whose terms hash correctly used to
   * report only `listing-format-not-machine-readable`, and a consumer folding every non-`ok` status into
   * one bucket then recorded a hash MISMATCH for a document whose hash matched — a false statement about
   * the seller's terms, made by a stack whose job is to record accurately. The two questions are
   * genuinely separate: whether the bytes are the advertised bytes, and whether the format is one this
   * deployment will accept. Report both; let the caller compose them.
   */
  readonly hashesMatch: boolean;
  /** Whether the listing's declared `termsFormat` is one this stack treats as machine-readable. */
  readonly machineReadable: boolean;
  readonly servedAtrHash: `0x${string}`;
  readonly advertisedAtrHash: `0x${string}`;
  readonly detail: string;
}

/**
 * DSC-2: the terms the listing points at, when actually served, MUST hash to the atrHash the seller
 * advertises at transaction time. `listing` is an already-parsed (DSC-1-conformant) LegalContextJson.
 *
 * **THE FORMAT GATE IS STRICTER THAN LCP §2, DELIBERATELY, AND IS NOT AN LCP CONFORMANCE RULE.** LCP §2.3
 * says the file format does not matter for conformance and §2.5 lists `"pdf"` and `"html"` among the known
 * `termsFormat` values — so an LCP-conformant listing may declare either, and refusing them here is a
 * product decision this stack makes, not a rule the protocol imposes. It implements the white paper's DSC-2
 * marketplace requirement: a deployment that must mechanically compare terms cannot act on a format it
 * cannot parse, so it declines rather than pretending to have checked.
 *
 * The distinction is load-bearing and must survive: nothing here may be presented as LCP conformance, or an
 * independent implementation would be told it fails a requirement the specification does not contain. That
 * is also why these vectors sit OUTSIDE the conformance corpus — `vectors/discovery/listing-integrity.json`
 * is a unit-level file, deliberately unregistered in the corpus manifest.
 */
export async function checkListingIntegrity(
  listing: LegalContextJson,
  servedTermsBytes: Uint8Array,
  advertisedAtrHash: `0x${string}`,
): Promise<ListingIntegrityResult> {
  const servedAtrHash = (await hashAtr(servedTermsBytes)) as `0x${string}`;
  // Both facts are established before either is reported, so neither can mask the other. The comparison
  // is over DECODED BYTES per LCP §2.5, so the two any-case spellings of one hash agree and a malformed
  // advertised value answers `false` instead of matching some equally malformed served one.
  const hashesMatch = atrHashEquals(servedAtrHash, advertisedAtrHash);
  const machineReadable =
    listing.termsFormat === undefined ||
    isMachineReadableTermsFormat(listing.termsFormat);

  if (!machineReadable)
    return {
      ok: false,
      status: "listing-format-not-machine-readable",
      hashesMatch,
      machineReadable,
      servedAtrHash,
      advertisedAtrHash,
      // The format is the refusal, but the hash verdict is stated too — an operator reading this needs to
      // know whether the terms were also wrong, and the old message could not tell them.
      detail: `listing declares non-machine-readable termsFormat "${listing.termsFormat}" (served terms ${
        hashesMatch ? "DO" : "do NOT"
      } match the advertised fingerprint)`,
    };
  return {
    ok: hashesMatch,
    status: hashesMatch ? "ok" : "mismatch",
    hashesMatch,
    machineReadable,
    servedAtrHash,
    advertisedAtrHash,
    detail: hashesMatch
      ? "served terms match the advertised fingerprint (DSC-2)"
      : "served terms do NOT match the advertised fingerprint",
  };
}
