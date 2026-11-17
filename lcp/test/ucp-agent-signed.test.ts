// ucp/checkout/agent-signed against vectors/ucp-checkout-agent-signed.json: H read from the platform's signed request
// body once its Content-Digest is UCP's digest of those bytes; the member `build` gives; the payee broadcasting.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentSigned } from "../src/ucp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/ucp-checkout-agent-signed.json", import.meta.url), "utf8"));

describe("ucp/checkout/agent-signed", () => {
  for (const row of rowsOf<{ case: string; presented: unknown; expect?: string; expectRefusal?: string }>(V.bound, "bound rows", { min: 8 })) {
    it(`bound: ${row.case}`, async () => {
      const r = await agentSigned.bound(row.presented as never);
      expect(r).toEqual(row.expectRefusal !== undefined ? { refused: true, code: row.expectRefusal } : row.expect);
    });
  }

  for (const row of rowsOf<{ case: string; h: string; expect?: unknown; expectRefusal?: string }>(V.build, "build rows", { min: 2 })) {
    it(`build: ${row.case}`, async () => {
      const r = await agentSigned.build({ checkout: V.fixed.checkout }, row.h as never);
      expect(r).toEqual(row.expectRefusal !== undefined ? { refused: true, code: row.expectRefusal } : row.expect);
    });
  }

  it("read takes the checkout as the unsigned pairing reads it", () => {
    expect(agentSigned.read(V.fixed.checkout)).toMatchObject({ h: V.fixed.H, link: V.fixed.L });
  });

  it("the payee broadcasts", async () => {
    expect(await agentSigned.broadcaster({ body: V.fixed.body, contentDigest: V.fixed.contentDigest })).toBe("payee");
    expect(await agentSigned.broadcaster("not an object")).toEqual({ refused: true, code: "ucp/request-malformed" });
  });
});
