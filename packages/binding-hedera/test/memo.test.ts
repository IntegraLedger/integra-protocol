import { describe, expect, it } from "vitest";
import { HEDERA_MEMO_MAX_BYTES } from "../src/constants.js";
import {
  decodeMemoAtrHash,
  encodeMemoAtrHash,
  verifyMemoAtrHash,
} from "../src/memo.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("encodeMemoAtrHash / decodeMemoAtrHash", () => {
  it("memo is the 0x-prefixed lowercase ASCII hex atrHash, 66 bytes (fits Hedera's 100-byte ceiling)", () => {
    const memo = encodeMemoAtrHash(ATR);
    expect(memo).toBe(ATR);
    expect(new TextEncoder().encode(memo).length).toBe(66); // "0x" + 64 hex, one byte each
    expect(decodeMemoAtrHash(memo)).toBe(ATR);
  });

  it("lowercases an uppercase atrHash (ATR canon)", () => {
    const memo = encodeMemoAtrHash(ATR.toUpperCase().replace("0X", "0x"));
    expect(decodeMemoAtrHash(memo)).toBe(ATR);
  });

  it("decodes a mixed-case memo case-insensitively", () => {
    const mixed = `0x7F83B1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126D9069`;
    expect(decodeMemoAtrHash(mixed)).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => encodeMemoAtrHash("0xdead")).toThrow(/32-byte/);
    expect(() => encodeMemoAtrHash("not-hex")).toThrow();
  });

  it("returns null for a memo that is not an atrHash (a scan skips it, not errors)", () => {
    expect(decodeMemoAtrHash("hello world")).toBeNull();
    expect(decodeMemoAtrHash("")).toBeNull();
    expect(decodeMemoAtrHash("0xdead")).toBeNull(); // wrong length
  });
});

describe("verifyMemoAtrHash", () => {
  it("confirms a matching memo and rejects a mismatched one", () => {
    const memo = encodeMemoAtrHash(ATR);
    expect(verifyMemoAtrHash({ memo, atrHash: ATR })).toBe(true);
    expect(
      verifyMemoAtrHash({
        memo,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("returns false when the memo is not a well-formed atrHash", () => {
    expect(verifyMemoAtrHash({ memo: "just a note", atrHash: ATR })).toBe(
      false,
    );
  });

  it("returns false when the QUERIED atrHash is malformed, even against a good memo", () => {
    const memo = encodeMemoAtrHash(ATR);
    expect(verifyMemoAtrHash({ memo, atrHash: "0xdead" })).toBe(false);
    expect(verifyMemoAtrHash({ memo, atrHash: "" })).toBe(false);
  });

  it("matches case-insensitively, as the ATR canon requires", () => {
    expect(
      verifyMemoAtrHash({
        memo: encodeMemoAtrHash(ATR),
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }),
    ).toBe(true);
  });
});

describe("the Hedera memo ceiling", () => {
  it("a canonical atrHash memo is 66 bytes, well inside the 100-byte limit", () => {
    // The guard is a defensive invariant, not a runtime branch — but the margin is what makes it one.
    // If an atrHash form ever grew past the ceiling, encodeMemoAtrHash must fail loud rather than emit
    // a truncated memo, which the ledger would accept and no verifier could ever recover from.
    const memo = encodeMemoAtrHash(ATR);
    expect(new TextEncoder().encode(memo).length).toBe(66);
    expect(new TextEncoder().encode(memo).length).toBeLessThan(
      HEDERA_MEMO_MAX_BYTES,
    );
  });
});

describe("MPP's attribution memo is not a terms reference", () => {
  // MPP's Hedera charge draft REQUIRES an Attribution memo on every charge transaction and fixes its
  // layout: exactly 32 bytes, written as a 0x-prefixed 66-character hex string, TAG(4) =
  // keccak256("mpp")[0..3] = 0xef1ed712 then VERSION(1) = 0x01. That is byte-for-byte the shape of an
  // atrHash, so an undiscriminated decoder reads MPP's server-and-challenge fingerprint as a terms
  // reference — and `enumerate`'s Mirror Node scan then returns every MPP charge on the account as an LCP
  // settlement the seller never made. LCP v1.38 §C.1 states it as a MUST. binding-tempo-mpp has guarded
  // the same collision since 2026-07-30 on empirical grounds; on Hedera it is normative.
  const ATTRIBUTION = `0xef1ed71201${"00".repeat(27)}`;

  it("decode returns null for an attribution memo", () => {
    expect(decodeMemoAtrHash(ATTRIBUTION)).toBeNull();
  });

  it("an atrHash WITHOUT the tag still decodes — the guard cannot be satisfied by refusing everything", () => {
    const atr = `0x${"ab".repeat(32)}`;
    expect(decodeMemoAtrHash(atr)).toBe(atr);
  });

  it("the tag alone is not enough — a different layout VERSION is still a terms reference", () => {
    // Discriminating on the tag alone would refuse a real atrHash whose first four bytes happen to match.
    // Both fields are the host's, so both are read.
    expect(decodeMemoAtrHash(`0xef1ed71202${"00".repeat(27)}`)).not.toBeNull();
  });

  it("case does not defeat the discriminator", () => {
    expect(
      decodeMemoAtrHash(ATTRIBUTION.toUpperCase().replace("0X", "0x")),
    ).toBeNull();
  });

  it("verify refuses an attribution memo even against a matching candidate", () => {
    // The fabricated-weld path end to end: an auditor holding the attribution bytes as a candidate must
    // not be told the settlement carries them as a reference.
    expect(verifyMemoAtrHash({ memo: ATTRIBUTION, atrHash: ATTRIBUTION })).toBe(
      false,
    );
  });

  it("encode REFUSES to write a memo it would refuse to read", () => {
    // An atrHash colliding with the tag is unusable on this rail. Emitting it would produce a settlement
    // whose reference can never be recovered — silent data loss — so it fails loud at proposal time.
    expect(() => encodeMemoAtrHash(ATTRIBUTION)).toThrow(/attribution/i);
  });
});
