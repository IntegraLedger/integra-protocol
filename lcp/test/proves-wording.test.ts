// A record's `proves` that speaks of the ATR before approval says it in the agreed words, word for word: that the ATR
// was assembled and delivered before approval. `x402/exact/eip155/erc7710`'s says it was assembled and delivered before
// the payment.
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";

const DELIVERED = "The ATR was assembled and delivered before approval";
const DELIVERED_BEFORE_PAYMENT = "The ATR was assembled and delivered before the payment";
const AGREED: Readonly<Record<string, string>> = { "x402/exact/eip155/erc7710": DELIVERED_BEFORE_PAYMENT };

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

  it("a proves sentence that says the ATR was delivered says it in the pairing's agreed words", () => {
    const delivered = /\bATR\b[^.]*\bdelivered\b/;
    let seen = 0;
    for (const b of all) {
      for (const p of b.proves.filter((s) => delivered.test(s))) {
        expect([b.id, p]).toEqual([b.id, expect.stringContaining(AGREED[b.id] ?? DELIVERED)]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
    const erc7710 = all.find((b) => b.id === "x402/exact/eip155/erc7710");
    expect(erc7710?.proves).toEqual([expect.stringContaining(DELIVERED_BEFORE_PAYMENT)]);
  });

  it("each sentence about the ATR before approval says it was assembled and delivered before approval", () => {
    const before = /The ATR was assembled[^.]*before approval/;
    const about = all.filter((b) => b.proves.some((p) => before.test(p)));
    expect(about.length).toBeGreaterThan(0);
    for (const b of about) {
      for (const p of b.proves.filter((s) => before.test(s))) {
        expect([b.id, p]).toEqual([b.id, expect.stringContaining(DELIVERED)]);
      }
    }
  });
});
