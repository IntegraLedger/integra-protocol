// Runs the TON pairing's vector file through the tvm entry point. Every expected value is the file's, computed with
// pytoniq-core 0.2.0 and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { beginCell, type Builder, Cell, Dictionary, loadCommonMessageInfoRelaxed, loadStateInit, storeStateInit } from "@ton/core";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
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
    for (const row of rowsOf(W.refusals, "x402-exact-tvm.json V2b.refusals")) {
      expect([row.case, await exactTvm.build({ ...choice(), stateInit: row.stateInit }, H)]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  // An undeployed wallet's address is the representation hash of its state init cell (x402's Python SDK 2.25.0,
  // address_from_state_init), and x402's TON scheme lets the settlement message carry that state init. This row's
  // libraries dictionary writes its one label as hml_short where hml_long is shorter: @ton/core's loadStateInit and
  // storeStateInit write it back as hml_long, another cell with the file's expectCanonicalStateInitHash, while build
  // carries the given cell. Every expected value is the file's (pytoniq-core 0.2.0 and PyNaCl 1.6.2).
  it("V2b: a state init whose libraries label is not its shortest form rides as given", async () => {
    const R = V.V2b.nonCanonicalLibraries;
    const given = Cell.fromBase64(R.stateInit);
    expect(hashHex(given)).toBe(R.expectStateInitHash);
    const restored = beginCell().store(storeStateInit(loadStateInit(given.beginParse()))).endCell();
    expect(hashHex(restored)).toBe(R.expectCanonicalStateInitHash);
    expect(R.expectCanonicalStateInitHash).not.toBe(R.expectStateInitHash);
    for (const stateInit of [R.stateInit, given]) {
      const u = await exactTvm.build({ ...choice(), wallet: R.wallet, seqno: V.V2b.seqno, stateInit }, H);
      if ("refused" in u) throw new Error(u.code);
      expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V2b.expectRequestHash);
      const sig = ed25519.sign(u.request.hash, seed);
      expect(Buffer.from(sig).toString("hex")).toBe(V.V2b.expectSignature);
      const p = u.complete(sig);
      if ("refused" in p) throw new Error(p.code);
      const root = Cell.fromBoc(Buffer.from(p.payload.settlementBoc, "base64"))[0]!;
      expect(hashHex(root)).toBe(R.expectSettlementRootHash);
      expect(hashHex(root.refs[0]!)).toBe(R.expectStateInitHash);
      expect(await exactTvm.bound(p)).toBe(H);
    }
  });

  // TL-B's MessageRelaxed: `init:(Maybe (Either StateInit ^StateInit))`, then the body. Read past the message's info,
  // the init is present as a reference, and that cell's hash is the address the wallet derives from its state init
  // (the file's `wallet` for each, computed with pytoniq-core 0.2.0 as x402's Python SDK 2.25.0 derives it), which is
  // the message's destination.
  it("V2b: the settlement message's init hashes to the address its state init derives", async () => {
    for (const row of [V.V2b, V.V2b.nonCanonicalLibraries]) {
      const u = await exactTvm.build({ ...choice(), wallet: row.wallet, seqno: V.V2b.seqno, stateInit: row.stateInit }, H);
      if ("refused" in u) throw new Error(u.code);
      const p = u.complete(ed25519.sign(u.request.hash, seed));
      if ("refused" in p) throw new Error(p.code);
      const s = Cell.fromBase64(p.payload.settlementBoc).beginParse();
      const info = loadCommonMessageInfoRelaxed(s);
      expect([s.loadBit(), s.loadBit()]).toEqual([true, true]);
      const init = s.loadRef();
      expect(`0:${hashHex(init)}`).toBe(row.wallet);
      expect(info.type === "internal" && info.dest.toRawString()).toBe(row.wallet);
    }
  });

  // TON reads an inbound message's `^StateInit` with `t_StateInitWithLibs.validate_ref` (ton-blockchain/ton
  // crypto/block/transaction.cpp, unpack_input_msg), and TLB::validate_ref_internal (crypto/tl/tlblib.cpp) accepts a
  // cell only when it is ordinary and read to its end (`cs.empty_ext()`), for the state init and for each cell of its
  // `library:(HashmapE 256 SimpleLib)` (crypto/block/block.tlb). Each state init below is V2b's, or V2b's code and data
  // with a libraries dictionary written cell by cell; its well-formed twin builds and rides as given, and each change
  // is x402/option-malformed, as a cell and as a base64 BoC.
  it("V2b: build takes only a state init TON reads as exactly one StateInitWithLibs", async () => {
    const { code, data } = loadStateInit(Cell.fromBase64(V.V2b.stateInit).beginParse());
    const v2b = Cell.fromBase64(V.V2b.stateInit);
    const key = code!.hash();
    const lib = (b: Builder) => b.storeBit(0).storeRef(code!);
    const leaf = (n: number, edit: (b: Builder) => Builder = (b) => b) =>
      edit(lib(beginCell().storeUint(0b10, 2).storeUint(n, 9).storeBuffer(key))).endCell();
    // A fork at the root: a zero-length label, then two edges whose 255-bit labels end the key past its first bit.
    const fork = (edit: (b: Builder) => Builder = (b) => b) => {
      const half = lib(beginCell().storeUint(0b10, 2).storeUint(255, 8).storeUint(key[0]! & 0x7f, 7).storeBuffer(key.subarray(1))).endCell();
      return edit(beginCell().storeUint(0b10, 2).storeUint(0, 9).storeRef(half).storeRef(half)).endCell();
    };
    const init = (dict: Cell | null, edit: (b: Builder) => Builder = (b) => b) =>
      edit(beginCell().storeBit(0).storeBit(0).storeMaybeRef(code).storeMaybeRef(data).storeMaybeRef(dict)).endCell();
    const library = beginCell().storeUint(2, 8).storeBuffer(Buffer.alloc(32, 1)).endCell({ exotic: true });
    const good = [v2b, init(leaf(256)), init(fork())];
    const bad: [string, Cell][] = [
      ["a bit after the fields", init(null, (b) => b.storeBit(1))],
      ["a reference after the fields", init(null, (b) => b.storeRef(beginCell().endCell()))],
      ["fixed_prefix_length cut short", beginCell().storeBit(1).storeUint(0, 3).endCell()],
      ["a libraries leaf with a bit after its SimpleLib", init(leaf(256, (b) => b.storeBit(1)))],
      ["a libraries leaf with a reference after its SimpleLib", init(leaf(256, (b) => b.storeRef(beginCell().endCell())))],
      ["a libraries fork with a bit after its two edges", init(fork((b) => b.storeBit(1)))],
      ["a libraries label longer than its key", init(leaf(257))],
      ["a libraries cell that is exotic", init(library)],
      ["a state init cell that is exotic", library],
    ];
    for (const given of good) {
      const u = await exactTvm.build({ ...choice(), stateInit: given }, H);
      if ("refused" in u) throw new Error(u.code);
      const p = u.complete(ed25519.sign(u.request.hash, seed));
      if ("refused" in p) throw new Error(p.code);
      expect(Cell.fromBase64(p.payload.settlementBoc).refs[0]!.equals(given)).toBe(true);
    }
    for (const [name, given] of bad) {
      for (const stateInit of [given, given.toBoc({ idx: false, crc32: true }).toString("base64")]) {
        expect([name, await exactTvm.build({ ...choice(), stateInit }, H)]).toEqual([name, { refused: true, code: "x402/option-malformed" }]);
      }
    }
  });

  // TON validates a message's state init with `validate_ref` at its default bound of 1,024 cells
  // (ton-blockchain/ton crypto/tl/tlblib.hpp, default_validate_max_cells; crypto/tl/tlblib.cpp, validate_ref_internal,
  // which counts every cell it reads, the state init's first): a dictionary cell counts each time a path reaches it.
  // A libraries dictionary whose forks each reference one child cell twice holds 2^f entries in f + 1 cells, and TON
  // reads 2^(f+1) - 1 of them: at 9 levels the state init's 1,024 reads are within the bound, at 10 and at 30 (the
  // deepest the BoC's 32-level bound admits) they are not. The dictionary @ton/core writes for the keys 0 to 511 has
  // 1,023 cells on its paths, and the one for 0 to 512 has 1,025. Each verdict is TON's own, from its transaction
  // emulator (ton 8e6f091) relaying each state init in this pairing's settlement message.
  it("V2b: a state init whose validation reads more than TON's 1,024 cells is refused", async () => {
    const { code, data } = loadStateInit(Cell.fromBase64(V.V2b.stateInit).beginParse());
    const init = (dict: Cell) => beginCell().storeBit(0).storeBit(0).storeMaybeRef(code).storeMaybeRef(data).storeMaybeRef(dict).endCell();
    const width = (n: number) => Math.ceil(Math.log2(n + 1));
    const shared = (forks: number) => {
      let node = beginCell().storeUint(0b10, 2).storeBit(0).storeRef(code!).endCell();
      for (let n = 1; n < forks; n++) node = beginCell().storeUint(0b10, 2).storeUint(0, width(n)).storeRef(node).storeRef(node).endCell();
      return init(beginCell().storeUint(0b11, 2).storeBit(0).storeUint(256 - forks, width(256)).storeRef(node).storeRef(node).endCell());
    };
    const plain = (entries: number) => {
      const d = Dictionary.empty(Dictionary.Keys.BigUint(256), {
        serialize: (v: Cell, b: Builder) => b.storeBit(0).storeRef(v),
        parse: (s) => s.loadRef(),
      });
      for (let i = 0; i < entries; i++) d.set(BigInt(i), code!);
      return init(beginCell().storeDictDirect(d).endCell());
    };
    const malformed = { refused: true, code: "x402/option-malformed" };
    for (const [name, given, builds] of [
      ["9 levels of shared forks", shared(9), true],
      ["10 levels of shared forks", shared(10), false],
      ["30 levels of shared forks", shared(30), false],
      ["512 plain entries", plain(512), true],
      ["513 plain entries", plain(513), false],
    ] as const) {
      const built = await exactTvm.build({ ...choice(), stateInit: given }, H);
      if (!builds) {
        expect([name, built]).toEqual([name, malformed]);
        continue;
      }
      if ("refused" in built) throw new Error(`${name}: ${built.code}`);
      const p = built.complete(ed25519.sign(built.request.hash, seed));
      if ("refused" in p) throw new Error(p.code);
      expect([name, Cell.fromBase64(p.payload.settlementBoc).refs[0]!.equals(given)]).toEqual([name, true]);
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
    for (const row of rowsOf(V.V3.refusals, "x402-exact-tvm.json V3.refusals")) {
      expect([row.case, await exactTvm.bound(payment(row.settlementBoc, row.accepted))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  // TEP-74's text comment is 32 zero bits, then the text's UTF-8. The V3 refusal whose comment begins with a byte-order
  // mark is V2's settlement, read with @ton/core 0.63.1, with V1's comment cell replaced by one of 0x00000000, EF BB BF
  // (U+FEFF in UTF-8) and H's LCP string, signed with fixed.seedHex; its option's forwardPayload holds the same cell.
  it("V3: the refusal whose comment begins with a byte-order mark is V2's settlement with only its comment changed", async () => {
    const row = V.V3.refusals.find((r: { case: string }) => r.case.startsWith("a comment of 0x00000000, a byte-order mark"));
    const led = Cell.fromBase64(row.accepted.extra.forwardPayload);
    const s = led.beginParse();
    expect([s.loadUint(32), led.refs.length]).toEqual([0, 0]);
    expect(s.loadBuffer(s.remainingBits / 8).toString("hex")).toBe(`efbbbf${Buffer.from(`lcp:sha256:${H}`, "utf8").toString("hex")}`);
    const withRefs = (b: Builder, refs: Cell[]) => (refs.forEach((r) => b.storeRef(r)), b);
    const swap = (c: Cell, from: Cell, to: Cell): Cell =>
      c.equals(from) ? to : withRefs(beginCell().storeBits(c.bits), c.refs.map((r) => swap(r, from, to))).endCell();
    const unsigned = (c: Cell) => withRefs(beginCell().storeBits(c.bits.substring(0, c.bits.length - 512)), c.refs).endCell();
    const root = Cell.fromBase64(row.settlementBoc);
    const v2 = Cell.fromBase64((await signed()).payload.settlementBoc);
    expect(root.bits.equals(v2.bits)).toBe(true);
    const request = unsigned(root.refs.at(-1)!);
    expect(request.equals(swap(unsigned(v2.refs.at(-1)!), Cell.fromBase64(V.V1.expectBoc), led))).toBe(true);
    const signature = root.refs.at(-1)!.beginParse().skip(request.bits.length).loadBuffer(64);
    expect(ed25519.verify(signature, request.hash(), ed25519.getPublicKey(seed))).toBe(true);
    expect({ ...row.accepted, extra: { ...row.accepted.extra, forwardPayload: undefined } }).toEqual({
      ...placed,
      extra: { ...placed.extra, forwardPayload: undefined },
    });
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
    for (const row of rowsOf(V.V4.status, "x402-exact-tvm.json V4.status")) {
      expect([row.case, await exactTvm.status(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of rowsOf(V.V4.recover, "x402-exact-tvm.json V4.recover")) {
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

  // A W5 transaction runs at its shard block's time, and a masterchain block references that shard block only later,
  // so an index that holds every block through a masterchain head past `validUntil` can still lack a request W5 ran in
  // time. The reader answers from a chain on which W5 runs the request one second before `validUntil` in a shard block
  // the masterchain references `lag` seconds later; its index holds every block through the head and lists the request's
  // transaction once it holds that masterchain block. Until the head is more than 60 seconds past `validUntil`, a
  // request no W5 transaction sent is pending `not-found`, whichever of its arms the lookup shows.
  it("a request no W5 transaction sent reads failed only more than 60 seconds past validUntil", async () => {
    const executed = REF.validUntil - 1;
    const request = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "j", opcode: 0x0f8a7ea5 }] };
    const payer = { hash: "tx-payer", account: REF.jettonWallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [{ hash: "m", opcode: 0x178d4519 }] };
    const payee = { hash: "tx-payee", account: "0:" + "33".repeat(32), aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    for (const lag of [1, 20, 61]) {
      for (let head = REF.validUntil - 5; head <= executed + lag + 5; head++) {
        const reader: TvmReader = {
          network: REF.network,
          headUtime: async () => head,
          byInBody: async () => ({ transactions: head >= executed + lag ? [request] : [], headUtime: head }),
          byInMessage: async (msgHash) => (msgHash === "j" ? [payer] : msgHash === "m" ? [payee] : []),
          byHash: async () => null,
        };
        const got = await exactTvm.status(REF, reader);
        const want = head >= executed + lag ? { state: "settled", finality: "finalized" } : { state: "pending", why: "not-found" };
        expect([lag, head, got]).toEqual([lag, head, want]);
      }
    }
    const ran = { hash: "tx-w5", account: REF.wallet, aborted: false, finality: 2 as const, inBody: null, outMsgs: [] };
    const aborted = { ...ran, aborted: true };
    for (const [found, why] of [[[], "expired"], [[ran], "no-transfer"], [[aborted], "aborted"]] as const) {
      for (const [past, want] of [
        [1, { state: "pending", why: "not-found" }],
        [60, { state: "pending", why: "not-found" }],
        [61, { state: "failed", why }],
      ] as const) {
        const head = REF.validUntil + past;
        const reader: TvmReader = { ...readerFor({ headUtime: head }), byInBody: async () => ({ transactions: [...found], headUtime: head }) };
        expect([why, past, await exactTvm.status(REF, reader)]).toEqual([why, past, want]);
      }
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
    for (const row of rowsOf(V.agreedRefusals.rows, "x402-exact-tvm.json agreedRefusals.rows", {
      keep: ["the rows this test runs at advertise, build, complete, bound or recover", (r) => !r.expect.endsWith("/peer-missing")],
      leave: ["the peer-missing row, which ton-near-peer-missing.test.ts runs with @ton/core absent", (r) => r.expect.endsWith("/peer-missing")],
    })) {
      const want = { refused: true, code: row.expect };
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
      } else if (row.stateInit !== undefined) {
        expect([row.case, await exactTvm.build({ ...choice(), stateInit: row.stateInit }, H)]).toEqual([row.case, want]);
        expect([row.case, await exactTvm.build({ ...choice(), stateInit: Cell.fromBase64(row.stateInit) }, H)]).toEqual([row.case, want]);
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

  // TL-B's addr_std (block.tlb): `workchain_id:int8`, so a raw `workchain:hex` address whose workchain is outside
  // [-128, 127] is not one an addr_std can hold. Every raw address the pairing reads is held to it: the option filter's
  // asset, payTo and responseDestination (`tvm/option-malformed`, wherever the filter runs), build's wallet and
  // jettonWallet (`x402/option-malformed`), and status's reference (pending `unreadable`, with nothing read). -128 and
  // 127 build.
  it("a raw address whose workchain is outside int8 is refused at every read, never a throw", async () => {
    const hex = (raw: string) => raw.slice(raw.indexOf(":") + 1);
    const outside = ["128", "-129", "9999999999", "-9999999999"];
    for (const wc of outside) {
      const malformed = { refused: true, code: "tvm/option-malformed" };
      for (const field of ["asset", "payTo", "responseDestination"] as const) {
        const at = (o: PaymentRequirements): PaymentRequirements =>
          field === "responseDestination"
            ? { ...o, extra: { ...o.extra, responseDestination: `${wc}:${hex(o.payTo)}` } }
            : { ...o, [field]: `${wc}:${hex(o[field])}` };
        const offered = at(O);
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [offered] };
        expect([wc, field, exactTvm.advertise(doc, H, V.fixed.link, offered)]).toEqual([wc, field, malformed]);
        expect([wc, field, pairingOf(offered)]).toEqual([wc, field, undefined]);
        const accepted = at(placed);
        const built = await exactTvm.build({ ...choice(), required: { ...required, accepts: [accepted] }, accepted }, H);
        expect([wc, field, built]).toEqual([wc, field, malformed]);
        const p = await signed();
        expect([wc, field, await exactTvm.bound({ ...p, accepted })]).toEqual([wc, field, malformed]);
        expect([wc, field, await exactTvm.reference({ ...p, accepted })]).toEqual([wc, field, malformed]);
      }
      for (const field of ["wallet", "jettonWallet"] as const) {
        const built = await exactTvm.build({ ...choice(), [field]: `${wc}:${hex(V.fixed[field])}` }, H);
        expect([wc, field, built]).toEqual([wc, field, { refused: true, code: "x402/option-malformed" }]);
        const { reader, calls } = counting(readerFor(V.V4.status[0]));
        const ref = { ...REF, [field]: `${wc}:${hex(REF[field])}` };
        expect([wc, field, await exactTvm.status(ref, reader)]).toEqual([wc, field, { state: "pending", why: "unreadable" }]);
        expect(calls).toEqual([]);
      }
    }
    for (const wc of ["-128", "127"]) {
      const u = await exactTvm.build({ ...choice(), wallet: `${wc}:${hex(V.fixed.wallet)}`, jettonWallet: `${wc}:${hex(V.fixed.jettonWallet)}` }, H);
      if ("refused" in u) throw new Error(u.code);
      const p = u.complete(new Uint8Array(64));
      if ("refused" in p) throw new Error(p.code);
      const ref = await exactTvm.reference(p);
      expect(ref).toMatchObject({ wallet: `${wc}:${hex(V.fixed.wallet)}`, jettonWallet: `${wc}:${hex(V.fixed.jettonWallet)}` });
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
