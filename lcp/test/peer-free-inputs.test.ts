// With each rail's optional peer installed: TON's and Sui's `recover` and `mpp/charge/stellar`'s `build` answer
// peer-free-inputs.ts's inputs with the codes it gives, after the reads it states, and `recover` answers the vector
// files' recover rows with the vectors' values. Each rail's peer-missing test gives the same inputs the same codes
// without the peer.
import { describe, expect, it } from "vitest";
import { chargeStellar } from "../src/mpp.js";
import { exactSui } from "../src/sui.js";
import { exactTvm } from "../src/tvm.js";
import { stellarChargeChoices, suiRecoverDecodes, suiRecoverReads, tvmRecoverDecodes, tvmRecoverReads } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const RAILS = [
  { id: exactTvm.id, recover: exactTvm.recover, reads: tvmRecoverReads(), count: 6, decodes: tvmRecoverDecodes() },
  { id: exactSui.id, recover: exactSui.recover, reads: suiRecoverReads(), count: 9, decodes: suiRecoverDecodes() },
];

describe("recover with each rail's optional peer", () => {
  for (const rail of rowsOf(RAILS, "the rails whose recover decodes with an optional peer", { exact: 2 })) {
    it(`${rail.id}: each case recover answers before it decodes, after the reads it states`, async () => {
      for (const row of rowsOf(rail.reads, "peer-free-inputs.ts", { exact: rail.count })) {
        const c = row.reader();
        const got = await rail.recover(row.ref as never, c.reader as never);
        expect([row.case, got, c.reads()]).toEqual([row.case, { refused: true, code: row.expect }, row.reads]);
      }
    });

    it(`${rail.id}: the vector file's recover rows`, async () => {
      for (const row of rowsOf(rail.decodes, "the vector file's V4.recover")) {
        expect([row.case, await rail.recover(row.ref as never, row.reader().reader as never)]).toEqual([row.case, row.expect]);
      }
    });
  }
});

describe("mpp/charge/stellar's build with @stellar/stellar-sdk", () => {
  it("each choice and H it refuses before it reads the recipient", async () => {
    for (const row of rowsOf(stellarChargeChoices(), "peer-free-inputs.ts", { exact: 5 })) {
      expect([row.case, await chargeStellar.build(row.choice as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });
});
