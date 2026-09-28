// When ripple-binary-codec's `decode` runs: never for a blob past the nesting cap (vectors/decoder-caps.json's XC5),
// and once for one presented payment or session opening however many times `bound` and `reference` read it. The
// codec's `decode` is counted through a module mock that calls the real one. Expected values are the vector files'.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MppChallenge, MppCredential } from "../src/mpp.js";
import { chargeXrpl, sessionXrpl } from "../src/mpp.js";
import { exactXrpl, type XrplPaymentPayload } from "../src/x402-exact-xrpl.js";
import { decodeBlob } from "../src/xrpl.js";

const calls = vi.hoisted(() => ({ decode: 0 }));
vi.mock("ripple-binary-codec", async (original) => {
  const real = await original<typeof import("ripple-binary-codec")>();
  return {
    ...real,
    decode: (...args: Parameters<typeof real.decode>) => {
      calls.decode++;
      return real.decode(...args);
    },
  };
});

const load = (n: string) => JSON.parse(readFileSync(new URL(`../vectors/${n}`, import.meta.url), "utf8"));
const CAPS = load("decoder-caps.json");
const X = load("x402-exact-xrpl.json");
const M = load("mpp-charge-xrpl.json");
const S = load("mpp-session-hedera-solana-xrpl.json");
const XC5 = CAPS.xrpl.rows.find((r: { name: string }) => r.name === "XC5");
const refused = (code: string) => ({ refused: true, code });

beforeEach(() => {
  calls.decode = 0;
});

describe("the nesting cap is checked before the codec decodes", () => {
  it("XC5: the largest blob, nesting to level 1010, is refused without a decode", async () => {
    expect(XC5.blob.length).toBe(4096);
    expect(await decodeBlob(XC5.blob)).toEqual(refused("xrpl/blob-malformed"));
    const p: XrplPaymentPayload = { x402Version: 2, accepted: X.V2.accepted, payload: { signedTxBlob: XC5.blob } };
    expect(await exactXrpl.reference(p)).toEqual(refused("xrpl/blob-malformed"));
    expect(await exactXrpl.bound(p)).toEqual(refused("xrpl/blob-malformed"));
    expect(calls.decode).toBe(0);
  });

  it("XC3: a blob at the cap is decoded once", async () => {
    const xc3 = CAPS.xrpl.rows.find((r: { name: string }) => r.name === "XC3");
    expect("refused" in (await decodeBlob(xc3.blob))).toBe(false);
    expect(calls.decode).toBe(1);
  });
});

describe("one decode per presented payment", () => {
  it("x402/exact/xrpl: reference, then bound, then reference again on one payment", async () => {
    const p: XrplPaymentPayload = { x402Version: 2, accepted: X.V2.accepted, payload: { signedTxBlob: X.V2.blob } };
    expect(await exactXrpl.reference(p)).toEqual(X.V2.expectReference);
    expect(await exactXrpl.bound(p)).toBe(X.V2.expectBound);
    expect(await exactXrpl.reference(p)).toEqual(X.V2.expectReference);
    expect(calls.decode).toBe(1);
  });

  it("x402/exact/xrpl: another blob on the same payload is decoded afresh", async () => {
    const p: XrplPaymentPayload = { x402Version: 2, accepted: X.V2.accepted, payload: { signedTxBlob: X.V2.blob } };
    expect(await exactXrpl.bound(p)).toBe(X.V2.expectBound);
    p.payload.signedTxBlob = X.V3.blob;
    expect(await exactXrpl.bound(p)).toEqual(refused("xrpl/carrier-mismatch"));
    expect(calls.decode).toBe(2);
  });

  it("mpp/charge/xrpl: bound, then reference, on one credential", async () => {
    const challenge = M.place.expect as MppChallenge & { id: string };
    const cr: MppCredential = { challenge, payload: { type: "transaction", blob: M.V3.blob } };
    expect(await chargeXrpl.bound(cr)).toBe(M.V3.expectBound);
    expect(await chargeXrpl.reference(cr)).toEqual(M.V3.expectReference);
    expect(calls.decode).toBe(1);
  });

  it("mpp/session/xrpl: bound, reference and the channel ref on one opening", async () => {
    const challenge = S.SS1.xrpl.placed as MppChallenge & { id: string };
    const cr: MppCredential = { challenge, payload: { action: "open", transaction: S.XS2.blob, amount: "100", signature: "00" } };
    expect(await sessionXrpl.bound(cr)).toBe(S.XS2.expectBound);
    expect(await sessionXrpl.reference(cr)).toEqual({ network: "xrpl:1", transaction: S.XS2.expectHash, lastLedgerSequence: 1000 });
    expect(await sessionXrpl.channel.ref(cr)).toEqual({ network: "xrpl:1", channel: S.XS2.expectChannel });
    expect(calls.decode).toBe(1);
  });

  it("a multi-signed blob is refused on every read, from one decode", async () => {
    const row = X.multisigned.rows[0];
    const p: XrplPaymentPayload = { x402Version: 2, accepted: X.V2.accepted, payload: { signedTxBlob: row.blob } };
    expect(await exactXrpl.reference(p)).toEqual(refused(row.expect));
    expect(await exactXrpl.bound(p)).toEqual(refused(row.expect));
    expect(calls.decode).toBe(1);
  });
});
