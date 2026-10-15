// @stellar/stellar-sdk is an optional peer. With it absent, the stellar entry points and the package root still import,
// the root pairingOf names no Stellar option, and each function whose type carries a refusal and needs the peer refuses
// `stellar/peer-missing` (the vectors' refusal), never throwing. x402/exact/stellar's read, advertise, build, bound and
// reference need the peer only for a Stellar option: the option filter refuses each one `stellar/peer-missing`, and a
// document, offer, choice or payment with no Stellar option gets the answer it gets with the peer, as does a malformed
// H, which build checks first. mpp/charge/stellar's build, muxedFor and the stellar entry point's decoders check what
// needs no peer first, and give it the code they give with the peer.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentRequirements } from "../src/x402.js";
import { buildChoices } from "./build-choices.js";
import {
  BAD_H,
  hFirstChoices,
  muxedForArgs,
  stellarChargeChoice,
  stellarChargeChoices,
  stellarEnvelopeInputs,
  stellarEventInputs,
} from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-stellar.json", import.meta.url), "utf8"));
const EVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8"));
const CODE = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "stellar/peer-missing").expect as string;
/** V3's challenge, which the pairing reads with the peer, with `accepts` replaced. */
const challenge = (accepts: PaymentRequirements[]) => ({ x402Version: 2 as const, resource: V.fixed.resource, accepts, extensions: V.V3.extensions });

