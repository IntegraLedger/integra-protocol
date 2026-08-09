import { describe, expect, it } from "vitest";
import {
  decodeStatusList,
  isActiveAsOf,
  revokedAsOf,
  STATUS_LIST_MAX_BYTES,
  statusBit,
} from "../src/status.js";

// A Bitstring Status List v1.0 encodedList (GZIP + base64url multibase-'u') with index 5 and 12 set.
const ENCODED = "uH4sIAAAAAAAAE2PhAADJX24rAgAAAA";

describe("isActiveAsOf (expiry, IDN-5)", () => {
  it("active within the window", () => {
    expect(
      isActiveAsOf(
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        "2026-07-17T00:00:00Z",
      ),
    ).toBe(true);
  });
  it("expired at settlement fails (validUntil is exclusive)", () => {
    expect(
      isActiveAsOf(
        "2026-01-01T00:00:00Z",
        "2026-06-01T00:00:00Z",
        "2026-07-17T00:00:00Z",
      ),
    ).toBe(false);
  });
  it("not-yet-valid at settlement fails", () => {
    expect(
      isActiveAsOf("2026-08-01T00:00:00Z", undefined, "2026-07-17T00:00:00Z"),
    ).toBe(false);
  });
  it("open-ended (no bounds) is active", () => {
    expect(isActiveAsOf(undefined, undefined, "2026-07-17T00:00:00Z")).toBe(
      true,
    );
  });

  // ── The window EDGES. `t < from` and `t >= until` both relax to `<=` / `>` undetected unless the exact
  // boundary instants are asserted: an ordinary case sits comfortably inside or outside the window, so nothing
  // pinned which side of each boundary is inclusive. For an as-of-settlement check that is the whole
  // question — a settlement landing on the exact instant a grant begins or expires is not a hypothetical.

  it("is active AT the exact validFrom instant — the lower bound is INCLUSIVE", () => {
    expect(
      isActiveAsOf("2026-07-16T00:00:00Z", undefined, "2026-07-16T00:00:00Z"),
    ).toBe(true);
  });

  it("is inactive one millisecond BEFORE validFrom", () => {
    expect(
      isActiveAsOf(
        "2026-07-16T00:00:00.001Z",
        undefined,
        "2026-07-16T00:00:00Z",
      ),
    ).toBe(false);
  });

  it("is INACTIVE at the exact validUntil instant — the upper bound is EXCLUSIVE", () => {
    expect(
      isActiveAsOf(undefined, "2026-07-16T00:00:00Z", "2026-07-16T00:00:00Z"),
    ).toBe(false);
  });

  it("is active one millisecond before validUntil", () => {
    expect(
      isActiveAsOf(
        undefined,
        "2026-07-16T00:00:00Z",
        "2026-07-15T23:59:59.999Z",
      ),
    ).toBe(true);
  });
  it("unparseable as-of fails closed", () => {
    expect(isActiveAsOf(undefined, undefined, "not-a-date")).toBe(false);
  });
});

describe("Bitstring Status List v1.0 decode + bit read", () => {
  it("decodes the multibase/GZIP encodedList to the raw bitstring", async () => {
    const bits = await decodeStatusList(ENCODED);
    expect([...bits]).toEqual([0x04, 0x08]);
  });
  it("reads the set bits (big-endian within each byte)", () => {
    const bits = new Uint8Array([0x04, 0x08]);
    expect(statusBit(bits, 5)).toBe(true); // byte 0, bit 7-5=2 → 0x04
    expect(statusBit(bits, 12)).toBe(true); // byte 1, bit 7-4=3 → 0x08
    expect(statusBit(bits, 0)).toBe(false);
    expect(statusBit(bits, 6)).toBe(false);
  });
  it("revokedAsOf decodes the snapshot then reads the bit", async () => {
    expect(await revokedAsOf(ENCODED, 5)).toBe(true);
    expect(await revokedAsOf(ENCODED, 0)).toBe(false);
  });
  it("rejects an encodedList without the multibase 'u' prefix (fail-loud)", async () => {
    await expect(decodeStatusList("H4sIAAAA")).rejects.toThrow(/multibase/);
  });
  it("the prefix refusal TRUNCATES what it echoes — a bad list is not a log-flooding device", async () => {
    // The truncation is the message's point, not decoration: this input is a counterparty's and may be
    // megabytes. Echoing it whole turns a refusal into an amplification.
    await expect(decodeStatusList("Z".repeat(5000))).rejects.toThrow(
      /prefix\): ZZZZZZZZ…$/,
    );
  });
  it("statusBit out of range fails loud", () => {
    expect(() => statusBit(new Uint8Array([0x00]), 99)).toThrow(/out of range/);
  });
});

