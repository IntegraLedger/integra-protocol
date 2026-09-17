import { decodeFunctionResult, encodeFunctionResult } from "viem";
import { describe, expect, it } from "vitest";
import * as eas from "../src/eas.js";
import {
  decodeEasAttestation,
  EAS_GET_ATTESTATION_ABI,
  isEasValidAsOf,
  type RawEasAttestation,
} from "../src/eas.js";
import * as pkg from "../src/index.js";

const UID =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SCHEMA =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

function raw(over: Partial<RawEasAttestation> = {}): RawEasAttestation {
  return {
    uid: UID,
    schema: SCHEMA,
    time: 1_700_000_000n,
    expirationTime: 0n,
    revocationTime: 0n,
    refUID:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    recipient: "0xabc0000000000000000000000000000000000001",
    attester: "0xdef0000000000000000000000000000000000002",
    revocable: true,
    data: "0xcafe",
    ...over,
  };
}

describe("decodeEasAttestation", () => {
  it("lowercases mixed-case addresses/bytes and flags existence", () => {
    // Fed directly (a real chain read returns checksummed addresses); normalization lowercases them.
    const att = decodeEasAttestation(
      raw({
        recipient: "0xAbC0000000000000000000000000000000000001",
        attester: "0xDeF0000000000000000000000000000000000002",
        data: "0xCAFE",
      }),
    );
    expect(att.recipient).toBe("0xabc0000000000000000000000000000000000001");
    expect(att.attester).toBe("0xdef0000000000000000000000000000000000002");
    expect(att.data).toBe("0xcafe");
    expect(att.exists).toBe(true);
  });

  it("marks a zero-uid struct (unknown attestation) as non-existent", () => {
    const att = decodeEasAttestation(
      raw({
        uid: "0x0000000000000000000000000000000000000000000000000000000000000000",
      }),
    );
    expect(att.exists).toBe(false);
  });

  it("round-trips through the real getAttestation ABI (encode → decode → normalize)", () => {
    const struct = raw({ expirationTime: 1_800_000_000n, revocationTime: 0n });
    const data = encodeFunctionResult({
      abi: EAS_GET_ATTESTATION_ABI,
      functionName: "getAttestation",
      result: struct,
    });
    const decoded = decodeFunctionResult({
      abi: EAS_GET_ATTESTATION_ABI,
      functionName: "getAttestation",
      data,
    }) as RawEasAttestation;
    const att = decodeEasAttestation(decoded);
    expect(att.uid).toBe(UID);
    expect(att.schema).toBe(SCHEMA);
    expect(att.expirationTime).toBe(1_800_000_000n);
    expect(att.exists).toBe(true);
  });
});

