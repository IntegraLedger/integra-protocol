// TON's SDK and NEAR's borsh are optional peers. With them absent, the entry points and the package root still
// import, and each function refuses `<rail>/peer-missing` (the vectors' refusal) only at the step that decodes or writes
// with the peer, never throwing; TON's status needs no peer and gives every answer it gives with it. A check that needs
// no peer comes first and gives the code it gives with the peer: TON's option filter reads raw addresses itself, so
// pairingOf, read and advertise need no peer; both pairings' build check H, then the form of the choice's own members,
// then read the choice's document and the option's place in it; TON's build, bound and reference read every BoC's bytes
// (base64, size, layout, CRC32C) before @ton/core decodes its cells; TON's recover reads the ref, the reader, the
// transaction and its body's bytes before it decodes the body's cells; and tvmCarrier and nearCarrier check their
// input's size and form before they decode it.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildChoices } from "./build-choices.js";
import {
  BAD_H,
  hFirstChoices,
  memberFirstChoices,
  membersOf,
  nearBuildChoices,
  nearCarrierInputs,
  nearChoice,
  tvmCarrierInputs,
  tvmPeerStepRows,
  tvmRecoverDecodes,
  tvmRecoverReads,
  tvmStatusRows,
} from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const TVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tvm.json", import.meta.url), "utf8"));
const NEAR = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const EVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8"));
const code = (v: { agreedRefusals: { rows: { expect: string }[] } }) =>
  v.agreedRefusals.rows.find((r) => r.expect.endsWith("/peer-missing"))!.expect;

