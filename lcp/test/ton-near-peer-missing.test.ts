// TON's SDK and NEAR's borsh are optional peers. With them absent, the entry points and the package root still
// import, and each function that needs a peer refuses `<rail>/peer-missing` (the vectors' refusal), never
// throwing; a status that needs one reads as pending `unreadable`, and nothing is read. A check that needs no peer
// comes first and gives the code it gives with the peer: TON's option filter checks the addresses last, both
// pairings' build read the choice's document and the option's place in it first, and TON's recover reads the ref, the
// reader and the transaction before it decodes the transaction's body.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildChoices } from "./build-choices.js";
import { tvmRecoverDecodes, tvmRecoverReads } from "./peer-free-inputs.js";
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

  it("TON: every function that needs @ton/core refuses tvm/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactTvm, lcpComment, tvmCarrier } = await import("../src/tvm.js");
    const refused = { refused: true, code: code(TVM) };
    const O = TVM.fixed.O;
    const doc = { x402Version: 2 as const, resource: TVM.fixed.resource, accepts: [O] };
    expect(lcpComment(TVM.fixed.H)).toEqual(refused);
    expect(tvmCarrier("te6ccgEBAQEAAgAAAA==", "tvm:-239")).toEqual(refused);
    expect(root.pairingOf(O)).toBeUndefined();
    expect(exactTvm.advertise(doc, TVM.fixed.H, TVM.fixed.link, O)).toEqual(refused);
    const payment = { x402Version: 2, accepted: O, payload: { settlementBoc: "te6ccgEBAQEAAgAAAA==", asset: O.asset } };
    expect(await exactTvm.bound(payment)).toEqual(refused);
    expect(await exactTvm.reference(payment)).toEqual(refused);
    expect(await exactTvm.build({ required: doc, accepted: O } as never, TVM.fixed.H)).toEqual(refused);
    let calls = 0;
    const reader = new Proxy({ network: "tvm:-3" }, { get: (t, k) => (k in t ? t[k as "network"] : async () => (calls++, null)) });
    expect(await exactTvm.status({ network: "tvm:-3" } as never, reader as never)).toEqual({ state: "pending", why: "unreadable" });
    expect(calls).toBe(0);
  });

  // Each case peer-free-inputs.ts lists gets the code it gets with the peer, after the same reads
  // (peer-free-inputs.test.ts). The vector file's recover row holds a body, which recover cannot decode without the peer.
  it("TON: recover refuses tvm/peer-missing only for a transaction whose body it decodes", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    for (const row of rowsOf(tvmRecoverReads(), "peer-free-inputs.ts", { exact: 6 })) {
      const c = row.reader();
      const got = await exactTvm.recover(row.ref as never, c.reader as never);
      expect([row.case, got, c.reads()]).toEqual([row.case, { refused: true, code: row.expect }, row.reads]);
    }
    for (const row of rowsOf(tvmRecoverDecodes(), "x402-exact-tvm.json V4.recover")) {
      const c = row.reader();
      expect([row.case, await exactTvm.recover(row.ref as never, c.reader as never), c.reads()]).toEqual([row.case, { refused: true, code: code(TVM) }, 1]);
    }
  });

  // Buyer row B2's document, which TON's read reads with the peer: its option is TON's, so read refuses tvm/peer-missing
  // as advertise and bound do. With no TON option in it, read gives the answer it gives with the peer.
  it("TON: read refuses tvm/peer-missing for a document holding a TON option, and only then", { timeout: IMPORT_MS }, async () => {
    const { exactTvm } = await import("../src/tvm.js");
    const [b2] = rowsOf(TVM.buyer.rows as { name: string; input: { doc: { accepts: unknown[] } } }[], "x402-exact-tvm.json buyer.rows", {
      exact: 1,
      keep: ["row B2, whose document carries a placed TON option", (r) => r.name === "B2"],
      leave: ["every other row", (r) => r.name !== "B2"],
    });
    const doc = b2!.input.doc;
    expect(exactTvm.read(doc as never)).toEqual({ refused: true, code: code(TVM) });
    expect(exactTvm.read({ ...doc, accepts: [...doc.accepts, EVM.fixed.O] } as never)).toEqual({ refused: true, code: code(TVM) });
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
    for (const row of rowsOf(buildChoices(TVM.fixed.O, TVM.fixed.resource), "build-choices.ts", { exact: 2 })) {
      expect(await exactTvm.build(row.choice as never, TVM.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("NEAR: build answers a choice of another pairing's option, or of a document that is not v2, as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactNear } = await import("../src/near.js");
    for (const row of rowsOf(buildChoices(NEAR.fixed.O, NEAR.fixed.resource), "build-choices.ts", { exact: 2 })) {
      expect(await exactNear.build(row.choice as never, NEAR.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("NEAR: every function that needs borsh refuses near/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactNear, nearCarrier } = await import("../src/near.js");
    const refused = { refused: true, code: code(NEAR) };
    const O = NEAR.fixed.O;
    const doc = { x402Version: 2 as const, resource: NEAR.fixed.resource, accepts: [O] };
    const sda = NEAR.V2.expectSignedDelegateAction as string;
    expect(nearCarrier(sda)).toEqual(refused);
    const payment = { x402Version: 2, accepted: O, payload: { signedDelegateAction: sda } };
    expect(await exactNear.bound(payment)).toEqual(refused);
    expect(await exactNear.reference(payment)).toEqual(refused);
    expect(await exactNear.build({ required: doc, accepted: O } as never, NEAR.fixed.H)).toEqual(refused);
  });
});