describe("isEasValidAsOf (as-of-settlement, not as-of-now)", () => {
  const asOf = 1_700_000_000n;
  it("valid: exists, never revoked, no expiry", () => {
    expect(isEasValidAsOf(decodeEasAttestation(raw()), asOf)).toBe(true);
  });
  it("invalid: revoked at/before the as-of time", () => {
    expect(
      isEasValidAsOf(
        decodeEasAttestation(raw({ revocationTime: 1_699_999_999n })),
        asOf,
      ),
    ).toBe(false);
  });
  it("valid: revoked AFTER the as-of time (was still live at settlement)", () => {
    expect(
      isEasValidAsOf(
        decodeEasAttestation(raw({ revocationTime: 1_700_000_001n })),
        asOf,
      ),
    ).toBe(true);
  });
  it("invalid: expired at/before the as-of time", () => {
    expect(
      isEasValidAsOf(
        decodeEasAttestation(raw({ expirationTime: 1_699_999_999n })),
        asOf,
      ),
    ).toBe(false);
  });
  it("valid: expires AFTER the as-of time (was still live at settlement)", () => {
    expect(
      isEasValidAsOf(
        decodeEasAttestation(raw({ expirationTime: 1_700_000_001n })),
        asOf,
      ),
    ).toBe(true);
  });
  // The boundary is the whole content of "at/before": an attestation revoked or expired in the very
  // second the settlement landed was NOT live for it. `<` instead of `<=` would call both valid.
  it.each(["revocationTime", "expirationTime"] as const)(
    "invalid: %s exactly EQUALS the as-of time (the boundary is inclusive)",
    (field) => {
      expect(
        isEasValidAsOf(decodeEasAttestation(raw({ [field]: asOf })), asOf),
      ).toBe(false);
    },
  );
  /**
   * ⛔ An attestation that did not YET exist at the as-of instant was not valid then.
   *
   * `time` — EAS's creation timestamp — was decoded and then read by nothing, so this predicate answered
   * "valid as of the settlement" about an attestation minted after it. Revocation and expiry both bound
   * the interval from above; nothing bounded it from below, and that is the one direction an attester can
   * exploit after the fact.
   *
   * The boundary mirrors the other two: revoked or expired AT the as-of second is invalid, so attested AT
   * the as-of second is valid — the attestation was live for exactly that instant.
   */
  it("invalid: attested AFTER the as-of time", () => {
    expect(
      isEasValidAsOf(decodeEasAttestation(raw({ time: asOf + 1n })), asOf),
    ).toBe(false);
  });
  it("valid: attested exactly AT the as-of time (the boundary is inclusive)", () => {
    expect(
      isEasValidAsOf(decodeEasAttestation(raw({ time: asOf })), asOf),
    ).toBe(true);
  });
  it("valid: attested before the as-of time", () => {
    expect(
      isEasValidAsOf(decodeEasAttestation(raw({ time: asOf - 1n })), asOf),
    ).toBe(true);
  });

  it("invalid: does not exist", () => {
    expect(
      isEasValidAsOf(
        decodeEasAttestation(
          raw({
            uid: "0x0000000000000000000000000000000000000000000000000000000000000000",
          }),
        ),
        asOf,
      ),
    ).toBe(false);
  });
});

/**
 * ⛔ THE PIN ON THE SPLIT — `#169` item 2, ruled (c) on 2026-09-17.
 *
 * `decodeEasAttestation` and `isEasValidAsOf` are the pure semantics of somebody else's substrate and stay
 * in this package; the chain read is a verifier's act and left it. What this pins is the SPLIT, not a
 * name — restoring `readEasAttestation`, or adding any other chain read to this module under any name,
 * reds it.
 *
 * The predicate is structural rather than a spelling. A chain read is I/O, so it is `async` and returns a
 * promise; a decoder over a struct the caller already holds is not. An exported `AsyncFunction` in this
 * module therefore IS a chain read, whatever it is called. The name list beside it is the second half:
 * `AsyncFunction` catches a read added under a new name, the list catches one added as a thenable or as a
 * value. Neither alone is enough, which is why both are here.
 */
describe("the EAS surface is decode-only (the chain read is the reader's)", () => {
  it("exports no asynchronous function — a chain read cannot be synchronous", () => {
    const asyncExports = Object.entries(eas)
      .filter(
        ([, v]) =>
          typeof v === "function" && v.constructor.name === "AsyncFunction",
      )
      .map(([k]) => k);
    expect(asyncExports).toEqual([]);
  });

  it("exports exactly the ABI, the decoder and the as-of predicate", () => {
    expect(Object.keys(eas).sort()).toEqual([
      "EAS_GET_ATTESTATION_ABI",
      "decodeEasAttestation",
      "isEasValidAsOf",
    ]);
  });

  it("re-exports no EAS chain read from the package barrel either", () => {
    // The barrel is the surface a consumer installs. A read reachable only from `./eas.js` would still be
    // unreachable for them; a read re-exported here would be shipped, which is the thing that moved.
    expect(
      Object.keys(pkg)
        .filter((k) => /eas/i.test(k))
        .sort(),
    ).toEqual([
      "EAS_GET_ATTESTATION_ABI",
      "decodeEasAttestation",
      "isEasValidAsOf",
    ]);
  });
});