vi.mock("@ton/core", () => {
  throw new Error("Cannot find package '@ton/core'");
});
vi.mock("borsh", () => {
  throw new Error("Cannot find package 'borsh'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without the TON and NEAR peers", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports with both pairings in BINDINGS", { timeout: IMPORT_MS }, () => {
    const ids = root.BINDINGS.map((b) => b.id);
    expect(ids).toContain("x402/exact/tvm");
    expect(ids).toContain("x402/exact/near");
  });

  // The cells of a BoC whose bytes pass, and the cells lcpComment writes, need @ton/core.
  it("TON: every function that decodes or writes a cell refuses tvm/peer-missing there", { timeout: IMPORT_MS }, async () => {
    const { exactTvm, lcpComment, tvmCarrier } = await import("../src/tvm.js");
    const refused = { refused: true, code: code(TVM) };
    const placed = TVM.fixed.placed;
    const doc = { x402Version: 2 as const, resource: TVM.fixed.resource, accepts: [placed] };
    expect(lcpComment(TVM.fixed.H)).toEqual(refused);
    expect(tvmCarrier("te6ccgEBAQEAAgAAAA==", "tvm:-239")).toEqual(refused);
    const payment = { x402Version: 2, accepted: placed, payload: { settlementBoc: "te6ccgEBAQEAAgAAAA==", asset: placed.asset } };
    expect(await exactTvm.bound(payment)).toEqual(refused);
    expect(await exactTvm.reference(payment)).toEqual(refused);
    expect(await exactTvm.build({ ...membersOf(exactTvm.id), required: doc, accepted: placed } as never, TVM.fixed.H)).toEqual(refused);
  });

  // peer-free-inputs.test.ts gives every row its answer with @ton/core: without it each gives the same, except a row
  // that reaches the decode of a BoC's cells or the writing of the request's (`without`).
  it("TON: pairingOf, read, advertise, bound, reference and build answer as with the peer, up to the step that decodes or writes", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const f = { pairingOf: root.pairingOf, ...exactTvm };
    const rows = rowsOf(tvmPeerStepRows(), "peer-free-inputs.ts", { exact: 36 });
    for (const row of rows) {
      expect([row.case, await row.call(f as never)]).toEqual([row.case, row.without ?? row.expect]);
    }
    expect(rows.filter((row) => row.without !== undefined).map((row) => row.without)).toEqual(new Array(7).fill(code(TVM)));
  });

  // peer-free-inputs.test.ts gives the same reads with @ton/core: status decodes no cell and compares raw addresses
  // itself.
  it("TON: status gives every read the answer it gives with the peer, after the same reads", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    for (const row of rowsOf(tvmStatusRows(), "peer-free-inputs.ts", { exact: 20 })) {
      const c = row.reader();
      const got = await exactTvm.status(row.ref as never, c.reader as never);
      expect([row.case, got, c.reads()]).toEqual([row.case, row.expect, row.reads]);
    }
    expect(tvmStatusRows().every((row) => row.without === undefined)).toBe(true);
  });

  // Each case peer-free-inputs.ts lists gets the code it gets with the peer, after the same reads
  // (peer-free-inputs.test.ts). The vector file's recover row holds a body, which recover cannot decode without the peer.
  it("TON: recover refuses tvm/peer-missing only for a transaction whose body it decodes", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    for (const row of rowsOf(tvmRecoverReads(), "peer-free-inputs.ts", { exact: 10 })) {
      const c = row.reader();
      const got = await exactTvm.recover(row.ref as never, c.reader as never);
      expect([row.case, got, c.reads()]).toEqual([row.case, { refused: true, code: row.expect }, row.reads]);
    }
    for (const row of rowsOf(tvmRecoverDecodes(), "x402-exact-tvm.json V4.recover")) {
      const c = row.reader();
      expect([row.case, await exactTvm.recover(row.ref as never, c.reader as never), c.reads()]).toEqual([row.case, { refused: true, code: code(TVM) }, 1]);
    }
  });

  // Buyer row B2's document, which TON's read reads with the peer: its option is TON's, and its filter reads its raw
  // addresses without the peer, so read serves it as it does with the peer. With no TON option in it, read gives the
  // answer it gives with the peer.
  it("TON: read serves a document holding a TON option as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const [b2] = rowsOf(TVM.buyer.rows as { name: string; input: { doc: { accepts: unknown[] } } }[], "x402-exact-tvm.json buyer.rows", {
      exact: 1,
      keep: ["row B2, whose document carries a placed TON option", (r) => r.name === "B2"],
      leave: ["every other row", (r) => r.name !== "B2"],
    });
    const doc = b2!.input.doc;
    const served = (r: unknown) => (r as { offer: { options: unknown[] } }).offer.options;
    expect(served(exactTvm.read(doc as never))).toEqual(doc.accepts);
    expect(served(exactTvm.read({ ...doc, accepts: [...doc.accepts, EVM.fixed.O] } as never))).toEqual(doc.accepts);
    const none = { refused: true, code: "x402/no-payable-option" };
    expect(exactTvm.read({ ...doc, accepts: [] } as never)).toEqual(none);
    expect(exactTvm.read({ ...doc, accepts: [EVM.fixed.O] } as never)).toEqual(none);
  });

  // Buyer row B2's option with one fault the filter reads without the peer. With @ton/core, read gives
  // x402/no-payable-option for it and advertise tvm/option-malformed, and without it they give the same.
  it("TON: an option's fault that needs no peer gets the code it gets with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const [b2] = rowsOf(TVM.buyer.rows as { name: string; input: { doc: { accepts: { extra: object }[] } } }[], "x402-exact-tvm.json buyer.rows", {
      exact: 1,
      keep: ["row B2, whose document carries a placed TON option", (r) => r.name === "B2"],
      leave: ["every other row", (r) => r.name !== "B2"],
    });
    const doc = b2!.input.doc;
    const O = doc.accepts[0]!;
    const faults = [{ ...O, amount: "x" }, { ...O, maxTimeoutSeconds: 0 }, { ...O, extra: { ...O.extra, areFeesSponsored: false } }];
    for (const bad of rowsOf(faults, "the three faults", { exact: 3 })) {
      expect(exactTvm.read({ ...doc, accepts: [bad] } as never)).toEqual({ refused: true, code: "x402/no-payable-option" });
      const issued = { x402Version: 2 as const, resource: TVM.fixed.resource, accepts: [bad] };
      expect(exactTvm.advertise(issued as never, TVM.fixed.H, TVM.fixed.link, bad as never)).toEqual({ refused: true, code: "tvm/option-malformed" });
    }
  });

  it("TON: build answers a choice of another pairing's option, or of a document that is not v2, as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    for (const row of rowsOf(buildChoices(TVM.fixed.O, TVM.fixed.resource, membersOf("x402/exact/tvm")), "build-choices.ts", { exact: 2 })) {
      expect(await exactTvm.build(row.choice as never, TVM.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("TON: tvmCarrier answers a network, size, base64, bag-of-cells layout or CRC32C it refuses as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { tvmCarrier } = await import("../src/tvm.js");
    for (const row of rowsOf(tvmCarrierInputs(), "peer-free-inputs.ts", { exact: 7 })) {
      expect([row.case, tvmCarrier(row.boc as never, row.network as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  it("TON and NEAR: build answers a malformed H as it does with the peer, whatever the choice", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const { exactNear } = await import("../src/near.js");
    for (const [pairing, own] of [[exactTvm, TVM.fixed.O], [exactNear, NEAR.fixed.O]] as const) {
      for (const row of rowsOf(hFirstChoices(pairing.id, own), "peer-free-inputs.ts", { exact: 4 })) {
        expect([pairing.id, row.case, await pairing.build(row.choice as never, BAD_H as never)]).toEqual([
          pairing.id,
          row.case,
          { refused: true, code: "x402/payload-malformed" },
        ]);
      }
    }
  });

  it("TON and NEAR: build answers a malformed choice member as it does with the peer, whatever the option", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const { exactNear } = await import("../src/near.js");
    for (const [pairing, V, count] of [[exactTvm, TVM, 21], [exactNear, NEAR, 12]] as const) {
      for (const row of rowsOf(memberFirstChoices(pairing.id, V.fixed.O), "peer-free-inputs.ts", { exact: count })) {
        expect([pairing.id, row.case, await pairing.build(row.choice as never, V.fixed.H)]).toEqual([
          pairing.id,
          row.case,
          { refused: true, code: row.expect },
        ]);
      }
    }
  });

  it("NEAR: nearCarrier and build answer a form, size or choice member they refuse as they do with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactNear, nearCarrier } = await import("../src/near.js");
    for (const row of rowsOf(nearCarrierInputs(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, nearCarrier(row.sda as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
    const { h } = nearChoice();
    for (const row of rowsOf(nearBuildChoices(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await exactNear.build(row.choice as never, h)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  it("NEAR: build answers a choice of another pairing's option, or of a document that is not v2, as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactNear } = await import("../src/near.js");
    for (const row of rowsOf(buildChoices(NEAR.fixed.O, NEAR.fixed.resource, membersOf("x402/exact/near")), "build-choices.ts", { exact: 2 })) {
      expect(await exactNear.build(row.choice as never, NEAR.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("NEAR: every function that needs borsh refuses near/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactNear, nearCarrier } = await import("../src/near.js");
    const refused = { refused: true, code: code(NEAR) };
    const O = NEAR.fixed.O;
    const sda = NEAR.V2.expectSignedDelegateAction as string;
    expect(nearCarrier(sda)).toEqual(refused);
    const payment = { x402Version: 2, accepted: O, payload: { signedDelegateAction: sda } };
    expect(await exactNear.bound(payment)).toEqual(refused);
    expect(await exactNear.reference(payment)).toEqual(refused);
    const { choice, h } = nearChoice();
    expect(await exactNear.build(choice as never, h)).toEqual(refused);
  });
});
