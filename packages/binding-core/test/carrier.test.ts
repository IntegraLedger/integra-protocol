import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CarrierError, type CarrierOp, carrierOp } from "../src/carrier.js";

type Case = {
  name: string;
  input: CarrierOp;
  expected?: unknown;
  error?: string;
};
const load = (f: string): Case[] =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../../vectors/carrier/${f}`, import.meta.url),
        "utf8",
      ),
    ) as { cases: Case[] }
  ).cases;

for (const file of [
  "string-parse.json",
  "type-registry.json",
  "round-trip.json",
]) {
  describe(`carrier: ${file}`, () => {
    const cases = load(file);
    const ok = cases.filter((c) => c.error === undefined);
    const bad = cases.filter((c) => c.error !== undefined);

    it.each(ok)("$name", ({ input, expected }) => {
      expect(carrierOp(input)).toEqual(expected);
    });
    it.each(bad)("$name rejects with $error", ({ input, error }) => {
      let thrown: unknown;
      try {
        carrierOp(input);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(CarrierError);
      expect((thrown as CarrierError).code).toBe(error);
    });
  });
}
