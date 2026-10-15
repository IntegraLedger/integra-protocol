// With each rail's optional peer installed: the functions peer-free-inputs.ts names answer its inputs with the codes it
// gives, `recover` after the reads it states, and `recover` answers the vector files' recover rows with the vectors'
// values. Each rail's peer-missing test gives the same inputs the same codes without the peer.
import { describe, expect, it } from "vitest";
import { avmCarrier } from "../src/avm.js";
import { chargeStellar, sessionXrpl } from "../src/mpp.js";
import { exactNear, nearCarrier } from "../src/near.js";
import { decodeStellarTx, transferEventOf, transferEventTopics } from "../src/stellar.js";
import { decodeSuiTx, exactSui } from "../src/sui.js";
import { exactTvm, tvmCarrier } from "../src/tvm.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import {
  avmCarrierRows,
  nearBuildChoices,
  nearCarrierInputs,
  nearChoice,
  stellarChargeChoices,
  stellarEnvelopeInputs,
  stellarEventInputs,
  suiDecodeInputs,
  suiRecoverDecodes,
  suiRecoverReads,
  tvmCarrierInputs,
  tvmRecoverDecodes,
  tvmRecoverReads,
  xrplPayments,
  xrplWithinInputs,
  xrplWithinTwoFaults,
} from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const refused = (code: string) => ({ refused: true, code });

const RAILS = [
  { id: exactTvm.id, recover: exactTvm.recover, reads: tvmRecoverReads(), count: 9, decodes: tvmRecoverDecodes() },
  { id: exactSui.id, recover: exactSui.recover, reads: suiRecoverReads(), count: 11, decodes: suiRecoverDecodes() },
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
    for (const row of rowsOf(stellarChargeChoices(), "peer-free-inputs.ts", { exact: 9 })) {
      expect([row.case, await chargeStellar.build(row.choice as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });
});

describe("the decoders and carriers with each rail's optional peer", () => {
  it("tvmCarrier: a network, size, base64 or bag-of-cells layout it refuses", () => {
    for (const row of rowsOf(tvmCarrierInputs(), "peer-free-inputs.ts", { exact: 6 })) {
      expect([row.case, tvmCarrier(row.boc as never, row.network as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });

  it("decodeSuiTx: a form, size or tag it refuses", () => {
    for (const row of rowsOf(suiDecodeInputs(), "peer-free-inputs.ts", { exact: 8 })) {
      expect([row.case, decodeSuiTx(row.base64 as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });

  it("nearCarrier: a form or size it refuses", () => {
    for (const row of rowsOf(nearCarrierInputs(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, nearCarrier(row.sda as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });

  it("avmCarrier: V2's payment and each V3.refusals row", () => {
    for (const row of rowsOf(avmCarrierRows(), "peer-free-inputs.ts", { min: 2 })) {
      expect([row.case, avmCarrier(row.presented as never)]).toEqual([row.case, row.expect]);
    }
  });

  it("decodeStellarTx, transferEventTopics and transferEventOf: a network, size, base64, tag or form they refuse", () => {
    for (const row of rowsOf(stellarEnvelopeInputs(), "peer-free-inputs.ts", { exact: 11 })) {
      expect([row.case, decodeStellarTx(row.xdr as never, row.network as never)]).toEqual([row.case, refused(row.expect)]);
    }
    expect(transferEventTopics(7 as never)).toEqual(refused("stellar/option-malformed"));
    for (const row of rowsOf(stellarEventInputs(), "peer-free-inputs.ts", { exact: 5 })) {
      expect([row.case, transferEventOf(row.topic as never, row.value as never)]).toEqual([row.case, refused("stellar/event-malformed")]);
    }
  });
});

describe("builds and reads that check what needs no peer first, with the peer", () => {
  it("x402/exact/near's build: the file's choice builds, and each choice it refuses before it writes with borsh", async () => {
    const { choice, h } = nearChoice();
    expect("refused" in (await exactNear.build(choice as never, h))).toBe(false);
    for (const row of rowsOf(nearBuildChoices(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await exactNear.build(row.choice as never, h)]).toEqual([row.case, refused(row.expect)]);
    }
  });

  it("x402/exact/xrpl's bound and reference: an option whose invoiceId is not an LCP string", async () => {
    for (const row of rowsOf(xrplPayments(), "peer-free-inputs.ts", { exact: 2 })) {
      expect([row.case, await exactXrpl.bound(row.payment as never), await exactXrpl.reference(row.payment as never)]).toEqual([
        row.case,
        refused("xrpl/carrier-not-lcp"),
        refused("xrpl/carrier-not-lcp"),
      ]);
    }
  });

  it("mpp/session/xrpl's buildWithin: an H, amount or action it refuses before it decodes the opening", async () => {
    for (const row of rowsOf(xrplWithinInputs(), "peer-free-inputs.ts", { exact: 6 })) {
      expect([row.case, await sessionXrpl.buildWithin(row.within as never, row.h as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });

  it("mpp/session/xrpl's buildWithin: two faults, one in the opening, get the code of the check made first", async () => {
    for (const row of rowsOf(xrplWithinTwoFaults(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await sessionXrpl.buildWithin(row.within as never, row.h as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });
});
