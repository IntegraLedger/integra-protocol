// Runs the TON pairing's vector file through the tvm entry point. Every expected value is the file's, computed with
// pytoniq-core 0.2.0 and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { beginCell, Cell, loadStateInit, storeStateInit } from "@ton/core";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { pairingOf } from "../src/index.js";
import { exactTvm, lcpComment, tvmCarrier, type TonTx, type TvmReader, type TvmRef } from "../src/tvm.js";
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
const payment = (settlementBoc: string, accepted: PaymentRequirements = placed) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted,
  payload: { settlementBoc, asset: accepted.asset },
});
const signed = async () => {
  const u = await exactTvm.build(choice(), H);
  if ("refused" in u) throw new Error(u.code);
  const p = u.complete(ed25519.sign(u.request.hash, seed));
  if ("refused" in p) throw new Error(p.code);
  return p;
};

type Fixture = Omit<TonTx, "inBody"> & { inBody?: null };
function readerFor(a: {
  byInBody?: Fixture[] | "reader-error";
  byInBodyRequest?: Fixture[] | "reader-error";
  byInMessage?: Record<string, Fixture[] | "reader-error">;
  headUtime?: number;
  indexedUtime?: number;
  inBodyHex?: string;
  byHash?: "reader-error";
}): TvmReader {
  const tx = (f: Fixture): TonTx => ({ ...f, inBody: null });
  return {
    network: V.V4.ref.network,
    byInBody: async (bodyHash) => {
      const answer = bodyHash === V.V4.ref.requestBodyHash ? a.byInBodyRequest : a.byInBody;
      if (answer === "reader-error") throw new ReaderError("transport");
      return { transactions: (answer ?? []).map(tx), headUtime: (a.indexedUtime ?? a.headUtime) as number };
    },
    byInMessage: async (msgHash) => {
      const answer = a.byInMessage?.[msgHash];
      if (answer === "reader-error") throw new ReaderError("transport");
      return (answer ?? []).map(tx);
    },
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
    const p = u.complete(sig);
    if ("refused" in p) throw new Error(p.code);
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
    const p = u.complete(sig);
    if ("refused" in p) throw new Error(p.code);
    const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
    expect(hashHex(root)).toBe(W.expectSettlementRootHash);
    expect(hashHex(root.refs[0]!)).toBe(W.expectStateInitHash);
    expect(await exactTvm.bound(p)).toBe(H);
    const ref = await exactTvm.reference(p);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.transferBodyHash).toBe(`0x${W.expectTransferBodyHash}`);
    expect(ref.requestBodyHash).toBe(`0x${W.expectRequestBodyHash}`);
    expect(ref.wallet).toBe(W.wallet);
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

  // bound and reference read the transfer the payer signed and the echoed option's scheme, network, asset, payTo and
  // extra, never its amount or timeout. The payment is V2's, so whatever amount or timeout the option echoes, bound
  // gives the file's H (FIPS 180-2's "abc") and reference V3's keys; pairingOf, read and build, which need both, refuse
  // such an option.
  it("V3: bound and reference read no amount or timeout from the echoed option", async () => {
    const p = await signed();
    const doc = exactTvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const { maxTimeoutSeconds: _timeout, ...untimed } = placed;
    const echoed = [
      { ...placed, amount: "abc" },
      { ...placed, amount: "1e3" },
      { ...placed, maxTimeoutSeconds: 0 },
      untimed as unknown as PaymentRequirements,
    ];
    for (const accepted of echoed) {
      expect(await exactTvm.bound({ ...p, accepted })).toBe(V.V3.expectBound);
      expect(await exactTvm.reference({ ...p, accepted })).toEqual(V.V3.expectReference);
      expect(pairingOf(accepted)).toBeUndefined();
      expect(exactTvm.read({ ...doc, accepts: [accepted] })).toEqual({ refused: true, code: "x402/no-payable-option" });
      const built = await exactTvm.build({ ...choice(), required: { ...required, accepts: [accepted] }, accepted }, H);
      expect(built).toEqual({ refused: true, code: "tvm/option-malformed" });
    }
    const unsponsored = { ...placed, extra: { ...placed.extra, areFeesSponsored: false } };
    expect(await exactTvm.bound({ ...p, accepted: unsponsored })).toEqual({ refused: true, code: "tvm/option-malformed" });
    expect(await exactTvm.reference({ ...p, accepted: unsponsored })).toEqual({ refused: true, code: "tvm/option-malformed" });
  });

  // The entry point's interface: "No function throws". An exotic cell (TVM's library cell: type 2, then a 256-bit
  // hash) is not an ordinary cell, so each cell the read parses refuses one with the code of the check that reads it:
  // the settlement message and an exotic action list `tvm/boc-malformed`, the signed request `tvm/not-w5-signed`, the
  // action list's `prev`, which must be empty, `tvm/actions`, the outgoing message and its Jetton transfer body
  // `tvm/not-jetton-transfer`, and the comment `tvm/payload-not-lcp`.
  it("V3: an exotic cell the read parses is refused by the check that reads it, never a throw", async () => {
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
    for (const [path, code] of [
      [[], "tvm/boc-malformed"],
      [[0], "tvm/not-w5-signed"],
      [[0, 0], "tvm/boc-malformed"],
      [[0, 0, 0], "tvm/actions"],
      [[0, 0, 1], "tvm/not-jetton-transfer"],
      [[0, 0, 1, 0], "tvm/not-jetton-transfer"],
      [[0, 0, 1, 0, comment], "tvm/payload-not-lcp"],
    ] as const) {
      const boc = swap(root, path).toBoc({ idx: false, crc32: true }).toString("base64");
      expect([path, await exactTvm.bound(payment(boc, p.accepted))]).toEqual([path, { refused: true, code }]);
    }
  });

  // A wallet deployed from a code library carries a library cell as its state init's code. The state init rides
  // outside the signed request, and no read parses its code, so the payment is V2's: its request hash is V2's and
  // bound and reference give V3's values (pytoniq-core 0.2.0 and PyNaCl 1.6.2, as the file records).
  it("V2b: a state init whose code is a library cell, as a cell or a base64 BoC, binds as V2's payment", async () => {
    const library = beginCell().storeUint(2, 8).storeBuffer(Buffer.alloc(32, 1)).endCell({ exotic: true });
    const { data } = loadStateInit(Cell.fromBase64(V.V2b.stateInit).beginParse());
    const init = beginCell().store(storeStateInit({ code: library, data })).endCell();
    for (const stateInit of [init, init.toBoc({ idx: false, crc32: true }).toString("base64")]) {
      const u = await exactTvm.build({ ...choice(), stateInit }, H);
      if ("refused" in u) throw new Error(u.code);
      expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V2.expectRequestHash);
      const p = u.complete(ed25519.sign(u.request.hash, seed));
      if ("refused" in p) throw new Error(p.code);
      const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
      expect(root.refs.some((r) => r.refs.some((c) => c.isExotic))).toBe(true);
      expect(await exactTvm.bound(p)).toBe(V.V3.expectBound);
      expect(await exactTvm.reference(p)).toEqual(V.V3.expectReference);
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

  // A request body hash that is not 0x and 64 hex digits cannot find the signed request, so the read is pending, never
  // expired (docs/guides/rails.md, "Reading settlement"); the hash is the same 32 bytes in either case. This reader
  // answers no transaction for a body hash other than the one reference wrote.
  it("V4: a ref whose requestBodyHash is malformed is pending unreadable, with nothing read", async () => {
    const landed = V.V4.status[0];
    const late = { ...landed, headUtime: REF.validUntil + 600 };
    for (const requestBodyHash of [undefined, REF.requestBodyHash.slice(2), "0x34", `0X${REF.requestBodyHash.slice(2)}`]) {
      const { reader, calls } = counting(readerFor(late));
      expect(await exactTvm.status({ ...REF, requestBodyHash } as TvmRef, reader)).toEqual({ state: "pending", why: "unreadable" });
      expect(calls).toEqual([]);
    }
    const upper = { ...REF, requestBodyHash: `0x${REF.requestBodyHash.slice(2).toUpperCase()}` as TvmRef["requestBodyHash"] };
    expect(await exactTvm.status(upper, readerFor(late))).toEqual(landed.expect);
  });

  it("plant: an equal body executed on another account is never the payment", async () => {
    expect(await exactTvm.status(REF, readerFor(V.plant))).toEqual(V.plant.expect);
  });

  // A request completed with 64 zero bytes binds, because bound reads the signature and never verifies it. W5 checks
  // the signature before any action runs (wallet_v5.fc), so no transaction of the payer's W5 wallet sends its Jetton
  // transfer. An equal Jetton body executed on the payer's Jetton wallet some other way, and delivered, is not the
  // payment: pending `not-found` up to `validUntil`, then failed `expired`, or `no-transfer` when the W5 wallet ran the
  // request and sent nothing (the head read first decides, since wallet_v5.fc refuses a request at or past its
  // `valid_until`), never settled.
  it("plant: a Jetton transfer the payer's W5 wallet never sent is never the payment", async () => {
    const u = await exactTvm.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const unsigned = u.complete(new Uint8Array(64));
    if ("refused" in unsigned) throw new Error(unsigned.code);
    expect(await exactTvm.bound(unsigned)).toBe(V.V3.expectBound);
    const ref = await exactTvm.reference(unsigned);
    if ("refused" in ref) throw new Error(ref.code);
    const landed: Record<string, Fixture[]> = V.V4.status[0].byInMessage;
    const ignored = { hash: "tx-w5", account: ref.wallet, aborted: false, finality: 2 as const, outMsgs: [] };
    for (const [head, w5, want] of [
      [ref.validUntil, [], { state: "pending", why: "not-found" }],
      [ref.validUntil + 140, [], { state: "failed", why: "expired" }],
      [ref.validUntil + 140, [ignored], { state: "failed", why: "no-transfer" }],
    ] as const) {
      const reader: TvmReader = {
        network: ref.network,
        headUtime: async () => head,
        byInBody: async (bodyHash) => ({
          transactions: (
            bodyHash === ref.transferBodyHash ? landed["msg-jetton-transfer"]! : bodyHash === ref.requestBodyHash ? w5 : []
          ).map((f) => ({ ...f, inBody: null })),
          headUtime: head,
        }),
        byInMessage: async (msgHash) => (landed[msgHash] ?? []).map((f) => ({ ...f, inBody: null })),
        byHash: async () => null,
      };
      expect([head, w5.length, await exactTvm.status(ref, reader)]).toEqual([head, w5.length, want]);
    }
  });

  // W5 refuses a request once `valid_until <= now()` in its own transaction (wallet_v5.fc, `error::expired`), and an
  // internal message carries no expiry, so the Jetton transfer a W5 transaction emitted is delivered whenever it is
  // processed. The reader answers from a chain on which W5 executes the request one second before `validUntil` and the
  // payer's Jetton wallet takes the transfer `delay` seconds later and the payee's at once; the head advances `step`
  // seconds with every call. Once the whole chain has landed before the first read, the payment is settled.
  it("a request W5 executed before validUntil is never expired, however late its transfer lands", async () => {
    const executed = REF.validUntil - 1;
    const payer = { hash: "tx-payer", account: REF.jettonWallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "m", opcode: 0x178d4519 }] };
    const payee = { hash: "tx-payee", account: "0:" + "33".repeat(32), aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    const request = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "j", opcode: 0x0f8a7ea5 }] };
    for (const delay of [5, 61, 90, 3600]) {
      for (const start of [REF.validUntil - 30, REF.validUntil + 30, REF.validUntil + 61, executed + delay - 1]) {
        for (const step of [0, 1, 40]) {
          let now = start;
          const calls: string[] = [];
          const tick = <T>(name: string, v: T): T => {
            calls.push(name);
            now += step;
            return v;
          };
          const reader: TvmReader = {
            network: REF.network,
            headUtime: async () => tick("head", now),
            byInBody: async (bodyHash) =>
              tick("request", { transactions: bodyHash === REF.requestBodyHash && now >= executed ? [request] : [], headUtime: now }),
            byInMessage: async (msgHash) =>
              tick(msgHash, now < executed + delay ? [] : msgHash === "j" ? [payer] : msgHash === "m" ? [payee] : []),
            byHash: async () => null,
          };
          const got = await exactTvm.status(REF, reader);
          expect(calls[0]).toBe("head");
          expect(calls.length).toBeLessThanOrEqual(4);
          expect([delay, start, step, got.state]).not.toEqual([delay, start, step, "failed"]);
          if (start >= executed + delay) expect([delay, start, step, got]).toEqual([delay, start, step, { state: "settled", finality: "finalized" }]);
        }
      }
    }
  });

  // The same chain read through two indexes: the head comes from an index that has indexed past `validUntil`, the
  // lookup by the request's body hash from one that has not yet indexed the block in which W5 executed the request.
  // Each answer names the gen_utime of a masterchain block through which its index holds every block, and W5 refuses a
  // request only once `valid_until <= now()` (wallet_v5.fc), so an empty answer from an index behind the head read first
  // shows nothing about the request at that head.
  it("an empty lookup from an index behind the head read first is pending, never expired", async () => {
    const executed = REF.validUntil - 1;
    const request = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "j", opcode: 0x0f8a7ea5 }] };
    const payer = { hash: "tx-payer", account: REF.jettonWallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "m", opcode: 0x178d4519 }] };
    const payee = { hash: "tx-payee", account: "0:" + "33".repeat(32), aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    const head = REF.validUntil + 140;
    for (const indexed of [REF.validUntil - 20, executed - 1, executed, head - 1, head]) {
      const reader: TvmReader = {
        network: REF.network,
        headUtime: async () => head,
        byInBody: async () => ({ transactions: indexed >= executed ? [request] : [], headUtime: indexed }),
        byInMessage: async (msgHash) => (msgHash === "j" ? [payer] : msgHash === "m" ? [payee] : []),
        byHash: async () => null,
      };
      const want = indexed >= executed ? { state: "settled", finality: "finalized" } : { state: "pending", why: "not-found" };
      expect([indexed, await exactTvm.status(REF, reader)]).toEqual([indexed, want]);
    }
    const nothing = (indexed: unknown): TvmReader => ({
      ...readerFor({ headUtime: head }),
      byInBody: async () => ({ transactions: [], headUtime: indexed as number }),
    });
    expect(await exactTvm.status(REF, nothing(head))).toEqual({ state: "failed", why: "expired" });
    expect(await exactTvm.status(REF, nothing(head - 1))).toEqual({ state: "pending", why: "not-found" });
    expect(await exactTvm.status(REF, nothing(undefined))).toEqual({ state: "pending", why: "not-found" });
    const bare = { ...readerFor({ headUtime: head }), byInBody: async () => [] as never };
    expect(await exactTvm.status(REF, bare)).toEqual({ state: "pending", why: "unreadable" });
  });

  // W5 commits the seqno of an external request before its actions run, but an internal request that aborts leaves its
  // seqno unused (wallet_v5.fc: commit() only when is_external), so the same request can run again before valid_until.
  // Below, the request aborts once and then runs again and emits the Jetton transfer; the lookup comes from an index
  // that holds every block through `indexed`, behind the head read first.
  it("an aborted request from an index behind the head read first is pending, never aborted", async () => {
    const abortedAt = REF.validUntil - 20;
    const executed = REF.validUntil - 1;
    const aborted = { hash: "tx-w5-aborted", account: REF.wallet, aborted: true, finality: 2 as const, inBody: null, outMsgs: [] };
    const request = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "j", opcode: 0x0f8a7ea5 }] };
    const payer = { hash: "tx-payer", account: REF.jettonWallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "m", opcode: 0x178d4519 }] };
    const payee = { hash: "tx-payee", account: "0:" + "33".repeat(32), aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    const head = REF.validUntil + 140;
    for (const indexed of [abortedAt, executed - 1, executed, head]) {
      const reader: TvmReader = {
        network: REF.network,
        headUtime: async () => head,
        byInBody: async () => ({ transactions: indexed >= executed ? [aborted, request] : [aborted], headUtime: indexed }),
        byInMessage: async (msgHash) => (msgHash === "j" ? [payer] : msgHash === "m" ? [payee] : []),
        byHash: async () => null,
      };
      const want = indexed >= executed ? { state: "settled", finality: "finalized" } : { state: "pending", why: "not-found" };
      expect([indexed, await exactTvm.status(REF, reader)]).toEqual([indexed, want]);
    }
    const onlyAborted = (indexed: number): TvmReader => ({
      ...readerFor({ headUtime: head }),
      byInBody: async () => ({ transactions: [aborted], headUtime: indexed }),
    });
    expect(await exactTvm.status(REF, onlyAborted(head))).toEqual({ state: "failed", why: "aborted" });
    expect(await exactTvm.status(REF, onlyAborted(head - 1))).toEqual({ state: "pending", why: "not-found" });
  });

  // A lookup shows the W5 wallet's transactions only through the blocks its index holds, so a W5 transaction that ran the
  // request and emitted nothing reads failed `no-transfer` only from an index that holds every block through the head
  // read first; from an index behind that head, or a lookup naming no time, it is pending (docs/guides/rails.md,
  // "Reading settlement").
  it("an executed request that emitted nothing, from an index behind the head read first, is pending, never no-transfer", async () => {
    const head = REF.validUntil + 140;
    const ran = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    const lookup = (indexed: number | null): TvmReader => ({
      ...readerFor({ headUtime: head }),
      byInBody: async () => ({ transactions: [ran], headUtime: indexed }),
    });
    for (const indexed of [REF.validUntil - 20, REF.validUntil, head - 1, null]) {
      expect([indexed, await exactTvm.status(REF, lookup(indexed))]).toEqual([indexed, { state: "pending", why: "not-found" }]);
    }
    for (const indexed of [head, head + 60]) {
      expect([indexed, await exactTvm.status(REF, lookup(indexed))]).toEqual([indexed, { state: "failed", why: "no-transfer" }]);
    }
  });

  // An empty TON Center v3 transactionsByMessage answer names no block, so a reader takes the indexed time from a
  // second call, which a load-balanced endpoint can send to another index. A reader that cannot read the time from the
  // index that answered names none.
  it("an empty lookup naming a null indexed time is pending not-found, never expired", async () => {
    const head = REF.validUntil + 140;
    const lookup = (headUtime: number | null): TvmReader => ({
      ...readerFor({ headUtime: head }),
      byInBody: async () => ({ transactions: [], headUtime }),
    });
    expect(await exactTvm.status(REF, lookup(null))).toEqual({ state: "pending", why: "not-found" });
    expect(await exactTvm.status(REF, lookup(head))).toEqual({ state: "failed", why: "expired" });
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
