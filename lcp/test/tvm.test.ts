// Runs the TON pairing's vector file through the tvm entry point. Every expected value is the file's, computed with
// pytoniq-core 0.2.0 and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { beginCell, Cell } from "@ton/core";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { exactTvm, lcpComment, pairingOf, tvmCarrier, type TonTx, type TvmPayment, type TvmReader, type TvmRef } from "../src/tvm.js";
import type { AtrHash } from "../src/core.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tvm.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const placed: PaymentRequirements = V.fixed.placed;
const seed = Uint8Array.from(Buffer.from(V.fixed.seedHex, "hex"));
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [placed] };
const hashHex = (c: { hash(): Uint8Array }) => Buffer.from(c.hash()).toString("hex");
const affix = (h: string, a: { prefix: string; suffix: string }) => h.startsWith(a.prefix) && h.endsWith(a.suffix);
const choice = () => ({
  required,
  accepted: placed,
  wallet: V.fixed.wallet as string,
  walletId: V.fixed.walletId as number,
  seqno: V.fixed.seqno as number,
  jettonWallet: V.fixed.jettonWallet as string,
  attachNanotons: BigInt(V.fixed.attachNanotons),
  now: V.fixed.now as number,
});
const payment = (settlementBoc: string, accepted: PaymentRequirements = placed): TvmPayment => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted,
  payload: { settlementBoc, asset: accepted.asset },
});
const signed = async () => {
  const u = await exactTvm.build(choice(), H);
  if ("refused" in u) throw new Error(u.code);
  return u.complete(ed25519.sign(u.request.hash, seed)) as TvmPayment;
};

type Fixture = Omit<TonTx, "inBody"> & { inBody?: null };
function readerFor(a: {
  byInBody?: Fixture[] | "reader-error";
  byInMessage?: Fixture[];
  headUtime?: number;
  inBodyHex?: string;
  byHash?: "reader-error";
}): TvmReader {
  const tx = (f: Fixture): TonTx => ({ ...f, inBody: null });
  return {
    network: V.V4.ref.network,
    byInBody: async () => {
      if (a.byInBody === "reader-error") throw new ReaderError("transport");
      return (a.byInBody ?? []).map(tx);
    },
    byInMessage: async () => (a.byInMessage ?? []).map(tx),
    byHash: async (h) => {
      if (a.byHash === "reader-error") throw new ReaderError("transport");
      if (a.inBodyHex === undefined) return null;
      return { hash: h, account: V.fixed.jettonWallet, aborted: false, finality: 2, outMsgs: [], inBody: Uint8Array.from(Buffer.from(a.inBodyHex, "hex")) };
    },
    headUtime: async () => {
      if (a.headUtime === undefined) throw new ReaderError("transport");
      return a.headUtime;
    },
  };
}
const REF: TvmRef = V.V4.ref;

