// @stellar/stellar-sdk is an optional peer, with which the Stellar pairings read and write a transaction's XDR. With it
// absent, the stellar entry points and the package root still import, and each function whose type carries a refusal
// and needs the XDR refuses `stellar/peer-missing` (the vectors' refusal), never throwing, after every check that needs
// none, each of which gives the code it gives with the peer. Strkeys (`G…`, `C…` and `M…`) are read and written
// without the SDK, so x402/exact/stellar's option filter, pairingOf, x402 read and advertise, MPP advertise, both
// pairings' unplaced, issuedDigest and muxedFor give every input the answer they give with it. build, bound and
// reference refuse it only once they read the transaction, and stellarStatus and stellarLocate read nothing.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentRequirements } from "../src/x402.js";
import { buildChoices } from "./build-choices.js";
import {
  BAD_H,
  hFirstChoices,
  memberFirstChoices,
  membersOf,
  muxedForArgs,
  stellarChargeChoice,
  stellarChargeChoices,
  stellarDigestRows,
  stellarEnvelopeInputs,
  stellarEventInputs,
  stellarOccupied,
  stellarStrkeyAnswers,
  stellarStrkeyRows,
  stellarUnplacedRows,
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

  it("the root imports and names the Stellar option, and x402 advertise places it, as with the peer", { timeout: IMPORT_MS }, async () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/stellar");
    expect(root.pairingOf(V.fixed.option)).toBe("x402/exact/stellar");
    expect(root.pairingOf(V.V3.accepted)).toBe("x402/exact/stellar");
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option] };
    const placed = exactStellar.advertise(required, V.fixed.H, V.fixed.link, V.fixed.option);
    if ("refused" in placed) throw new Error(placed.code);
    expect(placed.accepts).toEqual([V.V3.accepted]);
    const r = exactStellar.read(placed);
    expect("refused" in r ? r : [r.h, r.link, r.offer.options]).toEqual([V.fixed.H, V.fixed.link, [V.V3.accepted]]);
  });

  // The choice is V2's simulated transaction for V3's option and the payment is V3's, which the pairing builds, binds and
  // references with the peer (x402-exact-stellar.json). bound and reference read a payment's version before its option.
  it("x402/exact/stellar's build, bound and reference refuse peer-missing once they read the transaction", { timeout: IMPORT_MS }, async () => {
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
    for (const row of rowsOf(buildChoices(V.fixed.option, V.fixed.resource, membersOf("x402/exact/stellar")), "build-choices.ts", { exact: 2 })) {
      expect(await exactStellar.build(row.choice as never, V.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  // The document is V3's challenge, which the pairing reads with the peer: its hash, link and V3's option.
  it("x402/exact/stellar's read of a challenge holding a Stellar option: its hash, link and option, as with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const r = exactStellar.read(challenge([V.V3.accepted]));
    expect("refused" in r ? r : [r.h, r.link, r.offer.options]).toEqual([V.fixed.H, V.fixed.link, [V.V3.accepted]]);
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

  // V3's option beside another pairing's: each pairing's read serves its own option from the same challenge, and
  // advertise places the Stellar offer alone.
  it("x402/exact/stellar reads and places the Stellar option of a challenge, and the other pairing reads its own", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const { exactEip3009 } = await import("../src/x402.js");
    const both = challenge([V.V3.accepted, EVM.fixed.O]);
    const r = exactStellar.read(both);
    expect("refused" in r ? r : r.offer.options).toEqual([V.V3.accepted]);
    const evm = exactEip3009.read(both);
    expect("refused" in evm ? evm : evm.offer.options).toEqual([EVM.fixed.O]);
    const issued = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option, EVM.fixed.O] };
    const placed = exactStellar.advertise(issued, V.fixed.H, V.fixed.link, V.fixed.option);
    expect("refused" in placed ? placed : placed.accepts).toEqual([V.V3.accepted, EVM.fixed.O]);
    expect(exactStellar.advertise(issued, V.fixed.H, V.fixed.link, EVM.fixed.O)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
    const presented = { x402Version: 2, accepted: EVM.fixed.O, payload: { transaction: V.V3.envelope }, extensions: V.V3.extensions };
    expect(await exactStellar.bound(presented)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
    expect(await exactStellar.reference(presented)).toEqual({ refused: true, code: "x402/option-not-this-pairing" });
  });

  // advertise checks the document's version, its accepts and the offer's place in it, then holds the offer to the filter:
  // the order every x402 pairing's advertise answers in (advertiseFor). None needs the peer.
  it("x402/exact/stellar's advertise answers the document and the offer's place as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const O = V.fixed.option;
    const doc = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const advertise = (d: unknown, offer: unknown) => exactStellar.advertise(d as never, V.fixed.H, V.fixed.link, offer as never);
    expect([
      advertise({ ...doc, x402Version: 1 }, O),
      advertise({ ...doc, accepts: "none" }, O),
      advertise({ ...doc, accepts: [EVM.fixed.O] }, O),
      advertise({ ...doc, accepts: [O, EVM.fixed.O] }, EVM.fixed.O),
      advertise({ ...doc, accepts: [V.V3.accepted] }, V.V3.accepted),
    ]).toEqual(["x402/not-v2", "x402/option-malformed", "x402/option-not-in-document", "x402/option-not-this-pairing", "stellar/carrier-occupied"].map((code) => ({ refused: true, code })));
  });

  // unplaced reads a muxed payTo or recipient without the peer (peer-free-inputs.test.ts gives the same rows with it).
  it("x402/exact/stellar's and mpp/charge/stellar's unplaced answer as they do with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const { chargeStellar } = await import("../src/mpp.js");
    const unplaced = { "x402/exact/stellar": exactStellar.unplaced, "mpp/charge/stellar": chargeStellar.unplaced } as const;
    for (const row of rowsOf(stellarUnplacedRows(), "peer-free-inputs.ts", { exact: 7 })) {
      expect([row.case, unplaced[row.pairing](row.option as never)]).toEqual([row.case, row.expect]);
    }
    expect(exactStellar.unplaced(V.fixed.network)).toBe(V.fixed.network);
    expect(chargeStellar.unplaced(M.fixed.H)).toBe(M.fixed.H);
  });

  it("issuedDigest of the vectors' challenges is the vectors' digest, muxed recipients included", { timeout: IMPORT_MS }, async () => {
    const { issuedDigest } = await import("../src/mpp.js");
    for (const row of rowsOf(stellarDigestRows(), "peer-free-inputs.ts", { exact: 3 })) {
      expect([row.case, await issuedDigest(row.challenge as never)]).toEqual([row.case, row.expect]);
    }
  });

  it("mpp/charge/stellar's advertise refuses a muxed recipient as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const { challenge, h, link, expect: code } = stellarOccupied();
    expect(chargeStellar.advertise([challenge as never], h, link, challenge as never)).toEqual({ refused: true, code });
  });

  // A document carrying a refused member gets the code it gets with the peer: x402/option-malformed for the x402
  // document or an option in its accepts, and mpp/challenge-malformed for a challenge list holding such a challenge
  // (docs/reference/refusals.md).
  it("x402/exact/stellar's and mpp/charge/stellar's advertise refuse a refused member as they do with the peer", { timeout: IMPORT_MS }, async () => {
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

  // MPP advertise reads and writes the recipient's strkey without the peer: the vectors' placement (mpp-charges.test.ts),
  // and an issued recipient that is not an account. bound and reference read the transaction.
  it("mpp/charge/stellar's advertise places as it does with the peer, and its bound and reference refuse peer-missing", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const refused = { refused: true, code: CODE };
    expect(chargeStellar.advertise([M.challenge], M.fixed.H, M.fixed.link, M.challenge)).toEqual([M.place.expect]);
    const credential = { challenge: M.place.expect, payload: { type: "transaction", transaction: M.V3.envelope } };
    expect(await chargeStellar.bound(credential)).toEqual(refused);
    expect(await chargeStellar.reference(credential)).toEqual(refused);
  });

  // The choice is one the pairing builds with the peer (peer-free-inputs.ts). Without it the transaction cannot be
  // read.
  it("mpp/charge/stellar's build refuses peer-missing once it reads the transaction", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const { choice, h } = stellarChargeChoice();
    expect(await chargeStellar.build(choice, h)).toEqual({ refused: true, code: CODE });
  });

  // build checks the choice, its challenge, H, the current ledger, the clock, the expiration ledger, the simulated
  // transaction's form and the recipient's muxed id before it reads the transaction: each fault gets the code it gets
  // with the peer (peer-free-inputs.test.ts).
  it("mpp/charge/stellar's build answers a choice it refuses before the transaction as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    for (const row of rowsOf(stellarChargeChoices(), "peer-free-inputs.ts", { exact: 11 })) {
      expect([row.case, await chargeStellar.build(row.choice as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // The decoders and transferEventTopics read or write XDR, after the strkey; muxedFor writes a strkey alone.
  it("the stellar entry point's decoders refuse peer-missing, and muxedFor answers as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    const refused = { refused: true, code: CODE };
    expect(st.decodeStellarTx(V.V3.envelope, V.fixed.network)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.seller)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.asset)).toEqual(refused);
    expect(st.transferEventOf(V.events.rows[0].topic, V.events.rows[0].value)).toEqual(refused);
    expect(st.muxedFor(V.fixed.seller, V.fixed.H)).toBe(V.V1.M);
  });

  // A base that is not a string and an H that is not a 32-byte hash get the code they get with the SDK
  // (failures-are-values.test.ts).
  it("muxedFor answers a base or H it refuses as it does with the peer", { timeout: IMPORT_MS }, async () => {
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
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", {
      exact: 16,
      keep: ["each strkey that is neither an account nor a contract", (r) => !r.isAccount && !r.isContract],
      leave: ["each account or contract", (r) => r.isAccount || r.isContract],
    })) {
      expect([row.case, st.transferEventTopics(row.s as never)]).toEqual([row.case, { refused: true, code: "stellar/option-malformed" }]);
    }
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

  it("x402/exact/stellar's build answers a malformed current ledger as it does with the peer, whatever the option", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    for (const row of rowsOf(memberFirstChoices(exactStellar.id, V.fixed.option), "peer-free-inputs.ts", { exact: 6 })) {
      expect([row.case, await exactStellar.build(row.choice as never, V.fixed.H)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // peer-free-inputs.test.ts gives the same rows the same answers with the SDK, held to its StrKey.
  it("each strkey through isAccount, isContract, muxedFor, and x402's filter, read, advertise and build, as with the peer", { timeout: IMPORT_MS }, async () => {
    const { isAccount, isContract } = await import("../src/internal/stellar.js");
    const { muxedFor } = await import("../src/stellar.js");
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const f = { isAccount, isContract, muxedFor, read: exactStellar.read, advertise: exactStellar.advertise, build: exactStellar.build };
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", { exact: 20 })) {
      const { s: _s, member: _member, ...expected } = row;
      expect(await stellarStrkeyAnswers(row, f as never)).toEqual(expected);
    }
  });

  // The ref is V5's, in the form reference writes; without the SDK no transaction can be decoded, so nothing is read.
  it("stellarStatus is pending unreadable and stellarLocate incomplete for a ref in its form, with nothing read", { timeout: IMPORT_MS }, async () => {
    const { stellarLocate, stellarStatus } = await import("../src/stellar.js");
    let calls = 0;
    const reader = {
      network: V.V5.ref.network,
      transaction: async () => (calls++, { status: "NOT_FOUND" as const }),
      latestLedger: async () => (calls++, 0),
      transfers: async () => (calls++, { events: [], complete: true, oldestLedger: 0, latestLedger: 0 }),
    };
    expect(await stellarStatus(V.V5.ref, reader as never)).toEqual({ state: "pending", why: "unreadable" });
    expect(await stellarLocate(V.V5.ref, reader as never)).toEqual({ complete: false });
    expect(calls).toBe(0);
  });
});
