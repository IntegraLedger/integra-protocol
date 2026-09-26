import { describe, expect, it } from "vitest";
import { BINDINGS, type Binding, type PresentedOn } from "../src/index.js";

// Every pairing's `bound` and `reference` take `unknown`: a caller holding any Binding calls them with whatever the
// buyer presented, without a cast. These lines compile only while that holds.
type TakesUnknown<F> = F extends (presented: unknown) => unknown ? true : false;
type BoundTakes<B> = B extends { bound: infer F } ? TakesUnknown<F> : false;
type ReferenceTakes<B> = B extends { reference: infer F } ? TakesUnknown<F> : true;
type All<T extends boolean> = false extends T ? false : true;
const everyBound: All<BoundTakes<Binding>> = true;
const everyReference: All<ReferenceTakes<Binding>> = true;

// The refusal rule: no function throws. Whatever is presented, `bound` and `reference` answer with a value.
const JUNK: readonly unknown[] = [
  undefined,
  null,
  0,
  "x",
  [],
  {},
  { x402Version: 2 },
  { x402Version: 2, accepted: {}, payload: {} },
  { challenge: {}, payload: {} },
  { challenge: { id: "x", realm: "r", method: "m", intent: "i", request: "e30" }, payload: { type: "hash" } },
];

describe("what a pairing is presented", () => {
  it("every bound and reference takes unknown", () => {
    expect([everyBound, everyReference]).toEqual([true, true]);
  });

  it("every surface names what its buyers present", () => {
    const surfaces: Record<keyof PresentedOn, true> = { ack: true, acp: true, ap2: true, card: true, mpp: true, ucp: true, x402: true };
    const named = new Set(BINDINGS.map((b) => b.id.split("/")[0]!));
    expect([...named].filter((s) => !(s in surfaces))).toEqual([]);
  });

  for (const b of BINDINGS) {
    it(`${b.id}: bound and reference refuse what is not a payment, never throwing`, async () => {
      for (const p of JUNK) {
        const h = await b.bound(p);
        expect(h, JSON.stringify(p)).toMatchObject({ refused: true });
        if ("reference" in b && typeof b.reference === "function") {
          const r: unknown = await b.reference(p);
          expect(r, JSON.stringify(p)).toMatchObject({ refused: true });
        }
      }
    });
  }
});
