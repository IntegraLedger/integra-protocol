import { encodeEventTopics, type Log } from "viem";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_USED_ABI,
  readAuthorizationUsed,
  refOf,
  verifyAtrHashOnChain,
} from "../src/events.js";

const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OTHER_ASSET = "0x9999999999999999999999999999999999999999";
const AUTHORIZER = "0x1111111111111111111111111111111111111111";
const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// A synthetic AuthorizationUsed log — topics built independently via viem's encodeEventTopics
// (topic0 = keccak of the event signature; topic1 = authorizer; topic2 = nonce). verifyAtrHashOnChain
// reads only address/data/topics, so a partial Log is sufficient at runtime.
function makeLog(
  address: string,
  nonce: `0x${string}`,
  logIndex: number | null = null,
): Log {
  const topics = encodeEventTopics({
    abi: AUTHORIZATION_USED_ABI,
    eventName: "AuthorizationUsed",
    args: { authorizer: AUTHORIZER, nonce },
  });
  return { address, data: "0x", topics, logIndex } as unknown as Log;
}

describe("verifyAtrHashOnChain", () => {
  it("recovers the atrHash when AuthorizationUsed.nonce matches", () => {
    const receipt = { logs: [makeLog(ASSET, ATR)] };
    expect(
      verifyAtrHashOnChain(receipt, { asset: ASSET, atrHash: ATR }),
    ).toEqual({ ok: true, onChainNonce: ATR });
  });

  it("matches either spelling of the same atrHash bytes (LCP §2.5)", () => {
    const receipt = { logs: [makeLog(ASSET, ATR)] };
    // Uppercase DIGITS, lowercase `0x` — the prefix is part of what makes the string an atrHash.
    expect(
      verifyAtrHashOnChain(receipt, {
        asset: ASSET,
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }).ok,
    ).toBe(true);
  });

  it("does not match an atrHash param that is not well-formed", () => {
    // Decoded-byte comparison fails closed: `0X…` and a bare unprefixed value are not atrHashes, and
    // before 2026-08-08 the case-folded string comparison would have accepted the first of them.
    const receipt = { logs: [makeLog(ASSET, ATR)] };
    for (const bad of [ATR.toUpperCase(), ATR.slice(2), ""])
      expect(
        verifyAtrHashOnChain(receipt, { asset: ASSET, atrHash: bad }).ok,
      ).toBe(false);
  });

  it("does not match a different nonce", () => {
    const receipt = { logs: [makeLog(ASSET, OTHER)] };
    expect(
      verifyAtrHashOnChain(receipt, { asset: ASSET, atrHash: ATR }),
    ).toEqual({ ok: false, onChainNonce: null });
  });

  it("ignores AuthorizationUsed logs from a different asset (address filter)", () => {
    const receipt = {
      logs: [makeLog("0x9999999999999999999999999999999999999999", ATR)],
    };
    expect(
      verifyAtrHashOnChain(receipt, { asset: ASSET, atrHash: ATR }).ok,
    ).toBe(false);
  });

  it("ignores unrelated logs without throwing", () => {
    const junk = {
      address: ASSET,
      data: "0x",
      topics: ["0xdeadbeef"],
    } as unknown as Log;
    expect(
      verifyAtrHashOnChain({ logs: [junk] }, { asset: ASSET, atrHash: ATR }).ok,
    ).toBe(false);
  });
});

/**
 * The EXTRACT path (recover the committed nonce), as distinct from verifyAtrHashOnChain's CHECK path.
 * Every x402 `recover`/`observe`/`enumerate` reads through this, so what it returns IS the recovered
 * atrHash — a wrong nonce, a wrong logIndex or a dropped event all mis-attribute a settlement.
 *
 * Not testable, in either function: the `decoded.eventName === "AuthorizationUsed"` guard. The ABI
 * declares exactly one event, so viem either throws or returns that name — the check narrows the
 * TypeScript union and can never be false at runtime, so no test can exercise its other arm.
 */