vi.mock("@stellar/stellar-sdk/base", () => {
  throw new Error("Cannot find package '@stellar/stellar-sdk'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @stellar/stellar-sdk", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports, names no option, and x402 advertise refuses", { timeout: IMPORT_MS }, async () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/stellar");
    expect(root.pairingOf(V.fixed.option)).toBeUndefined();
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option] };
    expect(exactStellar.advertise(required, V.fixed.H, V.fixed.link, V.fixed.option)).toEqual({
      refused: true,
      code: CODE,
    });
  });

  // The choice is V2's simulated transaction for V3's option and the payment is V3's, which the pairing builds, binds and
  // references with the peer (x402-exact-stellar.json). bound and reference read a payment's version before its option.
  it("x402/exact/stellar's build, bound and reference refuse peer-missing, as its advertise does", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const refused = { refused: true, code: CODE };
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.V3.accepted] };
    const choice = { required, accepted: V.V3.accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer };
    expect(await exactStellar.build(choice, V.fixed.H)).toEqual(refused);
    const presented = { x402Version: 2, accepted: V.V3.accepted, payload: { transaction: V.V3.envelope }, extensions: V.V3.extensions };
    expect(await exactStellar.bound(presented)).toEqual(refused);
    expect(await exactStellar.reference(presented)).toEqual(refused);
    const notV2 = { refused: true, code: "x402/not-v2" };
    expect(await exactStellar.bound({ ...presented, x402Version: 1 })).toEqual(notV2);
    expect(await exactStellar.reference({ ...presented, x402Version: 1 })).toEqual(notV2);
  });

  it("x402/exact/stellar's build answers a choice of another pairing's option, or of a document that is not v2, as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    for (const row of rowsOf(buildChoices(V.fixed.option, V.fixed.resource), "build-choices.ts", { exact: 2 })) {
      expect(await exactStellar.build(row.choice as never, V.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  // The document is V3's challenge, which the pairing reads with the peer: its hash, link and V3's option.
  it("x402/exact/stellar's read refuses peer-missing for a challenge holding a Stellar option, as its advertise does", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    expect(exactStellar.read(challenge([V.V3.accepted]))).toEqual({ refused: true, code: CODE });
  });

  // The row runs in stellar.test.ts with the peer, on the same challenge.
  it("x402/exact/stellar's read of a challenge holding no Stellar option: the vectors' row, the answer it gets with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const [row] = rowsOf(V.agreedRefusals.rows as { accepts?: PaymentRequirements[]; expect: string }[], "x402-exact-stellar.json agreedRefusals.rows", {
      exact: 1,
      keep: ["the row with accepts, read with the peer and without it", (r) => r.accepts !== undefined],
      leave: ["every other row", (r) => r.accepts === undefined],
    });
    const refused = { refused: true, code: row!.expect };
    expect(exactStellar.read(challenge(row!.accepts!))).toEqual(refused);
    expect(exactStellar.read(challenge([...row!.accepts!, EVM.fixed.O]))).toEqual(refused);
  });

  // A fault of the challenge itself is read before any option, so it gets the code it gets with the peer, even when the
  // challenge holds a Stellar option.
  it("x402/exact/stellar's read answers a challenge's own fault as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const { extensions: _extensions, ...without } = challenge([V.V3.accepted]);
    expect(exactStellar.read(without as never)).toEqual({ refused: true, code: "x402/no-legal-context" });
    expect(exactStellar.read({ ...challenge([V.V3.accepted]), x402Version: 1 } as never)).toEqual({ refused: true, code: "x402/not-v2" });
  });

  // V3's option beside another pairing's: only the Stellar option is refused for want of the peer. The other pairing's
  // read serves its own option from the same challenge.
  it("x402/exact/stellar refuses peer-missing for the Stellar option of a challenge only, and the other pairing reads its own", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const { exactEip3009 } = await import("../src/x402.js");
    const refused = { refused: true, code: CODE };
    const both = challenge([V.V3.accepted, EVM.fixed.O]);
    expect(exactStellar.read(both)).toEqual(refused);
    const evm = exactEip3009.read(both);
    expect("refused" in evm ? evm : evm.offer.options).toEqual([EVM.fixed.O]);
    const issued = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option, EVM.fixed.O] };
    expect(exactStellar.advertise(issued, V.fixed.H, V.fixed.link, V.fixed.option)).toEqual(refused);
    expect(exactStellar.advertise(issued, V.fixed.H, V.fixed.link, EVM.fixed.O)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
    const presented = { x402Version: 2, accepted: EVM.fixed.O, payload: { transaction: V.V3.envelope }, extensions: V.V3.extensions };
    expect(await exactStellar.bound(presented)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
    expect(await exactStellar.reference(presented)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
  });

  // advertise checks the document's version, its accepts and the offer's place in it, then holds the offer to the filter,
  // which refuses a Stellar offer peer-missing: the order every x402 pairing's advertise answers in (advertiseFor).
  it("x402/exact/stellar's advertise refuses peer-missing at the filter, after the document and the offer's place", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const O = V.fixed.option;
    const doc = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const advertise = (d: unknown, offer: unknown) => exactStellar.advertise(d as never, V.fixed.H, V.fixed.link, offer as never);
    expect([
      advertise({ ...doc, x402Version: 1 }, O),
      advertise({ ...doc, accepts: "none" }, O),
      advertise({ ...doc, accepts: [EVM.fixed.O] }, O),
      advertise({ ...doc, accepts: [O, EVM.fixed.O] }, EVM.fixed.O),
      advertise(doc, O),
    ]).toEqual(["x402/not-v2", "x402/option-malformed", "x402/option-not-in-document", "x402/option-not-this-pairing", CODE].map((code) => ({ refused: true, code })));
  });

  // V3's option is placed: with the peer, unplaced sets its muxed payTo back to the base account, which is the fixed
  // option's payTo. Without the peer no payTo can be read, so no option comes back as issued.
  it("x402/exact/stellar's unplaced refuses peer-missing for an option, after a refused member", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const refused = { refused: true, code: CODE };
    expect(exactStellar.unplaced(V.V3.accepted)).toEqual(refused);
    expect(exactStellar.unplaced(V.fixed.option)).toEqual(refused);
    expect(exactStellar.unplaced({ ...V.V3.accepted, refused: true })).toEqual({ refused: true, code: "x402/option-malformed" });
    expect(exactStellar.unplaced(V.fixed.network)).toBe(V.fixed.network);
  });

  // A document carrying a refused member is refused before the peer is needed, so the code is the one it gets with the
  // peer: x402/option-malformed for the x402 document or an option in its accepts, and mpp/challenge-malformed for a
  // challenge list holding such a challenge (docs/reference/refusals.md).
  it("x402/exact/stellar's and mpp/charge/stellar's advertise refuse a refused member before peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const { chargeStellar } = await import("../src/mpp.js");
    const member = { refused: true, code: "claim/store-unavailable" };
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option], ...member };
    expect(exactStellar.advertise(required, V.fixed.H, V.fixed.link, V.fixed.option)).toEqual({
      refused: true,
      code: "x402/option-malformed",
    });
    const offered = { ...V.fixed.option, ...member };
    const withOption = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [offered] };
    expect(exactStellar.advertise(withOption, V.fixed.H, V.fixed.link, offered)).toEqual({
      refused: true,
      code: "x402/option-malformed",
    });
    const challenge = { ...M.challenge, ...member };
    expect(chargeStellar.advertise([challenge], M.fixed.H, M.fixed.link, challenge)).toEqual({
      refused: true,
      code: "mpp/challenge-malformed",
    });
  });

  it("mpp/charge/stellar's advertise refuses peer-missing, as its bound and reference do", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const refused = { refused: true, code: CODE };
    expect(chargeStellar.advertise([M.challenge], M.fixed.H, M.fixed.link, M.challenge)).toEqual(refused);
    const credential = { challenge: M.place.expect, payload: { type: "transaction", transaction: M.V3.envelope } };
    expect(await chargeStellar.bound(credential)).toEqual(refused);
    expect(await chargeStellar.reference(credential)).toEqual(refused);
  });

  // The choice is one the pairing builds with the peer (peer-free-inputs.ts). Without it the recipient cannot be read.
  it("mpp/charge/stellar's build refuses peer-missing, as its advertise does", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const { choice, h } = stellarChargeChoice();
    expect(await chargeStellar.build(choice, h)).toEqual({ refused: true, code: CODE });
  });

  // build checks the choice, its challenge, H, the current ledger, the clock, the expiration ledger and the simulated
  // transaction's form before it reads the recipient: each fault gets the code it gets with the peer
  // (peer-free-inputs.test.ts).
  it("mpp/charge/stellar's build answers a choice it refuses before the recipient as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    for (const row of rowsOf(stellarChargeChoices(), "peer-free-inputs.ts", { exact: 9 })) {
      expect([row.case, await chargeStellar.build(row.choice as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // The placed challenge is the vectors' placement: with the peer, unplaced sets its muxed recipient back to the base
  // account, the issued challenge's recipient. Without the peer no recipient can be read, so no challenge comes back.
  it("mpp/charge/stellar's unplaced refuses peer-missing for a challenge, after a refused member", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const refused = { refused: true, code: CODE };
    expect(chargeStellar.unplaced(M.place.expect)).toEqual(refused);
    expect(chargeStellar.unplaced(M.challenge)).toEqual(refused);
    expect(chargeStellar.unplaced({ ...M.place.expect, refused: true })).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(chargeStellar.unplaced(M.fixed.H)).toBe(M.fixed.H);
  });

  it("the stellar entry point's decoders and muxedFor refuse peer-missing", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    const refused = { refused: true, code: CODE };
    expect(st.decodeStellarTx(V.V3.envelope, V.fixed.network)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.seller)).toEqual(refused);
    expect(st.transferEventOf(V.events.rows[0].topic, V.events.rows[0].value)).toEqual(refused);
    expect(st.muxedFor(V.fixed.seller, V.fixed.H)).toEqual(refused);
  });

  // A base that is not a string and an H that is not a 32-byte hash need no SDK: each gets the code it gets with the SDK
  // (failures-are-values.test.ts).
  it("muxedFor answers a base or H it refuses before the strkey as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { muxedFor } = await import("../src/stellar.js");
    for (const row of rowsOf(muxedForArgs(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, muxedFor(row.base as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // Each input's network, size, base64, union tags or form is refused before the SDK is needed, with the code it gets
  // with the SDK (peer-free-inputs.test.ts).
  it("the stellar entry point's decoders answer an input they refuse before the SDK as they do with the peer", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    for (const row of rowsOf(stellarEnvelopeInputs(), "peer-free-inputs.ts", { exact: 11 })) {
      expect([row.case, st.decodeStellarTx(row.xdr as never, row.network as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
    expect(st.transferEventTopics(7 as never)).toEqual({ refused: true, code: "stellar/option-malformed" });
    for (const row of rowsOf(stellarEventInputs(), "peer-free-inputs.ts", { exact: 5 })) {
      expect([row.case, st.transferEventOf(row.topic as never, row.value as never)]).toEqual([row.case, { refused: true, code: "stellar/event-malformed" }]);
    }
  });

  it("x402/exact/stellar's build answers a malformed H as it does with the peer, whatever the choice", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    for (const row of rowsOf(hFirstChoices(exactStellar.id, V.fixed.option), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await exactStellar.build(row.choice as never, BAD_H as never)]).toEqual([row.case, { refused: true, code: "x402/payload-malformed" }]);
    }
  });
});
