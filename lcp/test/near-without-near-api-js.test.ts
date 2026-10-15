// The NEAR pairing reads and writes NEP-366's delegate actions with borsh alone: with `near-api-js` absent and borsh
// installed, build, complete, bound, reference and nearCarrier give x402-exact-near.json's values (V1 and V2).
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it, vi } from "vitest";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));

vi.mock("near-api-js", () => {
  throw new Error("Cannot find package 'near-api-js'");
});

describe("NEAR with borsh and without near-api-js", () => {
  it("build, complete, bound, reference and nearCarrier give V1's and V2's values", async () => {
    const { exactNear, nearCarrier } = await import("../src/near.js");
    const O = V.fixed.O;
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const u = await exactNear.build(
      {
        required,
        accepted: O,
        payer: V.fixed.payer,
        publicKey: V.fixed.publicKey,
        accessKeyNonce: BigInt(V.fixed.accessKeyNonce),
        finalHeight: BigInt(V.fixed.finalHeight),
      },
      V.fixed.H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V1.expectRequestHash);
    const seed = Uint8Array.from(Buffer.from(V.fixed.seedHex, "hex"));
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(V.V2.expectSignedDelegateAction);
    expect(await exactNear.bound(p)).toBe(V.V2.expectBound);
    expect(await exactNear.reference(p)).toEqual(V.V2.expectReference);
    const c = nearCarrier(V.V2.expectSignedDelegateAction);
    if ("refused" in c) throw new Error(c.code);
    expect([c.h, c.payer, c.publicKey]).toEqual([V.fixed.H, V.fixed.payer, V.fixed.publicKey]);
  });
});