describe("readAuthorizationUsed", () => {
  it("extracts the nonce, the authorizer, its logIndex and the emitting token from a settlement's logs", () => {
    expect(readAuthorizationUsed([makeLog(ASSET, ATR, 3)])).toEqual([
      {
        nonce: ATR,
        authorizer: AUTHORIZER.toLowerCase(),
        logIndex: 3,
        address: ASSET.toLowerCase(),
      },
    ]);
  });

  it("lowercases an upper-case on-chain nonce (recovered atrHash is compared lowercase)", () => {
    const [event] = readAuthorizationUsed([
      makeLog(ASSET, `0x${ATR.slice(2).toUpperCase()}`, 0),
    ]);
    expect(event?.nonce).toBe(ATR);
  });

  it("keeps every occurrence in log order — a tx can settle more than one authorization", () => {
    const events = readAuthorizationUsed([
      makeLog(ASSET, ATR, 0),
      makeLog(ASSET, OTHER, 1),
    ]);
    expect(events.map((e) => e.nonce)).toEqual([ATR, OTHER]);
    expect(events.map((e) => e.logIndex)).toEqual([0, 1]);
  });

  it("carries a null logIndex through rather than inventing a position", () => {
    // A pending-block log has no logIndex. Defaulting it to 0 would let x402's pinned-logIndex recover
    // match the wrong settlement.
    expect(
      readAuthorizationUsed([makeLog(ASSET, ATR)])[0]?.logIndex,
    ).toBeNull();
  });

  it("reads EVERY token's events when no asset filter is given", () => {
    const events = readAuthorizationUsed([
      makeLog(ASSET, ATR, 0),
      makeLog(OTHER_ASSET, OTHER, 1),
    ]);
    expect(events.map((e) => e.address)).toEqual([
      ASSET.toLowerCase(),
      OTHER_ASSET.toLowerCase(),
    ]);
  });

  it("reads ONLY the named token's events when an asset filter is given (case-insensitive)", () => {
    const logs = [makeLog(ASSET, ATR, 0), makeLog(OTHER_ASSET, OTHER, 1)];
    // The filter is supplied checksummed here and the log address is compared lowercased — a
    // case-sensitive comparison would silently return nothing and read as "never settled".
    expect(readAuthorizationUsed(logs, ASSET).map((e) => e.nonce)).toEqual([
      ATR,
    ]);
    expect(readAuthorizationUsed(logs, OTHER_ASSET.toUpperCase())).toHaveLength(
      1,
    );
  });

  it("skips logs that are not AuthorizationUsed without throwing, and returns [] for none", () => {
    const junk = {
      address: ASSET,
      data: "0x",
      topics: ["0xdeadbeef"],
    } as unknown as Log;
    expect(readAuthorizationUsed([junk, makeLog(ASSET, ATR, 7)])).toEqual([
      {
        nonce: ATR,
        authorizer: AUTHORIZER.toLowerCase(),
        logIndex: 7,
        address: ASSET.toLowerCase(),
      },
    ]);
    expect(readAuthorizationUsed([junk])).toEqual([]);
    expect(readAuthorizationUsed([])).toEqual([]);
  });
});

describe("refOf", () => {
  it("carries txHash and logIndex only when the caller knows them", () => {
    expect(refOf(8453, "0xabc", 7)).toEqual({
      chainId: 8453,
      txHash: "0xabc",
      logIndex: 7,
    });
    expect(refOf(8453, undefined, 7)).toEqual({ chainId: 8453, logIndex: 7 });
    expect(refOf(8453, "0xabc", null)).toEqual({
      chainId: 8453,
      txHash: "0xabc",
    });
    expect(refOf(8453, undefined, null)).toEqual({ chainId: 8453 });
  });

  it("leaves unknown fields ABSENT, never undefined-valued (exactOptionalPropertyTypes contract)", () => {
    expect("txHash" in refOf(1, undefined, 3)).toBe(false);
    expect("logIndex" in refOf(1, "0xabc", null)).toBe(false);
    expect(Object.keys(refOf(1, undefined, null))).toEqual(["chainId"]);
  });
});
