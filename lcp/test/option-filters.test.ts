// Each arm of six pairings' option filters, one option per arm (the rows in option-filter-rows.ts). The filter is what
// `pairingOf`, `advertise`, `read` and `build` share, so each row asserts the root `pairingOf` and `advertise`.
import { describe, expect, it } from "vitest";
import { pairingOf } from "../src/index.js";
import { changed, doc, H, LINK, RAILS } from "./option-filter-rows.js";

describe("each option filter arm, one option per arm", () => {
  for (const rail of RAILS) {
    describe(rail.id, () => {
      it("serves the fixed option", () => {
        expect(pairingOf(rail.option)).toBe(rail.id);
        expect(rail.advertise(doc(rail.option), H, LINK, rail.option)).not.toHaveProperty("refused");
      });
      for (const [arm, change, code] of rail.refused) {
        it(`${arm}: ${code}, and no pairing`, () => {
          const o = changed(rail.option, change);
          expect(rail.advertise(doc(o), H, LINK, o)).toEqual({ refused: true, code });
          expect(pairingOf(o)).toBeUndefined();
        });
      }
      for (const [arm, change] of rail.served ?? []) {
        it(`serves ${arm}`, () => expect(pairingOf(changed(rail.option, change))).toBe(rail.id));
      }
    });
  }
});
