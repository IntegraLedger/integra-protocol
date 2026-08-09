import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  decodeMuxedAddress,
  deriveMuxId,
  encodeMuxedAddress,
  recoverMuxIdPrefix8,
  verifyMuxedBinding,
} from "../src/mux.js";

const ATR = `0x${"ab".repeat(32)}`;
const ATR_PREFIX_8 = new Uint8Array(8).fill(0xab);
const OTHER = `0x${"cd".repeat(32)}`;

// Deterministic base G-pubkey (seed = 32×0x07).
const G_PUBKEY = Keypair.fromRawEd25519Seed(
  Buffer.from(new Uint8Array(32).fill(7)),
).publicKey();

/**
 * Every fixture above is a repeated single byte (`ab` × 32), which makes the truncation boundary
 * invisible: slicing bytes 1..9 instead of 0..8 yields an identical result. This hash has 32 DISTINCT
 * bytes, so the window is pinned to the exact offsets — and it starts `00 01 …` so a zero byte has to
 * survive hex rendering, which a `padStart(2, "0")` that stopped padding would silently drop.
 */
const DISTINCT = `0x${Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("")}`;
const DISTINCT_PREFIX_8 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

describe("deriveMuxId", () => {
  it("returns the first 8 bytes of atrHash (mux_id = atrHash[:8])", () => {
    expect(deriveMuxId(ATR)).toEqual(ATR_PREFIX_8);
    expect(deriveMuxId(ATR).length).toBe(8);
  });

  it("takes bytes 0..7 exactly — not a window shifted by one, and not 7 or 9 bytes", () => {
    expect(deriveMuxId(DISTINCT)).toEqual(DISTINCT_PREFIX_8);
    // The off-by-one neighbours the all-`ab` fixture cannot distinguish:
    expect(deriveMuxId(DISTINCT)).not.toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect(deriveMuxId(DISTINCT)).not.toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6]),
    );
    expect(deriveMuxId(DISTINCT)).not.toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    );
  });

  it("lowercases an uppercase atrHash (ATR canon)", () => {
    expect(deriveMuxId(ATR.toUpperCase().replace("0X", "0x"))).toEqual(
      ATR_PREFIX_8,
    );
  });

  it("fails loud on a malformed atrHash (fail-fast)", () => {
    expect(() => deriveMuxId("0xdead")).toThrow(/32-byte/);
    expect(() => deriveMuxId("not-hex")).toThrow();
  });
});

describe("encode/decode muxed address round-trip", () => {
  it("round-trips a 32-byte G + 8-byte mux id into a 69-char CAP-67 M-address", () => {
    const muxId = new Uint8Array(8).fill(0xff);
    const mAddr = encodeMuxedAddress(G_PUBKEY, muxId);
    expect(mAddr.length).toBe(69);
    expect(StrKey.isValidMed25519PublicKey(mAddr)).toBe(true);

    const decoded = decodeMuxedAddress(mAddr);
    expect(decoded).not.toBeNull();
    expect(decoded?.basePubkey).toBe(G_PUBKEY);
    expect(decoded?.muxId).toEqual(muxId);
  });

  it("fails loud on a wrong-length mux id", () => {
    expect(() => encodeMuxedAddress(G_PUBKEY, new Uint8Array(7))).toThrow(
      /8 bytes/,
    );
  });

  it("decodeMuxedAddress returns null for a non-M-address (a scan skips it, not errors)", () => {
    expect(decodeMuxedAddress(G_PUBKEY)).toBeNull(); // a G-address is not muxed
    expect(decodeMuxedAddress("not-an-address")).toBeNull();
  });
});

describe("recoverMuxIdPrefix8 — the ONLY thing on-chain is 8 bytes", () => {
  it("returns exactly the 8-byte prefix (NOT a full atrHash)", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(ATR));
    const prefix = recoverMuxIdPrefix8(mAddr);
    expect(prefix).toEqual(ATR_PREFIX_8);
    expect(prefix?.length).toBe(8);
    // ★ 8 bytes, not 32 — a settlement cannot yield the full hash.
    expect(prefix?.length).not.toBe(32);
  });

  it("returns null for a non-M-address", () => {
    expect(recoverMuxIdPrefix8(G_PUBKEY)).toBeNull();
  });
});

describe("verifyMuxedBinding — CONFIRM a known atrHash's prefix-8, not recover the hash", () => {
  it("confirms when a known atrHash's prefix-8 equals the on-chain mux id", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(ATR));
    expect(verifyMuxedBinding({ muxedM: mAddr, atrHash: ATR })).toBe(true);
  });

  it("rejects a different atrHash (prefix-8 mismatch)", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(ATR));
    expect(verifyMuxedBinding({ muxedM: mAddr, atrHash: OTHER })).toBe(false);
  });

  it("fails CLOSED (false, no throw) on a non-M-address or malformed atrHash", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(ATR));
    expect(verifyMuxedBinding({ muxedM: G_PUBKEY, atrHash: ATR })).toBe(false);
    expect(verifyMuxedBinding({ muxedM: mAddr, atrHash: "0xdead" })).toBe(
      false,
    );
  });
});

/**
 * ★ THE TRUNCATION BOUNDARY — where a false match comes from, and the one property the all-`ab` fixtures
 * could not see. `OTHER` differs from `ATR` in every byte, so the existing mismatch test passes under a
 * window of almost any offset or width. These pin the exact edge: byte 7 is the last one carried on
 * chain, byte 8 the first one that is not.
 */
describe("verifyMuxedBinding at the prefix-8 edge", () => {
  /** `DISTINCT` with byte `index` forced to 0xff. */
  function mutateByte(index: number): string {
    const bytes = DISTINCT.slice(2).match(/../g) ?? [];
    bytes[index] = "ff";
    return `0x${bytes.join("")}`;
  }

  it("REJECTS a hash differing at byte 7 — the last byte the mux id carries", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(DISTINCT));
    expect(verifyMuxedBinding({ muxedM: mAddr, atrHash: mutateByte(7) })).toBe(
      false,
    );
  });

  it("CONFIRMS a hash differing at byte 8 — this rail cannot see past the prefix, and says so", () => {
    // Not a defect: with 8 bytes on chain the confirmation is a 64-bit match, and the binding is
    // documented confirm-not-recover for exactly this reason. The full atrHash comes from off-chain
    // `extensions.legalContext.info`; the mux id is the public match check, never the source of the hash.
    // Pinning it keeps a future "recover the full hash from chain" change from passing quietly.
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(DISTINCT));
    const collides = mutateByte(8);
    expect(collides).not.toBe(DISTINCT);
    expect(verifyMuxedBinding({ muxedM: mAddr, atrHash: collides })).toBe(true);
  });

  it("REJECTS a hash differing anywhere inside bytes 0..7, one byte at a time", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(DISTINCT));
    for (let i = 0; i < 8; i++)
      expect(
        verifyMuxedBinding({ muxedM: mAddr, atrHash: mutateByte(i) }),
      ).toBe(false);
  });

  it("CONFIRMS a hash differing anywhere in bytes 8..31 — the whole invisible tail", () => {
    const mAddr = encodeMuxedAddress(G_PUBKEY, deriveMuxId(DISTINCT));
    for (let i = 8; i < 32; i++)
      expect(
        verifyMuxedBinding({ muxedM: mAddr, atrHash: mutateByte(i) }),
      ).toBe(true);
  });
});