describe("statusBit — the index is a gate, not a hint", () => {
  // Only index 0 is set, so a wrapped or coerced index that lands on byte 0 reads `true` and any other
  // silent landing reads `false`. Either way the answer is about a bit nobody asked about, which on a
  // REVOCATION check is the difference between refusing a live grant and honouring a revoked one.
  const bits = new Uint8Array([0b1000_0000, 0x00]);

  it("reads the bit it was actually asked for", () => {
    expect(statusBit(bits, 0)).toBe(true);
    expect(statusBit(bits, 1)).toBe(false);
  });

  it("refuses 2**32 rather than wrapping to byte 0 — `>>` is a 32-bit SIGNED op", () => {
    // ToInt32(2**32) === 0, so an index of 2**32 addresses byte 0. Any bounds check that leans on the
    // indexed read returning `undefined` answers this confidently and wrongly.
    expect(() => statusBit(bits, 2 ** 32)).toThrow(/out of range/);
    expect(() => statusBit(bits, 2 ** 32 + 8)).toThrow(/out of range/);
  });

  it("refuses every index that names no bit — NaN, Infinity, fractional, negative", () => {
    // NaN is the sharpest: `NaN >> 3` is 0 and `7 - (NaN % 8)` is NaN, so `byte >> NaN` is `byte >> 0`
    // and the LOW bit of byte 0 answers — `unrevoked` for a grant nobody looked up.
    for (const index of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, -8])
      expect(() => statusBit(bits, index)).toThrow(/out of range/);
  });

  it("the last in-range bit reads, the first out-of-range one throws", () => {
    expect(statusBit(bits, 15)).toBe(false);
    expect(() => statusBit(bits, 16)).toThrow(/out of range/);
  });
});

