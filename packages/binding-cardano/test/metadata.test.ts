import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLcpMetadataValue,
  decodeLcpMetadataValue,
  encodeLcpMetadatum,
  recoverAtrHashFromMetadata,
  verifyAtrMetadata,
} from "../src/metadata.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const ATR_BARE = ATR.slice(2);
// An ARBITRARY version string, deliberately NOT `LCP_SPEC_VERSION`. Every case passes it explicitly, so
// nothing here asserts the default — and the canonical-CBOR oracles below are pinned to these exact bytes.
// Tying it to the constant would force a re-derivation of every oracle each time the spec version moves,
// which would test that the encoder agrees with itself rather than with CBOR. `adapter.test.ts` is where
// the DEFAULT is exercised.
const V = "0.1.36";
const LABEL = 8847;

const hex = (u8: Uint8Array): string =>
  [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The oracle-pinned canonical-CBOR vectors (cross-checked byte-for-byte against `cborg`). */
const metadatumVectors = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/cardano-metadatum.json", import.meta.url),
    "utf8",
  ),
) as { cases: { name: string; atrHash: string; v: string; cbor: string }[] };

describe("encodeLcpMetadatum (canonical CBOR, oracle-pinned)", () => {
  for (const c of metadatumVectors.cases) {
    it(`matches the cborg-verified bytes: ${c.name}`, () => {
      const bareHash = c.atrHash.slice(2).toLowerCase();
      expect(hex(encodeLcpMetadatum({ atrHash: c.atrHash, v: c.v }))).toBe(
        c.cbor,
      );
      // Accepts a bare-hex input too (normalizes to the same bytes).
      expect(
        hex(encodeLcpMetadatum({ atrHash: `0x${bareHash}`, v: c.v })),
      ).toBe(c.cbor);
    });
  }

  it("orders keys canonically (v before atrHash) — a2 map(2), then 6176 'v'", () => {
    const bytes = encodeLcpMetadatum({ atrHash: ATR, v: V });
    expect(bytes[0]).toBe(0xa2); // map(2)
    expect(bytes[1]).toBe(0x61); // text(1)
    expect(bytes[2]).toBe(0x76); // "v"
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => encodeLcpMetadatum({ atrHash: "0xdead", v: V })).toThrow(
      /32-byte/,
    );
    expect(() => encodeLcpMetadatum({ atrHash: "not-hex", v: V })).toThrow();
  });

  it("fails loud on a missing lcp version", () => {
    expect(() => encodeLcpMetadatum({ atrHash: ATR, v: "" })).toThrow(
      /v \(LCP version\) is required/,
    );
  });

  it("refuses a version string past Cardano's 64-byte metadatum limit", () => {
    // Cardano caps a metadatum text string at 64 bytes. Encoding past it produces a metadatum the
    // node rejects at submission — better to fail here, while the value is still ours to fix, than
    // to hand the buyer a transaction that cannot be sent.
    expect(() =>
      encodeLcpMetadatum({ atrHash: ATR, v: "x".repeat(65) }),
    ).toThrow(/64-byte metadatum limit/);
    // …and exactly 64 is legal — the bound is inclusive.
    expect(() =>
      encodeLcpMetadatum({ atrHash: ATR, v: "x".repeat(64) }),
    ).not.toThrow();
  });

  it("uses CBOR shortest form at the n=24 boundary (RFC 8949 §3)", () => {
    // A text string shorter than 24 bytes embeds its length in the header byte; 24 and above take a
    // following length byte. Getting the boundary wrong emits non-canonical CBOR — which still
    // decodes, so nothing downstream complains, but the metadatum bytes (and any hash over them)
    // differ from every other writer's for the same value.
    const headerOf = (v: string) => {
      const bytes = encodeLcpMetadatum({ atrHash: ATR, v });
      // map(2) 0xa2, key "v" (0x61 0x76), then the VALUE's text header starts at index 3.
      return [...bytes.slice(3, 5)];
    };
    expect(headerOf("x".repeat(23))[0]).toBe(0x60 | 23); // embedded length
    expect(headerOf("x".repeat(24)).slice(0, 2)).toEqual([0x78, 24]); // 1-byte length
  });

  it("counts the limit in BYTES, not characters (multi-byte version tags)", () => {
    // 33 two-byte characters is 66 bytes but only 33 characters — measuring length in characters
    // would let it through and produce an oversized metadatum.
    expect(() =>
      encodeLcpMetadatum({ atrHash: ATR, v: "é".repeat(33) }),
    ).toThrow(/64-byte metadatum limit/);
  });
});

