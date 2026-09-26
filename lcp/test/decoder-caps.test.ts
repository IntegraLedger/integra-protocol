// The decoder caps: vectors/decoder-caps.json. XRPL binary, msgpack and ScVal each have a nesting cap and an element
// cap, and each row says whether the caps admit its input.
import { readFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { MSGPACK_MAX_DEPTH, msgpackWithinCaps } from "../src/avm.js";
import { decodeStellarTx, SCVAL_MAX_DEPTH, SCVAL_MAX_ELEMENTS, scValsWithinCaps } from "../src/stellar.js";
import { decodeBlob, XRPL_MAX_DEPTH, XRPL_MAX_FIELDS } from "../src/xrpl.js";

const V = JSON.parse(readFileSync(new URL("../vectors/decoder-caps.json", import.meta.url), "utf8"));
type Row = { name: string; case: string; accept: boolean };

describe("XRPL binary: STObject and STArray nesting, and fields", () => {
  it("the caps are the vectors'", () => {
    expect([XRPL_MAX_DEPTH, XRPL_MAX_FIELDS]).toEqual([V.xrpl.maxDepth, V.xrpl.maxFields]);
  });
  for (const r of V.xrpl.rows as (Row & { blob: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept ? "decoded" : "xrpl/blob-malformed"}`, async () => {
      const d = await decodeBlob(r.blob);
      if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual({ refused: true, code: "xrpl/blob-malformed" });
    });
  }
});

describe("msgpack: array and map nesting, declared lengths, one value", () => {
  it("the cap is the vectors'", () => {
    expect(MSGPACK_MAX_DEPTH).toBe(V.msgpack.maxDepth);
  });
  for (const r of V.msgpack.rows as (Row & { hex: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept}`, () => {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(r.hex, "hex")))).toBe(r.accept);
    });
  }
  it("every signed transaction in the Algorand vectors is within the caps", () => {
    const A = readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8");
    const entries = [...A.matchAll(/"(g[A-Za-z0-9+/]{40,}={0,2})"/g)].map((m) => m[1]!);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(e, "base64")))).toBe(true);
  });
});

describe("ScVal: vector and map nesting, elements, and invocation nesting", () => {
  it("the caps are the vectors'", () => {
    expect([SCVAL_MAX_DEPTH, SCVAL_MAX_ELEMENTS]).toEqual([V.scval.maxDepth, V.scval.maxElements]);
  });
  for (const r of V.scval.rows as (Row & { xdr: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept}`, () => {
      expect(scValsWithinCaps(xdr.ScVal.fromXdr(Buffer.from(r.xdr, "base64")).toXdrObject())).toBe(r.accept);
    });
  }
  for (const r of V.scval.envelopes as (Row & { xdr: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept ? "decoded" : "stellar/tx-malformed"}`, () => {
      const d = decodeStellarTx(r.xdr, "stellar:testnet");
      if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual({ refused: true, code: "stellar/tx-malformed" });
    });
  }
});
