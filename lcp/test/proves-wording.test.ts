// Every record's `proves` claims only what the seller can show. It can show that it assembled the ATR, wrote it to
// its own storage and linked it in the challenge before approval; it cannot show that the buyer received it. The
// expected sentence is that statement, word for word.
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";

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

  it("no proves sentence says the ATR was delivered", () => {
    expect(all.filter((b) => b.proves.some((p) => /\bATR\b[^.]*\bdelivered\b/.test(p))).map((b) => b.id)).toEqual([]);
  });

  it("each sentence about the ATR before approval states the assembly, the write and the link", () => {
    const before = /The ATR was assembled[^.]*before approval/;
    const about = all.filter((b) => b.proves.some((p) => before.test(p)));
    expect(about.length).toBeGreaterThan(0);
    for (const b of about) {
      for (const p of b.proves.filter((s) => before.test(s))) {
        expect([b.id, p]).toEqual([b.id, expect.stringContaining(ASSEMBLY)]);
      }
    }
  });
});
