// Runs sd-jwt.json through the SD-JWT reader. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json } from "../src/core.js";
import { refusal } from "../src/refusal.js";
import { b64urlDecode, b64urlEncode, disclosureDigest, readSdJwt, type SdJwtRefusals } from "../src/sd-jwt.js";

const V = JSON.parse(readFileSync(new URL("../vectors/sd-jwt.json", import.meta.url), "utf8"));
const REFUSALS: SdJwtRefusals = {
  malformed: () => refusal("malformed"),
  sdAlgUnsupported: () => refusal("sd-alg-unsupported"),
  unreferenced: () => refusal("unreferenced"),
  tooLarge: () => refusal("too-large"),
};

const read = async (p: string) => {
  const r = await readSdJwt(p, REFUSALS);
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
    const r = await readSdJwt(V.C6plant.presentation, REFUSALS);
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

  // RFC 9901 §7.1 step 4: a digest met more than once is rejected. A digest in _sd that names a two-element disclosure
  // or none, listed twice, in one _sd or in two, is the reader's malformed; listed once it is ignored, and C7's L2a
  // lists each kind once in _sd and once as {"...": digest}.
  it("C8: a digest in _sd that names no three-element disclosure is ignored once, and a second _sd listing is malformed", async () => {
    for (const row of V.C8.rows) {
      const r = await readSdJwt(row.presentation, REFUSALS);
      if (row.expect !== undefined) expect(r, row.case).toEqual({ refused: true, code: row.expect });
      else expect((await read(row.presentation)).resolved, row.case).toEqual(row.expectResolved);
    }
  });

  // RFC 9901 §4.2.3: a disclosure's digest is the base64url SHA-256 of its ASCII text (Node's crypto computes it here).
  // The resolved payload is JSON the package reads, so it nests at most 64 levels (vectors/core-vectors.json
  // `jsonDepth`), the payload counting 1 and each disclosed value sitting where its reference sits; one level more, or
  // the 16 chained disclosures the reader admits each nesting 62, is too large, on any host.
  it("the resolved payload nests at most 64 levels", async () => {
    const nest = (levels: number, inner: string) => '{"a":'.repeat(levels - 1) + inner + "}".repeat(levels - 1);
    const sha = (d: string) => createHash("sha256").update(d, "ascii").digest("base64url");
    const presentation = (payloadLevels: number, values: string[]) => {
      let ref = "";
      const disclosures: string[] = [];
      for (let i = values.length - 1; i >= 0; i--) {
        const value = ref === "" ? values[i]! : values[i]!.replace("{}", `{"_sd":["${ref}"]}`);
        const d = Buffer.from(`["s${i}","m${i}",${value}]`).toString("base64url");
        disclosures.unshift(d);
        ref = sha(d);
      }
      const payload = nest(payloadLevels, `{"_sd":["${ref}"]}`);
      const jwt = `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from(payload).toString("base64url")}.sig`;
      return `${jwt}~${disclosures.join("~")}~`;
    };
    expect("refused" in (await readSdJwt(presentation(63, ['{"b":1}']), REFUSALS))).toBe(false);
    expect(await readSdJwt(presentation(63, ['{"b":{"c":1}}']), REFUSALS)).toEqual({ refused: true, code: "too-large" });
    const chain = Array.from({ length: 16 }, () => nest(62, "{}"));
    expect(await readSdJwt(presentation(63, chain), REFUSALS)).toEqual({ refused: true, code: "too-large" });
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