describe("x402-exact-tvm.json", () => {
  it("V1: the carrier comment and its BoC", () => {
    const c = lcpComment(H);
    if ("refused" in c) throw new Error(c.code);
    // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(lcpComment(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
    expect(c.bits.length).toBe(V.V1.expectCommentBits);
    expect(hashHex(c)).toBe(V.V1.expectCommentHash);
    const doc = exactTvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]!.extra!["forwardPayload"]).toBe(V.V1.expectBoc);
    expect(doc.accepts[0]).toEqual(placed);
    expect(exactTvm.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    const r = exactTvm.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: V.fixed.link, options: [placed] });
  });

  it("V2: build gives the vector's cells, request hash and settlement root", async () => {
    const u = await exactTvm.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("ton-w5");
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V2.expectRequestHash);
    const sig = ed25519.sign(u.request.hash, seed);
    expect(affix(Buffer.from(sig).toString("hex"), V.V2.expectSignature)).toBe(true);
    expect(ed25519.verify(sig, u.request.hash, Buffer.from(V.fixed.publicKey, "hex"))).toBe(true);
    const p = u.complete(sig) as TvmPayment;
    const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
    expect(hashHex(root)).toBe(V.V2.expectSettlementRootHash);
    const actions = root.refs[0]!.refs[0]!;
    const out = actions.refs[1]!;
    const body = out.refs[0]!;
    expect(affix(hashHex(actions), V.V2.expectActionsHash)).toBe(true);
    expect(affix(hashHex(out), V.V2.expectOutMessageHash)).toBe(true);
    expect(body.bits.length).toBe(V.V2.expectTransferBodyBits);
    expect(hashHex(body)).toBe(V.V2.expectTransferBodyHash);
    expect(p.payload.asset).toBe(placed.asset);
    expect(p.accepted).toEqual(placed);
  });

  it("V2b: an undeployed wallet's base64 state init rides as the message's init; bound still gives H", async () => {
    const W = V.V2b;
    const u = await exactTvm.build({ ...choice(), wallet: W.wallet, seqno: W.seqno, stateInit: W.stateInit }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(W.expectRequestHash);
    const sig = ed25519.sign(u.request.hash, seed);
    expect(Buffer.from(sig).toString("hex")).toBe(W.expectSignature);
    const p = u.complete(sig) as TvmPayment;
    const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
    expect(hashHex(root)).toBe(W.expectSettlementRootHash);
    expect(hashHex(root.refs[0]!)).toBe(W.expectStateInitHash);
    expect(await exactTvm.bound(p)).toBe(H);
    const ref = await exactTvm.reference(p);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.transferBodyHash).toBe(`0x${W.expectTransferBodyHash}`);
    const asCell = await exactTvm.build({ ...choice(), wallet: W.wallet, seqno: W.seqno, stateInit: Cell.fromBase64(W.stateInit) }, H);
    if ("refused" in asCell) throw new Error(asCell.code);
    expect(Buffer.from(asCell.request.hash).toString("hex")).toBe(W.expectRequestHash);
    for (const row of W.refusals) {
      expect([row.case, await exactTvm.build({ ...choice(), stateInit: row.stateInit }, H)]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  it("V3: bound and reference, and each refusal", async () => {
    const p = await signed();
    expect(await exactTvm.bound(p)).toBe(V.V3.expectBound);
    const ref = await exactTvm.reference(p);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const c = tvmCarrier(p.payload.settlementBoc);
    if ("refused" in c) throw new Error(c.code);
    expect(c.h).toBe(H);
    for (const row of V.V3.refusals) {
      expect([row.case, await exactTvm.bound(payment(row.settlementBoc, row.accepted))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  // The entry point's interface: "No function throws", and a BoC that cannot be read as the scheme's cells is
  // `tvm/boc-malformed`. An exotic cell (TVM's library cell: type 2, then a 256-bit hash) is not an ordinary cell.
  it("V3: an exotic cell in the settlement BoC is tvm/boc-malformed, never a throw", async () => {
    const p = await signed();
    const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
    const library = beginCell().storeUint(2, 8).storeBuffer(Buffer.alloc(32, 1)).endCell({ exotic: true });
    const swap = (c: Cell, path: readonly number[]): Cell => {
      if (path.length === 0) return library;
      const b = beginCell().storeBits(c.bits);
      c.refs.forEach((r, i) => b.storeRef(i === path[0] ? swap(r, path.slice(1)) : r));
      return b.endCell();
    };
    const transfer = root.refs[0]!.refs[0]!.refs[1]!.refs[0]!;
    const comment = transfer.refs.findIndex((r) => r.bits.length === 32 + 8 * 77);
    for (const path of [[0, 0, 1, 0, comment], [0, 0]]) {
      const boc = swap(root, path).toBoc({ idx: false, crc32: true }).toString("base64");
      expect(await exactTvm.bound(payment(boc, p.accepted))).toEqual({ refused: true, code: "tvm/boc-malformed" });
    }
  });

  it("V4: status and recover on reader fixtures", async () => {
    for (const row of V.V4.status) {
      expect([row.case, await exactTvm.status(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of V.V4.recover) {
      const got = await exactTvm.recover({ network: REF.network, transaction: row.transaction }, readerFor(row));
      expect([row.case, got]).toEqual([row.case, row.expect]);
    }
  });

  it("plant: an equal body executed on another account is never the payment", async () => {
    expect(await exactTvm.status(REF, readerFor(V.plant))).toEqual(V.plant.expect);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of V.agreedRefusals.rows) {
      const want = { refused: true, code: row.expect };
      if (row.expect.endsWith("/peer-missing")) continue;
      if (row.option !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactTvm.advertise(doc, H, V.fixed.link, row.option)]).toEqual([row.case, want]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.advertiseOption !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.advertiseOption] };
        expect([row.case, exactTvm.advertise(doc, H, V.fixed.link, row.advertiseOption)]).toEqual([row.case, want]);
      } else if (row.attachNanotons !== undefined) {
        expect(await exactTvm.build({ ...choice(), attachNanotons: BigInt(row.attachNanotons) }, H)).toEqual(want);
      } else if (row.wallet !== undefined) {
        expect(await exactTvm.build({ ...choice(), wallet: row.wallet }, H)).toEqual(want);
        expect(await exactTvm.build({ ...choice(), jettonWallet: row.wallet }, H)).toEqual(want);
        expect(await exactTvm.build({ ...choice(), walletId: 2 ** 32 }, H)).toEqual(want);
        expect(await exactTvm.build({ ...choice(), seqno: -1 }, H)).toEqual(want);
        expect(await exactTvm.build({ ...choice(), now: 1.5 }, H)).toEqual(want);
      } else if (row.signatureBytes !== undefined) {
        const u = await exactTvm.build(choice(), H);
        if ("refused" in u) throw new Error(u.code);
        expect(u.complete(new Uint8Array(row.signatureBytes))).toEqual(want);
      } else if (row.settlementBoc !== undefined) {
        expect([row.case, await exactTvm.bound(payment(row.settlementBoc))]).toEqual([row.case, want]);
      } else if (row.case.startsWith("recover when the reader fails")) {
        expect(await exactTvm.recover({ network: REF.network, transaction: "x" }, readerFor({ byHash: "reader-error" }))).toEqual(want);
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });

  it("build refuses an option whose forward payload is not the hash's comment", async () => {
    expect(await exactTvm.build({ ...choice(), required: { ...required, accepts: [O] }, accepted: O }, H)).toEqual({
      refused: true,
      code: "tvm/carrier-mismatch",
    });
    expect(exactTvm.pattern.publicProof).toBe(true);
    expect(exactTvm.carrier).toBe("extra.forwardPayload");
  });
});
