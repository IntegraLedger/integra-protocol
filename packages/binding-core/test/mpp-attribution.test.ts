/**
 * The shared MPP Attribution discriminator.
 *
 * `binding-hedera` and `binding-tempo-mpp` each exercise this through their own codecs, but a package's
 * mutation run only sees its OWN tests — so without this file the predicate that decides whether a 32-byte
 * value is a terms reference or MPP's attribution fingerprint would sit in the seam with no coverage of its
 * own, and a mutant that broke it for both rails would be caught only downstream, if at all.
 */
import { describe, expect, it } from "vitest";
import {
  isMppAttributionValue,
  MPP_ATTRIBUTION_TAG,
  MPP_ATTRIBUTION_VERSION,
} from "../src/mpp-attribution.js";

/** A well-formed attribution memo: TAG(4) ‖ VERSION(1) ‖ 27 bytes of fingerprints. */
const attribution = (tag = MPP_ATTRIBUTION_TAG, version = "01"): string =>
  `${tag}${version}${"00".repeat(27)}`;

describe("the MPP Attribution discriminator", () => {
  it("holds the host's own constants", () => {
    // `keccak256("mpp")[0..3]`. Pinned because both rails' correctness rests on this exact value and
    // nothing else in the tree would notice a typo in it.
    expect(MPP_ATTRIBUTION_TAG).toBe("0xef1ed712");
    expect(MPP_ATTRIBUTION_VERSION).toBe(1);
  });

  it("recognises an attribution memo", () => {
    expect(isMppAttributionValue(attribution())).toBe(true);
  });

  it("does NOT claim an ordinary atrHash", () => {
    // The companion positive that stops the guard being satisfied by refusing everything. A false positive
    // here discards a real weld.
    expect(isMppAttributionValue(`0x${"ab".repeat(32)}`)).toBe(false);
    expect(isMppAttributionValue(`0x${"00".repeat(32)}`)).toBe(false);
  });

  it("requires BOTH the tag and the version", () => {
    // Discriminating on the tag alone would refuse a real atrHash whose first four bytes collide; on the
    // version alone it would refuse roughly one value in 256. Both fields are the host's, so both are read.
    expect(isMppAttributionValue(attribution(MPP_ATTRIBUTION_TAG, "02"))).toBe(
      false,
    );
    expect(isMppAttributionValue(attribution("0xef1ed713", "01"))).toBe(false);
    // …and a one-nibble miss at each end of the tag, which a truncated comparison would let through.
    expect(isMppAttributionValue(attribution("0xff1ed712", "01"))).toBe(false);
    expect(isMppAttributionValue(attribution("0xef1ed711", "01"))).toBe(false);
  });

  it("is case-insensitive — the tag is host bytes, not a spelling", () => {
    expect(isMppAttributionValue(attribution("0xEF1ED712", "01"))).toBe(true);
  });

  it("reads the version as HEX, not as decimal", () => {
    // `parseInt(…, 16)` on "01" is 1 either way, so only a two-digit value above 09 tells the readings
    // apart: version byte 0x10 is 16 in hex and 10 in decimal, and neither equals 1 — but a mutant that
    // dropped the radix would still have to answer this consistently.
    expect(isMppAttributionValue(attribution(MPP_ATTRIBUTION_TAG, "10"))).toBe(
      false,
    );
  });

  it("answers false rather than throwing on values that are not 32 bytes", () => {
    // It is called from decode paths that scan foreign transactions, so a short or empty value is data to
    // classify, never an error to raise.
    for (const v of ["", "0x", "0xef1ed712", MPP_ATTRIBUTION_TAG])
      expect(() => isMppAttributionValue(v)).not.toThrow();
    expect(isMppAttributionValue("")).toBe(false);
    expect(isMppAttributionValue("0xef1ed712")).toBe(false);
  });
});
