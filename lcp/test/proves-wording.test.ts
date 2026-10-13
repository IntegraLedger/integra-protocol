// A record's `proves` that speaks of the ATR before approval says it in one of two sentences, word for word: that the
// ATR was assembled and delivered before approval, or that it was assembled, written to the seller's storage and linked
// in the challenge before approval.
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";

const DELIVERED = "The ATR was assembled and delivered before approval";
const ASSEMBLY = "The ATR was assembled, written to the seller's storage and linked in the challenge before approval";

/** Every string under a member named `proves`, at any depth of a pairing's `pattern`. */
function provesOf(v: unknown, out: string[] = []): string[] {
  if (typeof v !== "object" || v === null) return out;
  for (const [k, x] of Object.entries(v)) {
    if (k === "proves" && typeof x === "string") out.push(x);
    else provesOf(x, out);
  }
  return out;
}

describe("proves: what the record shows about the ATR before approval", () => {
  const all = BINDINGS.map((b) => ({ id: b.id, proves: provesOf((b as { pattern?: unknown }).pattern) }));

  it("every pairing has a proves sentence", () => {
    expect(all.filter((b) => b.proves.length === 0).map((b) => b.id)).toEqual([]);
  });

  it("a proves sentence that says the ATR was delivered says it was assembled and delivered before approval", () => {
    const delivered = /\bATR\b[^.]*\bdelivered\b/;
    let seen = 0;
    for (const b of all) {
      for (const p of b.proves.filter((s) => delivered.test(s))) {
        expect([b.id, p]).toEqual([b.id, expect.stringContaining(DELIVERED)]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("each sentence about the ATR before approval is one of the two, word for word", () => {
    const before = /The ATR was assembled[^.]*before approval/;
    const about = all.filter((b) => b.proves.some((p) => before.test(p)));
    expect(about.length).toBeGreaterThan(0);
    for (const b of about) {
      for (const p of b.proves.filter((s) => before.test(s))) {
        expect([b.id, p.includes(DELIVERED) || p.includes(ASSEMBLY)]).toEqual([b.id, true]);
      }
    }
  });
});
