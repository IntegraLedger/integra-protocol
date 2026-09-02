import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assemble, type Slot } from "../src/assemble.js";
import { hashAtr } from "../src/atrHash.js";

type OkCase = {
  name: string;
  input: Slot[];
  expected: { file: string; hash: string };
};
type BadCase = { name: string; input: Slot[]; error: string };
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/envelope/assemble.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: (OkCase | BadCase)[];
};
const ok = V.cases.filter((c) => !("error" in c)) as OkCase[];
const bad = V.cases.filter((c) => "error" in c) as BadCase[];

describe("assemble — vectors", () => {
  it.each(ok)(
    "$name is byte-stable and self-hashing",
    async ({ input, expected }) => {
      const { atrBytes, atrHash } = await assemble(input);
      expect(new TextDecoder().decode(atrBytes)).toBe(expected.file);
      expect(atrHash).toBe(expected.hash);
      expect(atrHash).toBe(
        await hashAtr(new TextEncoder().encode(expected.file)),
      );
    },
  );
  it.each(bad)("$name fails fast", async ({ input, error }) => {
    await expect(assemble(input)).rejects.toMatchObject({ code: error });
  });
});

describe("assemble — properties", () => {
  // Safe extra slots: unique names from a pool that excludes lcp/terms/id and all integer-like names, string values.
  const slotName = fc.constantFrom(
    "alpha",
    "beta",
    "gamma",
    "delta",
    "recourse",
    "declarations",
    "offer",
    "intent",
    "custom",
    "meta",
  );
  const extras = fc.uniqueArray(
    fc.record({ slot: slotName, value: fc.string() }),
    {
      selector: (c) => c.slot,
      maxLength: 4,
    },
  );

  it("is self-hashing, deterministic, order-stable, and preserves unknown slots", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        extras,
        async (terms, id, extra) => {
          const slots: Slot[] = [
            { slot: "terms", value: terms },
            { slot: "id", value: id },
            ...extra,
          ];
          const { atrBytes, atrHash } = await assemble(slots);
          // (a) self-hashing
          expect(await hashAtr(atrBytes)).toBe(atrHash);
          // (b) determinism
          const again = await assemble(slots);
          expect(new TextDecoder().decode(again.atrBytes)).toBe(
            new TextDecoder().decode(atrBytes),
          );
          // (c) unknown slots survive + (d) emitted key order is exactly lcp, terms, id, ...extras-in-order
          const parsed = JSON.parse(
            new TextDecoder().decode(atrBytes),
          ) as Record<string, unknown>;
          expect(Object.keys(parsed)).toEqual([
            "lcp",
            "terms",
            "id",
            ...extra.map((e) => e.slot),
          ]);
          for (const e of extra) expect(parsed[e.slot]).toBe(e.value);
        },
      ),
    );
  });

  it("(e) rejects any integer-like slot name with assemble/numeric-slot", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), async (n) => {
        const slots: Slot[] = [
          { slot: "terms", value: "t" },
          { slot: "id", value: "i" },
          { slot: String(n), value: "x" },
        ];
        await expect(assemble(slots)).rejects.toMatchObject({
          code: "assemble/numeric-slot",
        });
      }),
    );
  });
});
