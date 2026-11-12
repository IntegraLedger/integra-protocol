// mpp-server-checks.json: the two checks an MPP resource server makes before anything moves, in mpp-charge.md's
// order. `place` takes the challenge's position; `tie` and `issuedDigest` read a challenge as its pairing's `unplaced`
// gives it; check 1 (`challengeBound`, then `issuedDigest` against the digest the resource server recorded) comes before
// check 2 (the pairing's `bound`); and an echoed `opaque` that is an object is read by its members. Every expected value
// is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal } from "../src/index.js";
import {
  MPP_BINDINGS,
  challengeBound,
  issuedDigest,
  place,
  tie,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-server-checks.json", import.meta.url), "utf8"));
const { H, link } = V.fixed;
const pairing = (id: string) => MPP_BINDINGS.find((b) => b.id === id)! as { bound(c: unknown): Promise<unknown> };

describe("mpp-server-checks.json: place takes the challenge's position", () => {
  for (const row of rowsOf(V.place.rows, "mpp-server-checks.json place.rows", { exact: 8 })) {
    it(`${V.place.case}: ${row.case}`, () => {
      const issued = structuredClone(V.place.issued);
      expect(place([issued], H, link, issued, row.position, row.agreementUrl)).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.place.taken.rows, "mpp-server-checks.json place.taken.rows", { exact: 2 })) {
    it(`${V.place.taken.case}: ${row.case}`, () => {
      expect(place(structuredClone(V.place.taken.doc), H, link, V.place.taken.option, row.position)).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.place.subscription.rows, "mpp-server-checks.json place.subscription.rows", { exact: 2 })) {
    it(`${V.place.subscription.case}: ${row.case}`, () => {
      const issued = V.place.subscription.issued;
      expect(place([issued], H, link, issued, row.position)).toEqual(row.expect);
    });
  }
  it(V.place.again.case, async () => {
    const issued = V.place.issued as MppChallenge;
    const first = place([issued], H, link, issued, 5) as MppChallenge[];
    const again = place([issued], H, link, issued, 5) as MppChallenge[];
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(await issuedDigest(first[0]!)).toBe(V.place.again.expectDigest);
    expect(await issuedDigest(issued)).toBe(V.place.again.expectDigest);
  });
});

describe("mpp-server-checks.json: tie and issuedDigest over the challenge as unplaced gives it", () => {
  for (const row of rowsOf(V.unplaced.rows, "mpp-server-checks.json unplaced.rows", { exact: 3 })) {
    it(row.case, async () => {
      expect(await issuedDigest(row.issued)).toBe(row.expectDigest);
      expect(await issuedDigest(row.placed)).toBe(row.expectDigest);
      expect(tie([row.placed])).toEqual(["mpp", { challenges: [row.expectTiedPlaced] }]);
    });
  }
});

/** Check 1, then check 2, as mpp-charge.md orders them: the first step that refuses, or null. */
async function inOrder(id: string, recorded: string, credential: unknown) {
  const bound = challengeBound(credential);
  const echoed = (credential as { challenge?: unknown }).challenge as MppChallenge;
  const digest = isRefusal(bound) ? undefined : await issuedDigest(echoed);
  const pays = await pairing(id).bound(credential);
  const first = isRefusal(bound) ? "challengeBound" : digest !== recorded ? "issuedDigest" : isRefusal(pays) ? "bound" : null;
  return { bound, digest, pays, first };
}

describe("mpp-server-checks.json: lcp's two checks, in mpp-charge.md's order", () => {
  for (const row of rowsOf(V.order.rows, "mpp-server-checks.json order.rows", { exact: 6 })) {
    it(row.case, async () => {
      const got = await inOrder(row.pairing, row.recorded, row.credential);
      expect(isRefusal(got.bound) ? got.bound : got.bound.h).toEqual(row.expect.challengeBound);
      if (!isRefusal(got.bound)) expect(got.digest === row.recorded).toBe(row.expect.digestEqual);
      expect(got.pays).toEqual(row.expect.bound);
      expect(got.first).toBe(row.expect.first);
      if (row.expect.link !== undefined) {
        const entry = MPP_BINDINGS.find((b) => b.id === row.pairing)!;
        expect(entry.data.link).toBe(row.expect.link);
      }
    });
  }
});

describe("mpp-server-checks.json: an echoed opaque that is an object is read by its members", () => {
  for (const row of rowsOf(V.opaqueObject.rows, "mpp-server-checks.json opaqueObject.rows", { exact: 4 })) {
    it(`${row.case}`, async () => {
      const bound = challengeBound(row.credential);
      expect(isRefusal(bound) ? bound : bound.h).toEqual(row.expect.challengeBound);
      if (row.expect.digestEqual !== undefined) {
        expect(await issuedDigest((row.credential as MppCredential).challenge)).toBe(V.opaqueObject.recorded);
      }
      expect(await pairing("mpp/charge/evm/authorization").bound(row.credential)).toEqual(row.expect.bound);
    });
  }
});
