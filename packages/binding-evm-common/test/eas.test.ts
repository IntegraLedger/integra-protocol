import {
  decodeFunctionResult,
  encodeFunctionResult,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  decodeEasAttestation,
  EAS_GET_ATTESTATION_ABI,
  isEasValidAsOf,
  type RawEasAttestation,
  readEasAttestation,
} from "../src/eas.js";

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

describe("readEasAttestation (the imperative shell over the injected client)", () => {
  const EAS = "0x4200000000000000000000000000000000000021";

  it("calls getAttestation with the uid and normalizes what the chain returns", async () => {
    const readContract = vi.fn(async () =>
      raw({ attester: "0xDeF0000000000000000000000000000000000002" }),
    );
    const client = { readContract } as unknown as PublicClient;
    const att = await readEasAttestation(client, { eas: EAS, uid: UID });
    expect(readContract).toHaveBeenCalledWith({
      address: EAS,
      abi: EAS_GET_ATTESTATION_ABI,
      functionName: "getAttestation",
      args: [UID],
    });
    expect(att.attester).toBe("0xdef0000000000000000000000000000000000002");
    expect(att.exists).toBe(true);
  });

  it("reports a zero-uid read as non-existent rather than as a valid attestation", async () => {
    const client = {
      readContract: vi.fn(async () =>
        raw({
          uid: "0x0000000000000000000000000000000000000000000000000000000000000000",
        }),
      ),
    } as unknown as PublicClient;
    const att = await readEasAttestation(client, { eas: EAS, uid: UID });
    expect(att.exists).toBe(false);
    expect(isEasValidAsOf(att, 1_700_000_000n)).toBe(false);
  });
});
