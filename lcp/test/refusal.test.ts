// Refusals are values the package makes. A value handed in, whatever its members, is never passed back as a refusal:
// `isRefusal` recognises only what `refusal` made, and the readers that hand a caller's payment or credential back
// refuse one that carries a `refused` member with their own malformed-input code.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemble, BINDINGS } from "../src/index.js";
import { credentialOf } from "../src/mpp-challenge.js";
import { isRefusal, refusal } from "../src/refusal.js";

const dir = new URL("../vectors/", import.meta.url);
const presentedOf: Map<string, unknown> = new Map(
  readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .flatMap((n) => {
      const d = JSON.parse(readFileSync(new URL(n, dir), "utf8")) as {
        buyer?: { rows: { name: string; pairing: string; input: { presented?: unknown } }[] };
      };
      return (d.buyer?.rows ?? []).filter((r) => r.name === "B6").map((r) => [r.pairing, r.input.presented] as const);
    }),
);

/** A caller's value in the shape of a refusal, with a code the package never returns from these calls. */
const shaped = () => ({ refused: true, code: "claim/store-unavailable", extra: "<b>x</b>" });
const withRefused = (p: unknown) => ({ ...(p as object), refused: true, code: "claim/store-unavailable" });
const codeOf = (v: unknown): string | undefined => (isRefusal(v) ? v.code : undefined);

describe("isRefusal", () => {
  it("is true for a refusal the package made, and for assemble's refusal", async () => {
    expect(isRefusal(refusal("x402/not-v2"))).toBe(true);
    const r = await assemble("6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40", ["bind", {}], [["id", new TextEncoder().encode("{}")]]);
    expect(isRefusal(r)).toBe(true);
    expect(r).toEqual({ refused: true, code: "core/slot-reserved" });
  });

  it("is false for a value of the same shape that the package did not make", () => {
    const made = refusal("x402/not-v2");
    expect(isRefusal({ refused: true, code: "x402/not-v2" })).toBe(false);
    expect(isRefusal(JSON.parse(JSON.stringify(made)))).toBe(false);
    expect(isRefusal(structuredClone(made))).toBe(false);
    expect(isRefusal({ ...made })).toBe(false);
    for (const v of [null, undefined, "x402/not-v2", 0, true, []]) expect(isRefusal(v)).toBe(false);
  });
});

describe("no entry point passes a caller's value back as a refusal", () => {
  for (const b of BINDINGS) {
    it(`${b.id}: bound, and reference where the pairing has one, of a value shaped as a refusal return the package's own refusal`, async () => {
      const calls = [b.bound, (b as { reference?: unknown }).reference].filter((f) => typeof f === "function");
      expect(calls.length).toBeGreaterThan(0);
      for (const f of calls as ((p: unknown) => unknown)[]) {
        const out = await f(shaped());
        expect(isRefusal(out)).toBe(true);
        expect(codeOf(out)).not.toBe("claim/store-unavailable");
      }
    });
  }

  it("MPP's credential reader refuses a credential carrying a refused member as malformed", () => {
    const c = presentedOf.get("mpp/charge/tempo/push");
    expect(isRefusal(credentialOf(c))).toBe(false);
    expect(credentialOf(withRefused(c))).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect(credentialOf(shaped())).toEqual({ refused: true, code: "mpp/credential-malformed" });
  });

  const malformed: Record<string, string> = {
    "x402/exact/eip155/eip3009": "x402/payload-malformed",
    "x402/exact/casper": "casper/payload-malformed",
  };
  for (const b of BINDINGS) {
    const p = presentedOf.get(b.id);
    const expected = b.id.startsWith("mpp/") ? "mpp/credential-malformed" : malformed[b.id];
    if (p === undefined || expected === undefined) continue;
    it(`${b.id}: the signed payment with a refused member added is ${expected}`, async () => {
      const bound = b.bound as (p: unknown) => Promise<unknown>;
      expect(typeof (await bound(structuredClone(p)))).toBe("string");
      expect(await bound(withRefused(structuredClone(p)))).toEqual({ refused: true, code: expected });
    });
  }

  for (const b of BINDINGS) {
    const fetchPresented = (b as { fetchPresented?: (c: unknown, r: unknown) => Promise<unknown> }).fetchPresented;
    const p = presentedOf.get(b.id);
    if (fetchPresented === undefined || p === undefined || !b.id.startsWith("mpp/")) continue;
    it(`${b.id}: fetchPresented refuses a credential carrying a refused member before any read`, async () => {
      let reads = 0;
      const reader = new Proxy({}, { get: () => (reads++, () => Promise.reject(new Error("no read"))) });
      expect(await fetchPresented(withRefused(structuredClone(p)), reader)).toEqual({
        refused: true,
        code: "mpp/credential-malformed",
      });
      expect(reads).toBe(0);
    });
  }
});
