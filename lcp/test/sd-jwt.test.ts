// Runs sd-jwt.json through the SD-JWT reader. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json } from "../src/core.js";
import { b64urlDecode, b64urlEncode, disclosureDigest, readSdJwt, type SdJwtCodes } from "../src/sd-jwt.js";

const V = JSON.parse(readFileSync(new URL("../vectors/sd-jwt.json", import.meta.url), "utf8"));
const CODES: SdJwtCodes = {
  malformed: "malformed",
  sdAlgUnsupported: "sd-alg-unsupported",
  unreferenced: "unreferenced",
  tooLarge: "too-large",
};

const read = async (p: string) => {
  const r = await readSdJwt(p, CODES);
  if ("refused" in r) throw new Error(r.code);
  return r;
};
const vcts = (dp: Json | undefined) =>
  Array.isArray(dp) ? (dp as { vct?: Json }[]).map((x) => x.vct) : null;

describe("sd-jwt.json", () => {
  it("C4: RFC 9901's published disclosure digests", async () => {
    for (const row of V.C4) expect(await disclosureDigest(row.disclosure)).toBe(row.expectDigest);
  });

  it("C6: L2i resolves both delegate_payload entries", async () => {
    const r = await read(V.C6.presentation);
    const dp = r.resolved["delegate_payload"];
    expect(vcts(dp)).toEqual(V.C6.expectDelegatePayloadVcts);
    expect((dp as Json[])[0]).toEqual(V.C6.expectCheckoutMandate);
    expect(r.resolved["_sd"]).toBeUndefined();
    expect(r.keyBinding).toBeNull();
  });

  it("C6 plant: a substituted disclosure the signed payload does not reference is refused", async () => {
    const r = await readSdJwt(V.C6plant.presentation, CODES);
    expect(r).toEqual({ refused: true, code: V.C6plant.expect });
    expect(JSON.stringify(r)).not.toContain(V.C6plant.E.slice(2));
  });

  it("C7: L2a with an undisclosed mandate, L3b and L1", async () => {
    for (const row of V.C7) {
      const r = await read(row.presentation);
      expect(vcts(r.resolved["delegate_payload"])).toEqual(row.expectDelegatePayloadVcts);
      if (row.expectCheckoutMandate !== undefined) {
        expect((r.resolved["delegate_payload"] as Json[])[0]).toEqual(row.expectCheckoutMandate);
      }
    }
  });

  it("base64url round trip over every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const s = b64urlEncode(all);
    expect(s).toBe(Buffer.from(all).toString("base64url"));
    expect(b64urlDecode(s)).toEqual(all);
    expect(b64urlDecode("A")).toBeNull();
    expect(b64urlDecode("AA==")).toBeNull();
    expect(b64urlDecode("A+")).toBeNull();
  });
});
