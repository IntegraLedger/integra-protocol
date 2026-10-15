// With each rail's optional peer installed: the functions peer-free-inputs.ts names answer its inputs with the codes it
// gives, `recover` after the reads it states, and `recover` answers the vector files' recover rows with the vectors'
// values. Each rail's peer-missing test gives the same inputs the same codes without the peer.
import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { avmCarrier, exactAvm } from "../src/avm.js";
import { isAccount, isContract } from "../src/internal/stellar.js";
import { chargeStellar, issuedDigest, pairingsOf, pairingsOfPlaced, sessionXrpl, type MppChallenge } from "../src/mpp.js";
import { exactNear, nearCarrier } from "../src/near.js";
import { decodeStellarTx, muxedFor, stellarLocate, transferEventOf, transferEventTopics } from "../src/stellar.js";
import { decodeSuiTx, exactSui } from "../src/sui.js";
import { exactTvm, tvmCarrier } from "../src/tvm.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import {
  avmCarrierRows,
  avmComparedChoices,
  nearBuildChoices,
  nearCarrierInputs,
  nearChoice,
  stellarChargeChoices,
  stellarChargeStrkeyAnswers,
  stellarChargeStrkeyRows,
  stellarDigestRows,
  stellarEnvelopeInputs,
  stellarEventInputs,
  stellarLocateRows,
  stellarOccupied,
  stellarStrkeyAnswers,
  stellarStrkeyRows,
  stellarUnplacedRows,
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
/** x402-exact-stellar.json's V5 ref, which stellarLocate's searches read. */
const STELLAR_V5_REF = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8")).V5.ref;
/** x402-exact-algorand.json's H. */
const AVM_H = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8")).fixed.H as `0x${string}`;

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
  it("each choice and H it refuses before it reads the transaction", async () => {
    for (const row of rowsOf(stellarChargeChoices(), "peer-free-inputs.ts", { exact: 11 })) {
      expect([row.case, await chargeStellar.build(row.choice as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });
});

describe("the Stellar pairings' reads of a muxed address with @stellar/stellar-sdk", () => {
  it("unplaced, x402 and MPP", () => {
    const unplaced = { "x402/exact/stellar": exactStellar.unplaced, "mpp/charge/stellar": chargeStellar.unplaced } as const;
    for (const row of rowsOf(stellarUnplacedRows(), "peer-free-inputs.ts", { exact: 7 })) {
      expect([row.case, unplaced[row.pairing](row.option as never)]).toEqual([row.case, row.expect]);
    }
  });

  it("issuedDigest of the vectors' challenges", async () => {
    for (const row of rowsOf(stellarDigestRows(), "peer-free-inputs.ts", { exact: 3 })) {
      expect([row.case, await issuedDigest(row.challenge as MppChallenge)]).toEqual([row.case, row.expect]);
    }
  });

  it("mpp/charge/stellar's advertise of a challenge whose recipient is a muxed address", () => {
    const { challenge, h, link, expect: code } = stellarOccupied();
    const c = challenge as MppChallenge;
    expect(chargeStellar.advertise([c], h, link, c)).toEqual(refused(code));
  });
});

// The rows are held to the SDK's StrKey too: an account or a contract is one exactly when the SDK takes it as one.
describe("the Stellar strkeys with @stellar/stellar-sdk", () => {
  it("isAccount, isContract, muxedFor, and x402's read, advertise and build of an option holding each", async () => {
    const f = { isAccount, isContract, muxedFor, read: exactStellar.read, advertise: exactStellar.advertise, build: exactStellar.build };
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", { exact: 20 })) {
      const { s, member: _member, ...expected } = row;
      expect([row.case, StrKey.isValidEd25519PublicKey(s as string), StrKey.isValidContract(s as string)]).toEqual([row.case, row.isAccount, row.isContract]);
      expect(await stellarStrkeyAnswers(row, f as never)).toEqual(expected);
    }
  });
});

// The rows are held to the SDK's StrKey too: a recipient or currency is offered exactly when the SDK takes it as an
// account or a muxed account, or as a contract.
describe("mpp/charge/stellar's strkeys with @stellar/stellar-sdk", () => {
  it("pairingsOf, the filter, advertise, build and bound of a challenge holding each recipient or currency", async () => {
    const f = { pairingsOf, pairingsOfPlaced, advertise: chargeStellar.advertise, build: chargeStellar.build, bound: chargeStellar.bound };
    for (const row of rowsOf(stellarChargeStrkeyRows(), "peer-free-inputs.ts", { exact: 14 })) {
      const { s, member, ...expected } = row;
      const valid = member === "recipient" ? StrKey.isValidEd25519PublicKey(s) || StrKey.isValidMed25519PublicKey(s) : StrKey.isValidContract(s);
      expect([row.case, valid]).toEqual([row.case, row.filter.length > 0]);
      expect(await stellarChargeStrkeyAnswers(row, f as never, null)).toEqual(expected);
    }
  });
});

describe("stellarLocate with @stellar/stellar-sdk", () => {
  it("each search, its answer and its calls", async () => {
    for (const row of rowsOf(stellarLocateRows(), "peer-free-inputs.ts", { exact: 13 })) {
      const { reader, calls } = row.reader();
      const got = await stellarLocate(STELLAR_V5_REF, reader as never);
      expect([row.case, got, calls()]).toEqual([row.case, row.expect, row.calls]);
    }
  });
});

describe("x402/exact/algorand's build with algosdk", () => {
  it("each choice it refuses after the document and the option, which needs no algosdk", async () => {
    for (const row of rowsOf(avmComparedChoices(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await exactAvm.build(row.choice as never, AVM_H)]).toEqual([row.case, refused(row.expect)]);
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
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", {
      exact: 16,
      keep: ["each strkey that is neither an account nor a contract", (r) => !r.isAccount && !r.isContract],
      leave: ["each account or contract", (r) => r.isAccount || r.isContract],
    })) {
      expect([row.case, transferEventTopics(row.s as never)]).toEqual([row.case, refused("stellar/option-malformed")]);
    }
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