describe("decodeStatusList — bounded in both directions (decompression bomb)", () => {
  /** gzip 256 MiB of zeros — a few hundred KB of encodedList against a 256 MB expansion. */
  const bomb = async (): Promise<string> => {
    const zeros = new Uint8Array(256 * 1024 * 1024);
    const gz = new Response(
      new Blob([zeros as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    );
    const bytes = new Uint8Array(await gz.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `u${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  };

  it("refuses a list that decompresses past the ceiling instead of allocating it", async () => {
    await expect(decodeStatusList(await bomb())).rejects.toThrow(
      /decompression bomb/,
    );
  });

  it("refuses an oversize encodedList BEFORE decoding it", async () => {
    // Bounding only the output lets `atob` allocate the input first.
    await expect(decodeStatusList(`u${"A".repeat(2_097_153)}`)).rejects.toThrow(
      /refused before decoding/,
    );
  });

  it("a legitimate list still decodes unchanged", async () => {
    expect([...(await decodeStatusList(ENCODED))]).toEqual([0x04, 0x08]);
  });

  /** gzip `n` bytes of a repeating pattern and return the multibase-'u' base64url encodedList. */
  const listOf = async (n: number): Promise<string> => {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = i & 0xff; // patterned, so a mis-assembled buffer is visible
    const gz = new Response(
      new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("gzip")),
    );
    const out = new Uint8Array(await gz.arrayBuffer());
    let bin = "";
    for (const b of out) bin += String.fromCharCode(b);
    return `u${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  };

  it("a list of EXACTLY the ceiling decodes — the decompressed bound is inclusive", async () => {
    // `>` vs `>=` is the difference between a maximal legitimate list being readable and being refused.
    // It also proves the chunk assembly: 1 MiB arrives over many reads, so a mis-advanced write offset
    // shows here and nowhere in the two-byte fixture.
    const decoded = await decodeStatusList(await listOf(STATUS_LIST_MAX_BYTES));
    expect(decoded.length).toBe(STATUS_LIST_MAX_BYTES);
    expect(decoded[0]).toBe(0);
    expect(decoded[255]).toBe(255);
    expect(decoded[STATUS_LIST_MAX_BYTES - 1]).toBe(
      (STATUS_LIST_MAX_BYTES - 1) & 0xff,
    );
  });

  it("one byte past the ceiling is refused", async () => {
    await expect(
      decodeStatusList(await listOf(STATUS_LIST_MAX_BYTES + 1)),
    ).rejects.toThrow(/decompression bomb/);
  });

  it("an encodedList of EXACTLY the encoded ceiling gets PAST the length gate", async () => {
    // The length gate is inclusive too: a string at exactly the ceiling must fail on its BYTES, never on
    // its length, or `>` vs `>=` silently narrows what is decodable.
    const atCeiling = `u${"A".repeat(STATUS_LIST_MAX_BYTES * 2 - 1)}`;
    expect(atCeiling.length).toBe(STATUS_LIST_MAX_BYTES * 2);
    await expect(decodeStatusList(atCeiling)).rejects.not.toThrow(
      /refused before decoding/,
    );
    await expect(decodeStatusList(`${atCeiling}A`)).rejects.toThrow(
      /refused before decoding/,
    );
  });
});

/**
 * The `ENCODED` fixture above is a two-byte list whose base64 happens to contain no `-` and no `_`, so
 * the base64url→base64 translation never had to do anything: both `replace` calls could have been
 * deleted and every test still passed. That translation is the whole difference between base64url and
 * base64, and getting it wrong does not fail loudly — `atob` either throws deep inside a revocation
 * check or yields bytes that gunzip to garbage, so a revoked credential reads as active.
 *
 * This fixture is a real 27-byte bitstring whose encoding exercises all three branches at once: it
 * contains `-`, contains `_`, and its body length is a multiple of 4 (so the padding arm must produce
 * the empty string — over-padding is the one thing `atob` does reject).
 */
describe("base64url decoding of a status list that actually uses the URL alphabet", () => {
  const URL_ALPHABET =
    "uH4sIAAAAAAACE_sqYR3XuOT4K16D4LKZe-4zqXpk92288l3KNqEZAIE75pEbAAAA";
  const EXPECTED = Uint8Array.from(
    (
      "f5183b5e81a4c7ea0d30537699bcdf0225486b8eb1d4f71a3d6083".match(
        /../g,
      ) as string[]
    ).map((h) => Number.parseInt(h, 16)),
  );

  it("the fixture really does exercise all three branches", () => {
    const body = URL_ALPHABET.slice(1);
    expect(body).toContain("-");
    expect(body).toContain("_");
    expect(body.length % 4).toBe(0);
  });

  it("decodes to the exact bitstring — `-`→`+` and `_`→`/` both have to happen", async () => {
    expect([...(await decodeStatusList(URL_ALPHABET))]).toEqual([...EXPECTED]);
  });

  it("reads a set and a clear bit out of it", async () => {
    // 0xf5 = 1111 0101: bits 0,1,2,3,5,7 set; bit 4 clear.
    expect(await revokedAsOf(URL_ALPHABET, 0)).toBe(true);
    expect(await revokedAsOf(URL_ALPHABET, 4)).toBe(false);
    expect(await revokedAsOf(URL_ALPHABET, 5)).toBe(true);
  });
});