describe("buildLcpMetadataValue", () => {
  it("builds the {v, atrHash} value with bare lowercase hash", () => {
    expect(buildLcpMetadataValue(ATR, V)).toEqual({ v: V, atrHash: ATR_BARE });
  });
  it("lowercases an uppercase atrHash and strips 0x", () => {
    expect(
      buildLcpMetadataValue(ATR.toUpperCase().replace("0X", "0x"), V),
    ).toEqual({ v: V, atrHash: ATR_BARE });
  });
  it("fails loud on malformed atrHash / missing version", () => {
    expect(() => buildLcpMetadataValue("0xdead", V)).toThrow(/32-byte/);
    expect(() => buildLcpMetadataValue(ATR, "")).toThrow(/required/);
  });

  it("is idempotent on the bare form, and accepts any-case hex DIGITS", () => {
    // propose calls buildLcpMetadataValue (which strips the prefix) and then encodeLcpMetadatum
    // (which re-normalises), so the bare form must validate without a prefix requirement.
    expect(buildLcpMetadataValue(ATR_BARE, V).atrHash).toBe(ATR_BARE);
    expect(buildLcpMetadataValue(ATR_BARE.toUpperCase(), V).atrHash).toBe(
      ATR_BARE,
    );
  });

  it("REJECTS an upper-case 0X prefix — the ATR canon requires the prefix lowercase", () => {
    // The same rule the carrier corpus pins with its uppercase-0X reject vector. A `startsWith("0X")`
    // arm here would be unreachable regardless: `isAtrHash` rejects anything it would let through.
    expect(() => buildLcpMetadataValue(`0X${ATR_BARE}`, V)).toThrow(/32-byte/);
  });
});

describe("decodeLcpMetadataValue", () => {
  it("recovers the 0x-prefixed atrHash from a bare-hex value", () => {
    expect(decodeLcpMetadataValue({ v: V, atrHash: ATR_BARE })).toBe(ATR);
  });
  it("tolerates a stray 0x prefix in the value (non-canonical writer)", () => {
    expect(decodeLcpMetadataValue({ v: V, atrHash: ATR })).toBe(ATR);
  });
  it("returns null for a non-LCP value (scan skips it, not errors)", () => {
    expect(decodeLcpMetadataValue({ msg: ["hello"] })).toBeNull();
    expect(decodeLcpMetadataValue({ v: V })).toBeNull(); // no atrHash
    expect(decodeLcpMetadataValue({ atrHash: "deadbeef" })).toBeNull(); // wrong length
    expect(decodeLcpMetadataValue(null)).toBeNull();
    expect(decodeLcpMetadataValue("not-an-object")).toBeNull();
  });
});

describe("recoverAtrHashFromMetadata (Blockfrost-shaped array)", () => {
  it("finds the LCP-label entry and recovers atrHash", () => {
    const arr = [
      { label: "674", json_metadata: { msg: ["unrelated CIP-20 message"] } },
      { label: String(LABEL), json_metadata: { v: V, atrHash: ATR_BARE } },
    ];
    expect(recoverAtrHashFromMetadata(arr, LABEL)).toBe(ATR);
  });
  it("returns null when the LCP label is absent or empty", () => {
    expect(recoverAtrHashFromMetadata([], LABEL)).toBeNull();
    expect(recoverAtrHashFromMetadata(null, LABEL)).toBeNull();
    expect(
      recoverAtrHashFromMetadata(
        [{ label: "721", json_metadata: { name: "nft" } }],
        LABEL,
      ),
    ).toBeNull();
  });
  it("returns null when the LCP-label entry lacks atrHash", () => {
    expect(
      recoverAtrHashFromMetadata(
        [{ label: String(LABEL), json_metadata: { v: V } }],
        LABEL,
      ),
    ).toBeNull();
  });
});

describe("decodeLcpMetadataValue rejects non-metadatum values", () => {
  it.each([
    ["null", null],
    ["a string", "0x" + "ab".repeat(32)],
    ["a number", 42],
    ["undefined", undefined],
    ["an object with no atrHash", { v: V }],
    ["an object whose atrHash is not a string", { v: V, atrHash: 42 }],
  ])("%s decodes to null (a scan skips it, never errors)", (_why, value) => {
    expect(decodeLcpMetadataValue(value)).toBeNull();
  });

  it("accepts a stray lowercase 0x prefix and any-case hex digits", () => {
    expect(decodeLcpMetadataValue({ v: V, atrHash: ATR })).toBe(ATR);
    expect(
      decodeLcpMetadataValue({ v: V, atrHash: ATR_BARE.toUpperCase() }),
    ).toBe(ATR);
  });

  it("skips an upper-case 0X prefix — not an atrHash under the canon, so not a weld", () => {
    expect(
      decodeLcpMetadataValue({ v: V, atrHash: `0X${ATR_BARE}` }),
    ).toBeNull();
  });
});

describe("verifyAtrMetadata", () => {
  it("confirms a matching value and rejects a mismatched one", () => {
    expect(
      verifyAtrMetadata({ value: { v: V, atrHash: ATR_BARE }, atrHash: ATR }),
    ).toBe(true);
    expect(
      verifyAtrMetadata({
        value: { v: V, atrHash: ATR_BARE },
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("rejects a malformed QUERIED atrHash, even against a well-formed value", () => {
    const value = { v: V, atrHash: ATR_BARE };
    expect(verifyAtrMetadata({ value, atrHash: "0xdead" })).toBe(false);
    expect(verifyAtrMetadata({ value, atrHash: "" })).toBe(false);
  });

  it("rejects an unreadable value, even against a well-formed atrHash", () => {
    expect(verifyAtrMetadata({ value: null, atrHash: ATR })).toBe(false);
  });

  it("matches case-insensitively, as the ATR canon requires", () => {
    expect(
      verifyAtrMetadata({
        value: { v: V, atrHash: ATR_BARE },
        atrHash: `0x${ATR_BARE.toUpperCase()}`,
      }),
    ).toBe(true);
  });
});
