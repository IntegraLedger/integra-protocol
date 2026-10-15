// algosdk is an optional peer. With it absent, the avm entry point and the package root still import, and each function
// that needs algosdk refuses `avm/peer-missing`, the code the package states for a rail without its peer
// (`<rail>/peer-missing`, docs/guides/rails.md "Peer dependencies", with the entry point's namespace `avm`), never a
// malformed-input code. avmCarrier refuses it for any input. read, advertise, build, bound and reference need algosdk
// only for an Algorand option: the option filter refuses each one whose addresses it would check `avm/peer-missing`,
// and a document, offer, choice or payment with no such option gets the answer it gets with algosdk. The documents, options and
// payments are the vector file's own, which the pairing reads, builds and binds with algosdk (avm.test.ts).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { buildChoices } from "./build-choices.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const EVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8"));
const O: PaymentRequirements = V.fixed.O;
const PRESENTED = V.buyer.rows[1].input.presented;
const REFUSED = { refused: true, code: "avm/peer-missing" };
const NONE = { refused: true, code: "x402/no-payable-option" };
const NOT_THIS = { refused: true, code: "x402/option-not-this-pairing" };
/** The vector's chain parameters as `AvmParams` takes them: the rounds and fees as bigints. */
const PARAMS = {
  firstValid: BigInt(V.fixed.params.firstValid),
  genesisHash: V.fixed.params.genesisHash,
  genesisId: V.fixed.params.genesisId,
  minFee: BigInt(V.fixed.params.minFee),
  feePerByte: BigInt(V.fixed.params.feePerByte),
};

/** Buyer row B2's document, which the pairing reads with algosdk: H, the link and the file's option O. */
function b2(): PaymentRequired {
  const [row] = rowsOf(V.buyer.rows as { name: string; input: { doc: PaymentRequired } }[], "x402-exact-algorand.json buyer.rows", {
    exact: 1,
    keep: ["row B2, whose document holds the file's option O", (r) => r.name === "B2"],
    leave: ["every other row", (r) => r.name !== "B2"],
  });
  return row!.input.doc;
}

