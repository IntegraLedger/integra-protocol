// algosdk is an optional peer, with which x402/exact/algorand's build writes the transactions. With it absent, the avm
// entry point and the package root still import, and build refuses `avm/peer-missing`, the code the package states for
// a rail without its peer (`<rail>/peer-missing`, docs/guides/rails.md "Peer dependencies", with the entry point's
// namespace `avm`), never a malformed-input code, only for a choice that passes every check that needs no algosdk: H,
// the payer (its checksum included) and the suggested parameters, the document and the option, and the genesis hash
// against the option's network. Addresses and payment entries are read without algosdk, so the option filter,
// pairingOf, read, advertise, bound, reference and avmCarrier give every input the answer they give with it. The
// documents, options and payments are the vector file's own, which the pairing reads, builds and binds with algosdk
// (avm.test.ts).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { buildChoices } from "./build-choices.js";
import { avmCarrierRows, avmComparedChoices, BAD_H, hFirstChoices, memberFirstChoices, membersOf } from "./peer-free-inputs.js";
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

  it("the root imports with the pairing in BINDINGS, and names the Algorand option as it does with algosdk", { timeout: IMPORT_MS }, () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/algorand");
    expect(root.pairingOf(O)).toBe("x402/exact/algorand");
    for (const row of rowsOf(V.options as { option: PaymentRequirements }[], "x402-exact-algorand.json options", { exact: 3 })) {
      expect(root.pairingOf(row.option)).toBeUndefined();
    }
  });

  // peer-free-inputs.test.ts gives the same rows the same answers with algosdk.
  it("avmCarrier reads V2's payment and refuses each V3.refusals row as it does with algosdk", () => {
    for (const row of rowsOf(avmCarrierRows(), "peer-free-inputs.ts", { min: 2 })) {
      expect([row.case, avm.avmCarrier(row.presented as never)]).toEqual([row.case, row.expect]);
    }
  });

  it("build answers a malformed H as it does with algosdk, whatever the choice", async () => {
    for (const row of rowsOf(hFirstChoices(avm.exactAvm.id, O), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await avm.exactAvm.build(row.choice as never, BAD_H as never)]).toEqual([
        row.case,
        { refused: true, code: "x402/payload-malformed" },
      ]);
    }
  });

  // build writes the transactions with algosdk after every other check, so only a choice it would build is refused for
  // want of it (avm.test.ts builds this one), and every other choice gets the answer it gets with algosdk
  // (build-choices.test.ts, peer-free-inputs.test.ts).
  it("build refuses avm/peer-missing for a choice it builds with algosdk, and answers any other choice as it does with algosdk", async () => {
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const choice = { required, accepted: O, payer: V.fixed.payer, params: PARAMS };
    expect(await avm.exactAvm.build(choice, V.fixed.H)).toEqual(REFUSED);
    expect(await avm.exactAvm.build(null as never, V.fixed.H)).toEqual({ refused: true, code: "avm/option-malformed" });
    for (const row of rowsOf(buildChoices(O, V.fixed.resource, membersOf("x402/exact/algorand")), "build-choices.ts", { exact: 2 })) {
      expect(await avm.exactAvm.build(row.choice as never, V.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
    for (const row of rowsOf(avmComparedChoices(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await avm.exactAvm.build(row.choice as never, V.fixed.H)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // The payer, its checksum included, and the suggested parameters' form are checked after H and before the document,
  // which needs no algosdk, so a malformed one gets the code it gets with algosdk whatever the option, the pairing's own
  // included.
  it("build answers a malformed payer or suggested parameter as it does with algosdk, whatever the option", async () => {
    for (const row of rowsOf(memberFirstChoices(avm.exactAvm.id, O), "peer-free-inputs.ts", { exact: 21 })) {
      expect([row.case, await avm.exactAvm.build(row.choice as never, V.fixed.H)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // A fault of the document itself is read before any option, as with algosdk.
  it("read serves the Algorand option of a document as it does with algosdk, after the document's own checks", () => {
    const doc = b2();
    const r = avm.exactAvm.read(doc);
    expect("refused" in r ? r : [r.h, r.link, r.offer.options]).toEqual([V.fixed.H, V.fixed.link, [O]]);
    const { extensions: _extensions, ...without } = doc;
    expect(avm.exactAvm.read(without as never)).toEqual({ refused: true, code: "x402/no-legal-context" });
    expect(avm.exactAvm.read({ ...doc, x402Version: 1 } as never)).toEqual({ refused: true, code: "x402/not-v2" });
  });

  // O beside another pairing's option: each pairing's read serves its own option from the same document. bound and
  // reference read V2's payment, which the buyer row presents, as they do with algosdk (avm.test.ts), and a payment's
  // version before its option.
  it("read, advertise, bound and reference answer the Algorand option as they do with algosdk, beside another pairing's", async () => {
    const { exactEip3009 } = await import("../src/x402.js");
    const both = { ...b2(), accepts: [O, EVM.fixed.O] };
    const r = avm.exactAvm.read(both);
    expect("refused" in r ? r : r.offer.options).toEqual([O]);
    const evm = exactEip3009.read(both);
    expect("refused" in evm ? evm : evm.offer.options).toEqual([EVM.fixed.O]);
    const issued = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O, EVM.fixed.O] };
    const placed = avm.exactAvm.advertise(issued, V.fixed.H, V.fixed.link, O);
    expect("refused" in placed ? placed : placed.accepts).toEqual([O, EVM.fixed.O]);
    expect(avm.exactAvm.advertise(issued, V.fixed.H, V.fixed.link, EVM.fixed.O)).toEqual(NOT_THIS);
    expect(await avm.exactAvm.bound(PRESENTED)).toBe(V.V3.expectBound);
    expect(await avm.exactAvm.reference(PRESENTED)).toEqual(V.V3.expectReference);
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

  // The filter reads the payTo and the fee payer as addresses' text, so each option's fault, a payTo whose checksum
  // does not match included, gets the code it gets with algosdk (avm.test.ts runs the same rows with it).
  it("an Algorand option's fault gets the code it gets with algosdk", async () => {
    const doc = b2();
    const required = (o: PaymentRequirements) => ({ x402Version: 2 as const, resource: V.fixed.resource, accepts: [o] });
    type Row = { option: PaymentRequirements; expect: string };
    for (const row of rowsOf(V.options as Row[], "x402-exact-algorand.json options", { exact: 3 })) {
      expect(avm.exactAvm.advertise(required(row.option), V.fixed.H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
      expect(await avm.exactAvm.bound({ ...PRESENTED, accepted: row.option })).toEqual({ refused: true, code: row.expect });
      expect(avm.exactAvm.read({ ...doc, accepts: [row.option] })).toEqual(NONE);
    }
    for (const row of rowsOf(V.V3.presentedOptions as { accepted: PaymentRequirements; expect: string }[], "x402-exact-algorand.json V3.presentedOptions", { exact: 5 })) {
      expect(await avm.exactAvm.bound({ ...PRESENTED, accepted: row.accepted })).toEqual({ refused: true, code: row.expect });
      expect(avm.exactAvm.read({ ...doc, accepts: [row.accepted] })).toEqual(NONE);
    }
  });
});