vi.mock("algosdk", () => {
  throw new Error("Cannot find package 'algosdk'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without algosdk", () => {
  let root: typeof import("../src/index.js");
  let avm: typeof import("../src/avm.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
    avm = await import("../src/avm.js");
  }, IMPORT_MS);

  it("the root imports with the pairing in BINDINGS, and names no Algorand option", { timeout: IMPORT_MS }, () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/algorand");
    expect(root.pairingOf(O)).toBeUndefined();
  });

  it("avmCarrier refuses avm/peer-missing for a well-formed payment", () => {
    expect(avm.avmCarrier(PRESENTED.payload)).toEqual(REFUSED);
  });

  // The filter refuses the chosen option after the choice's own checks, so no choice gets the answer it gets with
  // algosdk (avm.test.ts, build-choices.test.ts) except one of an Algorand option.
  it("build refuses avm/peer-missing for a well-formed choice, and answers any other choice as it does with algosdk", async () => {
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const choice = { required, accepted: O, payer: V.fixed.payer, params: PARAMS };
    expect(await avm.exactAvm.build(choice, V.fixed.H)).toEqual(REFUSED);
    expect(await avm.exactAvm.build(null as never, V.fixed.H)).toEqual({ refused: true, code: "avm/option-malformed" });
    for (const row of rowsOf(buildChoices(O, V.fixed.resource), "build-choices.ts", { exact: 2 })) {
      expect(await avm.exactAvm.build(row.choice as never, V.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  // A fault of the document itself is read before any option, so it gets the code it gets with algosdk.
  it("read refuses avm/peer-missing for a document holding only an Algorand option, after the document's own checks", () => {
    const doc = b2();
    expect(avm.exactAvm.read(doc)).toEqual(REFUSED);
    const { extensions: _extensions, ...without } = doc;
    expect(avm.exactAvm.read(without as never)).toEqual({ refused: true, code: "x402/no-legal-context" });
    expect(avm.exactAvm.read({ ...doc, x402Version: 1 } as never)).toEqual({ refused: true, code: "x402/not-v2" });
  });

  // O beside another pairing's option: only O is refused for want of algosdk, and the other pairing's read serves its
  // own option from the same document. bound and reference read a payment's version before its option.
  it("the Algorand option of a document is refused avm/peer-missing, and the other pairing reads its own", async () => {
    const { exactEip3009 } = await import("../src/x402.js");
    const both = { ...b2(), accepts: [O, EVM.fixed.O] };
    expect(avm.exactAvm.read(both)).toEqual(REFUSED);
    const evm = exactEip3009.read(both);
    expect("refused" in evm ? evm : evm.offer.options).toEqual([EVM.fixed.O]);
    const issued = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O, EVM.fixed.O] };
    expect(avm.exactAvm.advertise(issued, V.fixed.H, V.fixed.link, O)).toEqual(REFUSED);
    expect(avm.exactAvm.advertise(issued, V.fixed.H, V.fixed.link, EVM.fixed.O)).toEqual(NOT_THIS);
    expect(await avm.exactAvm.bound(PRESENTED)).toEqual(REFUSED);
    expect(await avm.exactAvm.reference(PRESENTED)).toEqual(REFUSED);
    expect(await avm.exactAvm.bound({ ...PRESENTED, accepted: EVM.fixed.O })).toEqual(NOT_THIS);
    expect(await avm.exactAvm.reference({ ...PRESENTED, accepted: EVM.fixed.O })).toEqual(NOT_THIS);
    const notV2 = { refused: true, code: "x402/not-v2" };
    expect(await avm.exactAvm.bound({ ...PRESENTED, x402Version: 1 })).toEqual(notV2);
    expect(await avm.exactAvm.reference({ ...PRESENTED, x402Version: 1 })).toEqual(notV2);
  });

  it("read of a document holding no Algorand option gives the answer it gives with algosdk", () => {
    expect(avm.exactAvm.read({ ...b2(), accepts: [] })).toEqual(NONE);
    expect(avm.exactAvm.read({ ...b2(), accepts: [EVM.fixed.O] })).toEqual(NONE);
  });

  // The filter checks the payTo and the fee payer, which only algosdk reads, after every other check, so an Algorand
  // option with another fault gets the code it gets with algosdk (avm.test.ts runs the same rows with it).
  it("an Algorand option's fault that needs no algosdk gets the code it gets with algosdk", async () => {
    const doc = b2();
    const required = (o: PaymentRequirements) => ({ x402Version: 2 as const, resource: V.fixed.resource, accepts: [o] });
    type Row = { option: PaymentRequirements; expect: string };
    for (const row of rowsOf(V.options as Row[], "x402-exact-algorand.json options", {
      exact: 2,
      keep: ["the options with O's payTo, whose fault needs no algosdk", (r) => r.option.payTo === O.payTo],
      leave: ["the option whose payTo has a bad checksum, which only algosdk reads", (r) => r.option.payTo !== O.payTo],
    })) {
      expect(avm.exactAvm.advertise(required(row.option), V.fixed.H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
      expect(await avm.exactAvm.bound({ ...PRESENTED, accepted: row.option })).toEqual({ refused: true, code: row.expect });
      expect(avm.exactAvm.read({ ...doc, accepts: [row.option] })).toEqual(NONE);
    }
    for (const row of rowsOf(V.options as Row[], "x402-exact-algorand.json options", {
      exact: 1,
      keep: ["the option whose payTo has a bad checksum, which only algosdk reads", (r) => r.option.payTo !== O.payTo],
      leave: ["the options with O's payTo", (r) => r.option.payTo === O.payTo],
    })) {
      expect(avm.exactAvm.advertise(required(row.option), V.fixed.H, V.fixed.link, row.option)).toEqual(REFUSED);
    }
    for (const row of rowsOf(V.V3.presentedOptions as { accepted: PaymentRequirements; expect: string }[], "x402-exact-algorand.json V3.presentedOptions", { exact: 5 })) {
      expect(await avm.exactAvm.bound({ ...PRESENTED, accepted: row.accepted })).toEqual({ refused: true, code: row.expect });
      expect(avm.exactAvm.read({ ...doc, accepts: [row.accepted] })).toEqual(NONE);
    }
  });
});
