// Runs the TON pairing's vector file through the tvm entry point. Every expected value is the file's, computed with
// pytoniq-core 0.2.0 and PyNaCl 1.6.2, except where a test names another source.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { beginCell, type Builder, Cell, crc32c, Dictionary, loadCommonMessageInfoRelaxed, loadStateInit, storeStateInit } from "@ton/core";
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

// A bag of cells written field by field in the layout TON's deserializer reads (ton-blockchain/ton crypto/vm/boc.cpp,
// BagOfCells::Info::parse_serialized_header and BagOfCells::deserialize), so that a test can give any field a value
// TON refuses. A cell is its two descriptor bytes, its stored hashes and depths when d1 says so, its data with the
// completion tag, and one index per reference. Cells are written parents first, and the CRC32C of every byte before
// it closes the bag.
type Written = { d1: number; d2: number; stored: Buffer; data: Buffer; refs: Written[] };
const u16 = (v: number) => Buffer.from([v >> 8, v & 255]);
function writtenOf(c: Cell, hashes = false, memo = new Map<string, Written>()): Written {
  const known = memo.get(hashHex(c));
  if (known !== undefined) return known;
  const n = c.bits.length;
  const data = Buffer.alloc(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (c.bits.at(i)) data[i >> 3] = data[i >> 3]! | (0x80 >> (i & 7));
  if (n % 8 !== 0) data[n >> 3] = data[n >> 3]! | (0x80 >> (n & 7));
  // A cell stores the hash and depth of level 0 and of each level its mask sets, the hashes first.
  const levels = [0, 1, 2, 3].filter((l) => l === 0 || ((c.mask.value >> (l - 1)) & 1) === 1);
  const stored = Buffer.concat(hashes ? [...levels.map((l) => c.hash(l)), ...levels.map((l) => u16(c.depth(l)))] : []);
  const w: Written = {
    d1: c.refs.length + (c.isExotic ? 8 : 0) + (hashes ? 16 : 0) + c.mask.value * 32,
    d2: Math.floor(n / 8) + Math.ceil(n / 8),
    stored,
    data,
    refs: c.refs.map((r) => writtenOf(r, hashes, memo)),
  };
  memo.set(hashHex(c), w);
  return w;
}
const bigEndian = (v: number, size: number) => {
  const b = Buffer.alloc(size);
  for (let i = size - 1, x = v; i >= 0; i--, x = Math.floor(x / 256)) b[i] = x % 256;
  return b;
};
function bagOf(
  root: Written,
  h: { index?: boolean; cacheBits?: boolean; flipCache?: number; refSize?: number; offSize?: number; absent?: number; pastCells?: number[]; beforeCrc?: number[] } = {},
): string {
  const order: Written[] = [];
  const seen = new Set<Written>();
  const visit = (w: Written) => {
    if (seen.has(w)) return;
    seen.add(w);
    w.refs.forEach(visit);
    order.push(w);
  };
  visit(root);
  order.reverse();
  const at = new Map(order.map((w, i) => [w, i]));
  const refSize = h.refSize ?? 1;
  const offSize = h.offSize ?? 2;
  const named = order.map((w) => (w === root ? 1 : 0));
  const cells = order.map((w) => {
    const refs = w.refs.map((r) => {
      named[at.get(r)!]!++;
      return bigEndian(at.get(r)!, refSize);
    });
    return Buffer.concat([Buffer.from([w.d1, w.d2]), w.stored, w.data, ...refs]);
  });
  const past = Buffer.from(h.pastCells ?? []);
  const data = Buffer.concat([...cells, past]);
  const index: Buffer[] = [];
  let end = 0;
  for (let i = 0; h.index === true && i < cells.length; i++) {
    end += cells[i]!.length + (i === cells.length - 1 ? past.length : 0);
    const cached = named[i]! > 1 !== (h.flipCache === i);
    index.push(bigEndian(h.cacheBits === true ? end * 2 + (cached ? 1 : 0) : end, offSize));
  }
  const flags = (h.index === true ? 0x80 : 0) | 0x40 | (h.cacheBits === true ? 0x20 : 0) | refSize;
  const head = Buffer.concat([
    bigEndian(0xb5ee9c72, 4),
    Buffer.from([flags, offSize]),
    bigEndian(order.length, refSize),
    bigEndian(1, refSize),
    bigEndian(h.absent ?? 0, refSize),
    bigEndian(data.length, offSize),
    bigEndian(0, refSize),
  ]);
  const bag = Buffer.concat([head, ...index, data, Buffer.from(h.beforeCrc ?? [])]);
  return Buffer.concat([bag, crc32c(bag)]).toString("base64");
}

// The Jetton transfer at `path` under `root`, given a custom_payload, with every cell above it rebuilt. No read parses
// a custom_payload; the request's signature is left as it is, which bound does not verify.
const cellAt = (root: Cell, path: readonly number[]): Cell => path.reduce((c, i) => c.refs[i]!, root);
function replaced(c: Cell, path: readonly number[], to: Cell): Cell {
  if (path.length === 0) return to;
  const b = beginCell().storeBits(c.bits);
  c.refs.forEach((r, i) => b.storeRef(i === path[0] ? replaced(r, path.slice(1), to) : r));
  return b.endCell();
}
function paying(root: Cell, path: readonly number[], customPayload: Cell): Cell {
  const s = cellAt(root, path).beginParse();
  const op = s.loadUint(32);
  const queryId = s.loadUintBig(64);
  const amount = s.loadCoins();
  const destination = s.loadAddress();
  const response = s.loadMaybeAddress();
  if (s.loadMaybeRef() !== null) throw new Error("the transfer already carries a custom_payload");
  const forwardTon = s.loadCoins();
  if (!s.loadBit()) throw new Error("the forward payload is not a reference");
  const forward = s.loadRef();
  const transfer = beginCell()
    .storeUint(op, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(destination)
    .storeAddress(response)
    .storeMaybeRef(customPayload)
    .storeCoins(forwardTon)
    .storeBit(1)
    .storeRef(forward)
    .endCell();
  return replaced(root, path, transfer);
}
const h32 = (k: number) => Buffer.alloc(32, k);
const leaf = beginCell().storeUint(0x5a, 8).endCell();
/** A pruned branch of `mask` (set bits running up from the lowest, which @ton/core builds), its hashes 0x11, 0x22 and 0x33 bytes. */
function prunedOf(mask: number, depth = 3): Cell {
  const count = [0, 1, 2].filter((i) => ((mask >> i) & 1) === 1).length;
  const b = beginCell().storeUint(1, 8).storeUint(mask, 8);
  for (let i = 0; i < count; i++) b.storeBuffer(h32(0x11 * (i + 1)));
  for (let i = 0; i < count; i++) b.storeUint(depth + i, 16);
  return b.endCell({ exotic: true });
}
const merkleProofOf = (child: Cell) =>
  beginCell().storeUint(3, 8).storeBuffer(child.hash(0)).storeUint(child.depth(0), 16).storeRef(child).endCell({ exotic: true });
/** `child` under an ordinary cell of one byte, then `n` Merkle proofs. */
const provenOf = (child: Cell, n: number) => {
  let c = beginCell().storeUint(0x5a, 8).storeRef(child).endCell();
  for (let i = 0; i < n; i++) c = merkleProofOf(c);
  return c;
};
const libraryOf = (refs: Cell[]) => {
  const b = beginCell().storeUint(2, 8).storeBuffer(h32(1));
  refs.forEach((r) => b.storeRef(r));
  return b.endCell({ exotic: true });
};

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

  // Each form is one TON's bag-of-cells deserialization refuses (ton-blockchain/ton crypto/vm/boc.cpp and
  // crypto/vm/cells/DataCell.cpp, at the function each names), written into V2's settlement and into its Jetton transfer
  // body. bound and tvmCarrier read the settlement and recover reads the body, and each refuses every form with
  // tvm/boc-malformed, while the same writer's bytes without a form bind H. TON's emulator (@ton/sandbox 0.45.0)
  // refuses each form's settlement with "Can't deserialize message boc".
  it("a settlement BoC TON's deserialization refuses is tvm/boc-malformed at bound and tvmCarrier, and its body tvm/unreadable at recover", async () => {
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const transferAt = [0, 0, 1, 0] as const;
    const body = cellAt(settlement, transferAt);
    const comment = Cell.fromBase64(V.V1.expectBoc);
    const withComment = (root: Cell, edit: (w: Written) => void) => {
      const memo = new Map<string, Written>();
      const w = writtenOf(root, false, memo);
      edit(memo.get(hashHex(comment))!);
      return bagOf(w);
    };
    const placeholder = beginCell().storeUint(0xc0ffee, 24).endCell();
    const forms: [string, (root: Cell, at: readonly number[]) => string][] = [
      // DataCell.cpp, CellChecker: a library cell is 264 bits with no reference.
      ["a library cell with a reference", (r, at) => bagOf(writtenOf(paying(r, at, libraryOf([leaf]))))],
      // CellChecker: a pruned branch's second byte is its level mask, from 1 to 7, and it is (2 + 34 × the mask's set
      // bits) × 8 bits long. @ton/core reads a 280-bit pruned branch (type, hash, depth) as one of mask 1.
      [
        "a pruned branch of 280 bits",
        (r, at) => bagOf(writtenOf(paying(r, at, merkleProofOf(beginCell().storeUint(1, 8).storeBuffer(h32(0x11)).storeUint(3, 16).endCell({ exotic: true }))))),
      ],
      // boc.cpp, CellSerializationInfo::create_data_cell: the level mask d1 gives is the one TON computes.
      ["a descriptor level mask of 1 on a cell of level 0", (r) => withComment(r, (w) => (w.d1 |= 0x20))],
      // create_data_cell: each stored hash and depth is the one TON computes.
      [
        "a stored representation hash with one bit flipped",
        (r) =>
          withComment(r, (w) => {
            const hash = Buffer.from(comment.hash());
            hash[0] = hash[0]! ^ 1;
            w.d1 |= 0x10;
            w.stored = Buffer.concat([hash, u16(0)]);
          }),
      ],
      // CellSerializationInfo::get_bits: a partial last byte holds a data bit before its completion tag.
      [
        "a padded last byte of 0x80",
        (r) =>
          withComment(r, (w) => {
            w.d2 += 1;
            w.data = Buffer.concat([w.data, Buffer.from([0x80])]);
          }),
      ],
      // BagOfCells::deserialize_cell: an index entry ends where its cell ends.
      ["an index entry one byte past its cell", (r) => bagOf(writtenOf(r), { index: true, pastCells: [0] })],
      // BagOfCells::deserialize: a cache bit is set exactly when two or more references, the root's counted, name the cell.
      ["a cache bit set on a cell named once", (r) => bagOf(writtenOf(r), { index: true, cacheBits: true, flipCache: 0 })],
      // std_boc_deserialize: the root is of level 0.
      ["a root of level 1", (r, at) => bagOf(writtenOf(paying(r, at, prunedOf(1))))],
      // CellChecker and CellTraits::max_depth: a cell's depth at each level is at most 1,024.
      ["a pruned branch whose stored depth is 1,025", (r, at) => bagOf(writtenOf(paying(r, at, merkleProofOf(prunedOf(1, 1025)))))],
      // CellSerializationInfo::init: a cell has at most four references.
      [
        "a library cell written with five references",
        (r, at) => {
          const memo = new Map<string, Written>();
          const w = writtenOf(paying(r, at, placeholder), false, memo);
          Object.assign(memo.get(hashHex(placeholder))!, {
            d1: 5 + 8,
            d2: 66,
            data: Buffer.concat([Buffer.from([2]), h32(1)]),
            refs: Array.from({ length: 5 }, () => writtenOf(leaf)),
          });
          return bagOf(w);
        },
      ],
      // BagOfCells::Info::parse_serialized_header: references of 1 to 4 bytes, offsets of 1 to 8, no more absent cells
      // than cells, and cache bits only with an index.
      ["references of 5 bytes", (r) => bagOf(writtenOf(r), { refSize: 5 })],
      ["offsets of 9 bytes", (r) => bagOf(writtenOf(r), { offSize: 9 })],
      ["255 absent cells", (r) => bagOf(writtenOf(r), { absent: 255 })],
      ["cache bits with no index", (r) => bagOf(writtenOf(r), { cacheBits: true })],
      // BagOfCells::deserialize: with no index, the cells fill the data the header counts.
      ["a data size one byte past the cells, with no index", (r) => bagOf(writtenOf(r), { pastCells: [0] })],
    ];
    const recovered = (boc: string) =>
      exactTvm.recover({ network: REF.network, transaction: "x" }, readerFor({ inBodyHex: Buffer.from(boc, "base64").toString("hex") }));
    expect(await exactTvm.bound(payment(bagOf(writtenOf(settlement))))).toBe(H);
    expect(await recovered(bagOf(writtenOf(body)))).toBe(H);
    const malformed = { refused: true, code: "tvm/boc-malformed" };
    // recover reads the body from the reader, so a body TON would not deserialize is an answer out of the reader's form.
    const unreadable = { refused: true, code: "tvm/unreadable" };
    for (const [name, form] of rowsOf(forms, "the forms TON's deserialization refuses", { exact: 15 })) {
      const boc = form(settlement, transferAt);
      expect([name, await exactTvm.bound(payment(boc))]).toEqual([name, malformed]);
      expect([name, tvmCarrier(boc)]).toEqual([name, malformed]);
      expect([name, await recovered(form(body, []))]).toEqual([name, unreadable]);
    }
  });

  // TON takes a bag's CRC32C from the input's last four bytes and reads the cells to the data size its header gives
  // (ton-blockchain/ton crypto/vm/boc.cpp, BagOfCells::deserialize), so a byte between the cells and the CRC32C is
  // read past. TON's emulator (@ton/sandbox 0.45.0) deserializes such a settlement, and lcp reads it as V2's.
  it("a settlement BoC with a byte between its cells and its CRC32C reads as V2's", async () => {
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const boc = bagOf(writtenOf(settlement), { beforeCrc: [0] });
    expect(await exactTvm.bound(payment(boc))).toBe(H);
    expect(await exactTvm.reference(payment(boc))).toEqual(V.V3.expectReference);
    const c = tvmCarrier(boc);
    if ("refused" in c) throw new Error(c.code);
    expect([c.h, c.requestBodyHash]).toEqual([H, V.V3.expectReference.requestBodyHash]);
    const body = bagOf(writtenOf(cellAt(settlement, [0, 0, 1, 0])), { beforeCrc: [0] });
    const reader = readerFor({ inBodyHex: Buffer.from(body, "base64").toString("hex") });
    expect(await exactTvm.recover({ network: REF.network, transaction: "x" }, reader)).toBe(H);
  });

  // A pruned branch's level mask need not set its bits from the lowest up: under two Merkle proofs, one of mask 2 is a
  // cell TON reads and sends (fixtures/tvm-pruned-branch-mask-2.json gives how TON runs it). bound binds that
  // settlement, and reference gives the hashes TON's HASHCU gives. For masks 1, 3 and 7, which @ton/core builds, the
  // Jetton transfer body is written with each cell's hashes and depths at every level as @ton/core computes them,
  // and the read checks each against its own as TON does (CellSerializationInfo::create_data_cell): recover reads it.
  // For masks 1 and 3, whose settlement has at most two Merkle levels, reference gives @ton/core's hashes too.
  it("a pruned branch of each level mask is hashed as TON hashes it", async () => {
    const F = JSON.parse(readFileSync(new URL("./fixtures/tvm-pruned-branch-mask-2.json", import.meta.url), "utf8"));
    expect(await exactTvm.bound(payment(F.settlementBoc))).toBe(H);
    expect(await exactTvm.reference(payment(F.settlementBoc))).toEqual({
      ...V.V3.expectReference,
      requestBodyHash: F.expectRequestBodyHash,
      transferBodyHash: F.expectTransferBodyHash,
      wallet: F.wallet,
      validUntil: F.validUntil,
    });
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const transferAt = [0, 0, 1, 0] as const;
    for (const [mask, proofs] of [[1, 1], [3, 2], [7, 3]] as const) {
      const root = paying(settlement, transferAt, provenOf(prunedOf(mask), proofs));
      const transfer = cellAt(root, transferAt);
      const reader = readerFor({ inBodyHex: Buffer.from(bagOf(writtenOf(transfer, true)), "base64").toString("hex") });
      expect([mask, await exactTvm.recover({ network: REF.network, transaction: "x" }, reader)]).toEqual([mask, H]);
      if (proofs > 2) continue;
      const ref = await exactTvm.reference(payment(root.toBoc({ idx: false, crc32: true }).toString("base64")));
      expect([mask, ref]).toEqual([mask, { ...V.V3.expectReference, requestBodyHash: `0x${hashHex(root.refs[0]!)}`, transferBodyHash: `0x${hashHex(transfer)}` }]);
    }
  });

  // A wallet deployed from a code library carries a library cell as its state init's code. The state init rides
  // outside the signed request, and no read parses its code, so the payment is V2's: its request hash is V2's and
  // bound and reference give V3's values (pytoniq-core 0.2.0 and PyNaCl 1.6.2, as the file records).
  // Each read of a base64 BoC holds it to TON's deserialization: advertise's and the carriers' `extra.forwardPayload`,
  // and build's state init. Each form below leaves the root the cell that read expects, V1's comment or V2b's state
  // init, so only the bytes' form is refused: advertise answers tvm/carrier-occupied, bound and reference
  // tvm/carrier-mismatch, and build tvm/boc-malformed.
  it("every read of a base64 BoC refuses the forms TON's deserialization refuses", async () => {
    const comment = Cell.fromBase64(V.V1.expectBoc);
    const init = Cell.fromBase64(V.V2b.stateInit);
    const atRoot = (root: Cell, edit: (w: Written) => void, h: Parameters<typeof bagOf>[1] = {}) => {
      const w = writtenOf(root);
      edit(w);
      return bagOf(w, h);
    };
    const forms: [string, (root: Cell) => string][] = [
      ["a descriptor level mask of 1 on a cell of level 0", (r) => atRoot(r, (w) => (w.d1 |= 0x20))],
      [
        "a stored representation hash with one bit flipped",
        (r) =>
          atRoot(r, (w) => {
            const hash = Buffer.from(r.hash());
            hash[0] = hash[0]! ^ 1;
            w.d1 |= 0x10;
            w.stored = Buffer.concat([hash, u16(r.depth())]);
          }),
      ],
      ["an index entry one byte past its cell", (r) => atRoot(r, () => {}, { index: true, pastCells: [0] })],
      ["a cache bit set on a cell named once", (r) => atRoot(r, () => {}, { index: true, cacheBits: true, flipCache: 0 })],
      ["references of 5 bytes", (r) => atRoot(r, () => {}, { refSize: 5 })],
      ["offsets of 9 bytes", (r) => atRoot(r, () => {}, { offSize: 9 })],
      ["255 absent cells", (r) => atRoot(r, () => {}, { absent: 255 })],
      ["cache bits with no index", (r) => atRoot(r, () => {}, { cacheBits: true })],
      ["a data size one byte past the cells, with no index", (r) => atRoot(r, () => {}, { pastCells: [0] })],
    ];
    const p = await signed();
    const offered = (boc: string) => ({ ...O, extra: { ...O.extra, forwardPayload: boc } });
    const accepted = (boc: string) => ({ ...placed, extra: { ...placed.extra, forwardPayload: boc } });
    const doc = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
    expect(exactTvm.advertise(doc(offered(bagOf(writtenOf(comment)))), H, V.fixed.link, offered(bagOf(writtenOf(comment))))).not.toHaveProperty("refused");
    expect(await exactTvm.bound({ ...p, accepted: accepted(bagOf(writtenOf(comment))) })).toBe(H);
    expect(await exactTvm.build({ ...choice(), stateInit: bagOf(writtenOf(init)) }, H)).not.toHaveProperty("refused");
    for (const [name, form] of rowsOf(forms, "the forms TON's deserialization refuses at a root the read expects", { exact: 9 })) {
      const payload = form(comment);
      expect([name, exactTvm.advertise(doc(offered(payload)), H, V.fixed.link, offered(payload))]).toEqual([name, { refused: true, code: "tvm/carrier-occupied" }]);
      const mismatch = { refused: true, code: "tvm/carrier-mismatch" };
      expect([name, await exactTvm.bound({ ...p, accepted: accepted(payload) })]).toEqual([name, mismatch]);
      expect([name, await exactTvm.reference({ ...p, accepted: accepted(payload) })]).toEqual([name, mismatch]);
      expect([name, await exactTvm.build({ ...choice(), stateInit: form(init) }, H)]).toEqual([name, { refused: true, code: "tvm/boc-malformed" }]);
    }
  });

  // A message is read as TON's action phase sends it (ton-blockchain/ton crypto/block/transaction.cpp at ed629c4,
  // try_action_send_msg; the configuration is mainnet's, as @ton/sandbox 0.45.0 ships it): the relayer's sends the
  // settlement message, and the W5 wallet's sends the outgoing one. Each case is V2's settlement with one field of one
  // message written bit by bit. A form TON refuses to send is tvm/boc-malformed on the settlement message and
  // tvm/not-jetton-transfer on the outgoing one; a form TON sends binds H, and reference names the address TON sends to.
  // TON's emulator (ton 8e6f091, whose address and message rules equal ed629c4's) gives the same verdict on each case's
  // own bytes, the probe's raw-bit messages.
  it("a message is read as TON's action phase sends it: its addresses, extra currencies, extra_flags and body", async () => {
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const request = settlement.refs[0]!;
    const transfer = cellAt(settlement, [0, 0, 1, 0]);
    const wallet: string = V.fixed.wallet;
    const jetton: string = V.fixed.jettonWallet;
    const other = `0:${"12".repeat(32)}`;
    type Writes = (b: Builder) => Builder;
    const hashOf = (raw: string) => Buffer.from(raw.slice(raw.indexOf(":") + 1), "hex");
    const wcOf = (raw: string) => Number(raw.slice(0, raw.indexOf(":")));
    const anycast = (b: Builder, any: boolean) => (any ? b.storeBit(1).storeUint(1, 5).storeBit(0) : b.storeBit(0));
    const none: Writes = (b) => b.storeUint(0, 2);
    const extern: Writes = (b) => b.storeUint(1, 2).storeUint(8, 9).storeUint(0xff, 8);
    const std = (raw: string, any = false): Writes => (b) => anycast(b.storeUint(2, 2), any).storeInt(wcOf(raw), 8).storeBuffer(hashOf(raw));
    const addrVar = (raw: string, len = 256, any = false): Writes => (b) => {
      anycast(b.storeUint(3, 2), any).storeUint(len, 9).storeInt(wcOf(raw), 32);
      const bits = BigInt(`0x${hashOf(raw).toString("hex")}`);
      return len <= 256 ? b.storeUint(bits >> BigInt(256 - len), len) : b.storeUint(bits, 256).storeUint(0, len - 256);
    };
    const message = (k: { src?: Writes; dest: Writes; value?: bigint; bounce?: boolean; extra?: Cell; flags?: number; init?: Cell; inline?: boolean; body: Cell; tail?: boolean }) => {
      const b = beginCell().storeBit(0).storeBit(1).storeBit(k.bounce ?? false).storeBit(0);
      k.dest((k.src ?? none)(b)).storeCoins(k.value ?? 0n).storeMaybeRef(k.extra ?? null).storeCoins(k.flags ?? 0).storeCoins(0).storeUint(0, 64).storeUint(0, 32);
      if (k.init === undefined) b.storeBit(0);
      else if (k.inline === true) b.storeBit(1).storeBit(0).storeSlice(k.init.beginParse());
      else b.storeBit(1).storeBit(1).storeRef(k.init);
      b.storeBit(1).storeRef(k.body);
      return (k.tail === true ? b.storeBit(1) : b).endCell();
    };
    const root = (k: Partial<Parameters<typeof message>[0]>) => message({ dest: std(wallet), body: request, ...k });
    const out = (k: Partial<Parameters<typeof message>[0]>) =>
      replaced(settlement, [0, 0, 1], message({ dest: std(jetton), value: BigInt(V.fixed.attachNanotons), bounce: true, body: transfer, ...k }));
    // A HashmapE 32 (VarUInteger 32) root of one leaf: key 1, value 5.
    const currency = beginCell().storeUint(0b10, 2).storeUint(32, 6).storeUint(1, 32).storeUint(1, 5).storeUint(5, 8).endCell();
    const at = (wc: number, raw: string) => `${wc}:${raw.slice(raw.indexOf(":") + 1)}`;
    const bound = async (c: Cell) => exactTvm.bound(payment(c.toBoc({ idx: false, crc32: true }).toString("base64")));
    const sends: [string, Cell, { wallet: string; jettonWallet: string }][] = [
      ["V2's settlement, written here", root({}), { wallet, jettonWallet: jetton }],
      ["the settlement's src, an addr_std on workchain 0 (TON sends it when that account relays it)", root({ src: std(other) }), { wallet, jettonWallet: jetton }],
      ["the settlement's dest, an addr_var of 256 bits on workchain 0", root({ dest: addrVar(wallet) }), { wallet, jettonWallet: jetton }],
      ["the settlement's dest on the masterchain", root({ dest: std(at(-1, wallet)) }), { wallet: at(-1, wallet), jettonWallet: jetton }],
      ["the settlement's extra_flags of 3", root({ flags: 3 }), { wallet, jettonWallet: jetton }],
      ["the outgoing src, the W5 wallet's own addr_std", out({ src: std(wallet) }), { wallet, jettonWallet: jetton }],
      ["the outgoing dest, an addr_var of 256 bits on workchain 0", out({ dest: addrVar(jetton) }), { wallet, jettonWallet: jetton }],
    ];
    for (const [name, c, keys] of sends) {
      expect([name, await bound(c)]).toEqual([name, H]);
      const ref = await exactTvm.reference(payment(c.toBoc({ idx: false, crc32: true }).toString("base64")));
      expect([name, ref]).toEqual([name, { ...V.V3.expectReference, ...keys, requestBodyHash: (ref as TvmRef).requestBodyHash }]);
    }
    const malformed = { refused: true, code: "tvm/boc-malformed" };
    const notTransfer = { refused: true, code: "tvm/not-jetton-transfer" };
    const refused: [string, Cell, unknown][] = [
      ["the settlement's src, an addr_extern (35)", root({ src: extern }), malformed],
      ["the settlement's src, an addr_var (35)", root({ src: addrVar(other) }), malformed],
      ["the settlement's src, an addr_std with anycast (35)", root({ src: std(other, true) }), malformed],
      ["the settlement's src, an addr_std on workchain 1 (35)", root({ src: std(at(1, other)) }), malformed],
      ["the settlement's dest, an addr_var of 256 bits with anycast (36)", root({ dest: addrVar(wallet, 256, true) }), malformed],
      ["the settlement's dest, an addr_var of 255 bits (36)", root({ dest: addrVar(wallet, 255) }), malformed],
      ["the settlement's dest, an addr_var of 256 bits on workchain 128 (36)", root({ dest: addrVar(at(128, wallet)) }), malformed],
      ["the settlement's dest, an addr_std on workchain 1 (36)", root({ dest: std(at(1, wallet)) }), malformed],
      ["the settlement's dest, an addr_std with anycast (36)", root({ dest: std(wallet, true) }), malformed],
      ["the settlement's extra currencies, one entry (44)", root({ extra: currency }), malformed],
      ["the settlement's extra_flags of 4 (45)", root({ flags: 4 }), malformed],
      ["the settlement's body reference, then one bit (TL-B)", root({ tail: true }), malformed],
      ["the outgoing src, another account's addr_std (35)", out({ src: std(other) }), notTransfer],
      ["the outgoing src, the W5 wallet's address as an addr_var (35)", out({ src: addrVar(wallet) }), notTransfer],
      ["the outgoing dest, an addr_std with anycast (36)", out({ dest: std(jetton, true) }), notTransfer],
      ["the outgoing dest, an addr_std on workchain 1 (36)", out({ dest: std(at(1, jetton)) }), notTransfer],
      ["the outgoing dest, an addr_var of 264 bits (36)", out({ dest: addrVar(jetton, 264) }), notTransfer],
      ["the outgoing extra currencies, one entry (44)", out({ extra: currency }), notTransfer],
      ["the outgoing extra_flags of 4 (45)", out({ flags: 4 }), notTransfer],
      ["the outgoing body reference, then one bit (TL-B)", out({ tail: true }), notTransfer],
    ];
    for (const [name, c, want] of rowsOf(refused, "the message forms TON's action phase refuses to send", { exact: 20 })) {
      expect([name, await bound(c)]).toEqual([name, want]);
      expect([name, tvmCarrier(c.toBoc({ idx: false, crc32: true }).toString("base64"))]).toEqual([name, want]);
    }
  });

  // TON validates a sent message's state init as one StateInitWithLibs within 1,024 cell reads
  // (block::tlb::validate_message_relaxed_libs), and a dictionary edge's label is at most its key's bits (TL-B's
  // `hm_edge {n = (~m) + l}`), for every dictionary the message holds; it refuses a message whose init and body nest
  // Merkle proofs or updates three deep (max_allowed_merkle_depth, transaction.cpp:2894, result 40). Each placement:
  // the settlement's init by reference and inline, the outgoing message's init, the extra currencies, and a
  // custom_payload. The emulator refuses each to send (result 34, or 40 for Merkle depth), and sends the 9-level
  // dictionary and two Merkle levels.
  it("a message's state init, dictionaries and Merkle depth are read as TON validates them, on both messages", async () => {
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const v2b = Cell.fromBase64(V.V2b.stateInit);
    const { code, data } = loadStateInit(v2b.beginParse());
    const withLibraries = (dict: Cell) => beginCell().storeBit(0).storeBit(0).storeMaybeRef(code).storeMaybeRef(data).storeMaybeRef(dict).endCell();
    const width = (n: number) => Math.ceil(Math.log2(n + 1));
    const shared = (forks: number) => {
      let node = beginCell().storeUint(0b10, 2).storeBit(0).storeRef(code!).endCell();
      for (let n = 1; n < forks; n++) node = beginCell().storeUint(0b10, 2).storeUint(0, width(n)).storeRef(node).storeRef(node).endCell();
      return beginCell().storeUint(0b11, 2).storeBit(0).storeUint(256 - forks, width(256)).storeRef(node).storeRef(node).endCell();
    };
    const library = libraryOf([]);
    // A fork whose hml_long label, of `l` bits, is longer than its key of `n` bits, over two library cells: @ton/core
    // reads past it, and TON's TL-B refuses it.
    const longLabel = (n: number, l: number) => {
      const b = beginCell().storeUint(0b10, 2).storeUint(l, width(n));
      for (let i = 0; i < l; i++) b.storeBit(0);
      return b.storeRef(library).storeRef(library).endCell();
    };
    // An hml_same leaf of `n` bits holding a SimpleLib, and a fork of label 0 (hml_short) over two edges.
    const libLeaf = (n: number) => beginCell().storeUint(0b11, 2).storeBit(1).storeUint(n, width(n)).storeBit(1).storeRef(leaf).endCell();
    const fork = (a: Cell, b: Cell) => beginCell().storeUint(0, 2).storeRef(a).storeRef(b).endCell();
    const rootWith = (edit: (b: Builder) => Builder) => {
      const s = settlement.beginParse();
      // V2's settlement ends with its init's `nothing$0` and its body's `right$1`.
      const b = beginCell().storeBits(s.loadBits(s.remainingBits - 2));
      return edit(b).endCell();
    };
    const request = settlement.refs[0]!;
    const initRef = (init: Cell) => rootWith((b) => b.storeBit(1).storeBit(1).storeRef(init).storeBit(1).storeRef(request));
    const initInline = (init: Cell) => rootWith((b) => b.storeBit(1).storeBit(0).storeSlice(init.beginParse()).storeBit(1).storeRef(request));
    const outInit = (init: Cell) => {
      const out = cellAt(settlement, [0, 0, 1]);
      const s = out.beginParse();
      const b = beginCell().storeBits(s.loadBits(s.remainingBits - 2));
      return replaced(settlement, [0, 0, 1], b.storeBit(1).storeBit(1).storeRef(init).storeBit(1).storeRef(out.refs[0]!).endCell());
    };
    const extraCurrencies = (dict: Cell) => {
      const s = settlement.beginParse();
      const head = s.loadBits(4 + 2 + 267);
      s.loadCoins();
      s.loadBit();
      return beginCell().storeBits(head).storeCoins(0).storeBit(1).storeRef(dict).storeBits(s.loadBits(s.remainingBits)).storeRef(request).endCell();
    };
    const outExtra = (dict: Cell) => {
      const out = cellAt(settlement, [0, 0, 1]);
      const s = out.beginParse();
      const head = s.loadBits(4 + 2 + 267);
      const value = s.loadCoins();
      s.loadBit();
      const rebuilt = beginCell().storeBits(head).storeCoins(value).storeBit(1).storeRef(dict).storeBits(s.loadBits(s.remainingBits)).storeRef(out.refs[0]!);
      return replaced(settlement, [0, 0, 1], rebuilt.endCell());
    };
    const proven = (n: number) => provenOf(leaf, n);
    const malformed = { refused: true, code: "tvm/boc-malformed" };
    const notTransfer = { refused: true, code: "tvm/not-jetton-transfer" };
    const read = async (c: Cell) => {
      const p = payment(c.toBoc({ idx: false, crc32: true }).toString("base64"));
      return [await exactTvm.bound(p), await exactTvm.reference(p)];
    };
    for (const [name, c] of [
      ["9 levels of shared forks, by reference", initRef(withLibraries(shared(9)))],
      ["9 levels of shared forks, inline", initInline(withLibraries(shared(9)))],
      ["two Merkle levels in a custom_payload", paying(settlement, [0, 0, 1, 0], proven(2))],
    ] as const) {
      expect([name, (await read(c))[0]]).toEqual([name, H]);
    }
    for (const [name, c, want] of rowsOf(
      [
        ["10 levels of shared forks, by reference", initRef(withLibraries(shared(10))), malformed],
        ["10 levels of shared forks, inline", initInline(withLibraries(shared(10))), malformed],
        ["10 levels of shared forks, the outgoing init", outInit(withLibraries(shared(10))), notTransfer],
        ["a libraries label of 257 bits at key length 256", initRef(withLibraries(longLabel(256, 257))), malformed],
        ["a libraries label of 257 bits at key length 256, inline", initInline(withLibraries(longLabel(256, 257))), malformed],
        ["a libraries label of 255 bits at key length 254", initRef(withLibraries(fork(fork(longLabel(254, 255), libLeaf(254)), libLeaf(255)))), malformed],
        ["a libraries label of 257 bits, the outgoing init", outInit(withLibraries(longLabel(256, 257))), notTransfer],
        ["an extra-currency label of 40 bits at key length 32", extraCurrencies(longLabel(32, 40)), malformed],
        ["an extra-currency label of 40 bits at key length 32, the outgoing message", outExtra(longLabel(32, 40)), notTransfer],
        ["a libraries label of 255 bits at key length 254, a right grandchild", initRef(withLibraries(fork(libLeaf(255), fork(libLeaf(254), longLabel(254, 255))))), malformed],
        ["three Merkle levels in a custom_payload", paying(settlement, [0, 0, 1, 0], proven(3)), malformed],
        ["three Merkle levels in the settlement's init code", initRef(beginCell().storeBit(0).storeBit(0).storeMaybeRef(proven(3)).storeMaybeRef(data).storeBit(0).endCell()), malformed],
        ["three Merkle levels in the outgoing init code", outInit(beginCell().storeBit(0).storeBit(0).storeMaybeRef(proven(3)).storeBit(0).storeBit(0).endCell()), malformed],
      ] as const,
      "the state inits, dictionaries and Merkle depths TON refuses to send",
      { exact: 13 },
    )) {
      expect([name, await read(c)]).toEqual([name, [want, want]]);
    }
    for (const [name, levels, builds] of [
      ["two Merkle levels", 2, true],
      ["three Merkle levels", 3, false],
    ] as const) {
      const given = beginCell().storeBit(0).storeBit(0).storeMaybeRef(proven(levels)).storeMaybeRef(data).storeBit(0).endCell();
      const built = await exactTvm.build({ ...choice(), stateInit: given }, H);
      expect([name, "refused" in built ? built : "built"]).toEqual([name, builds ? "built" : { refused: true, code: "x402/option-malformed" }]);
    }
  });

  // As deep as the BoC's 32-level bound admits at each placement (30 levels inline, 29 by reference, 26 in the outgoing
  // message, over a library root of depth 0): TON's validation stops at its 1,024th read, and so does this read, for a
  // dictionary @ton/core's parseDict would walk on each of its 2^levels paths. No time bound is set here.
  it("a state init of shared forks as deep as the BoC's bounds admit is refused on both messages", async () => {
    const settlement = Cell.fromBase64((await signed()).payload.settlementBoc);
    const width = (n: number) => Math.ceil(Math.log2(n + 1));
    const init = (forks: number) => {
      let node = beginCell().storeUint(0b10, 2).storeBit(0).storeRef(leaf).endCell();
      for (let n = 1; n < forks; n++) node = beginCell().storeUint(0b10, 2).storeUint(0, width(n)).storeRef(node).storeRef(node).endCell();
      const dict = beginCell().storeUint(0b11, 2).storeBit(0).storeUint(256 - forks, width(256)).storeRef(node).storeRef(node).endCell();
      return beginCell().storeBit(0).storeBit(0).storeBit(0).storeBit(0).storeMaybeRef(dict).endCell();
    };
    const s = settlement.beginParse();
    const head = s.loadBits(s.remainingBits - 2);
    const request = settlement.refs[0]!;
    const out = cellAt(settlement, [0, 0, 1]);
    const o = out.beginParse();
    const outHead = o.loadBits(o.remainingBits - 2);
    for (const [name, c, code] of [
      ["the settlement's init, inline, 30 levels", beginCell().storeBits(head).storeBit(1).storeBit(0).storeSlice(init(30).beginParse()).storeBit(1).storeRef(request).endCell(), "tvm/boc-malformed"],
      ["the settlement's init, by reference, 29 levels", beginCell().storeBits(head).storeBit(1).storeBit(1).storeRef(init(29)).storeBit(1).storeRef(request).endCell(), "tvm/boc-malformed"],
      [
        "the outgoing init, 26 levels",
        replaced(settlement, [0, 0, 1], beginCell().storeBits(outHead).storeBit(1).storeBit(1).storeRef(init(26)).storeBit(1).storeRef(out.refs[0]!).endCell()),
        "tvm/not-jetton-transfer",
      ],
    ] as const) {
      expect([name, c.depth()]).toEqual([name, 32]);
      const p = payment(c.toBoc({ idx: false, crc32: true }).toString("base64"));
      expect([name, await exactTvm.bound(p), await exactTvm.reference(p)]).toEqual([name, { refused: true, code }, { refused: true, code }]);
    }
    expect(await exactTvm.build({ ...choice(), stateInit: init(30) }, H)).toEqual({ refused: true, code: "x402/option-malformed" });
  });

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

  // The payer Jetton wallet runs a TEP-74 transfer on the internal message that carries it, whose body is the transfer
  // (TEP-74, "transfer"). A transaction with no inbound message body is not that transfer, and a later read of it gives
  // the same answer: recover refuses it as it refuses a body that is not a Jetton transfer.
  it("V4: recover refuses a transaction with no inbound body tvm/not-jetton-transfer", async () => {
    const landed = V.V4.recover[0];
    const reader = (inBody: Uint8Array | null): TvmReader => ({
      ...readerFor(landed),
      byHash: async (h) => ({ hash: h, account: V.fixed.jettonWallet, aborted: false, finality: 2, outMsgs: [], inBody }),
    });
    const ref = { network: REF.network, transaction: landed.transaction };
    expect(await exactTvm.recover(ref, reader(Uint8Array.from(Buffer.from(landed.inBodyHex, "hex"))))).toBe(landed.expect);
    expect(await exactTvm.recover(ref, reader(null))).toEqual({ refused: true, code: "tvm/not-jetton-transfer" });
  });

  // TonTx's inBody is the inbound message body as a bag of cells, which TON's serialization opens with the magic
  // b5ee9c72 and a root (TL-B serialized_boc). Bytes that are not one are an answer out of the reader's documented form,
  // which recover refuses tvm/unreadable, a read to repeat, as it refuses a transaction that is not well formed.
  it("V4: recover refuses an inbound body that is not a bag of cells tvm/unreadable", async () => {
    const landed = V.V4.recover[0];
    const reader = (inBody: Uint8Array): TvmReader => ({
      ...readerFor(landed),
      byHash: async (h) => ({ hash: h, account: V.fixed.jettonWallet, aborted: false, finality: 2, outMsgs: [], inBody }),
    });
    const ref = { network: REF.network, transaction: landed.transaction };
    const boc = Buffer.from(landed.inBodyHex, "hex");
    expect(boc.subarray(0, 4).toString("hex")).toBe("b5ee9c72");
    const notBoc = [
      new Uint8Array(0),
      Uint8Array.of(1, 2, 3),
      Uint8Array.from(boc.subarray(0, boc.length - 1)),
      Uint8Array.from([0, ...boc.subarray(1)]),
    ];
    for (const inBody of rowsOf(notBoc, "inbound bodies that are not a bag of cells", { exact: 4 })) {
      expect([inBody.length, await exactTvm.recover(ref, reader(inBody))]).toEqual([
        inBody.length,
        { refused: true, code: "tvm/unreadable" },
      ]);
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
  // jettonWallet (`x402/option-malformed`), and status's reference (pending `unreadable`, with nothing read). build's
  // wallet and jettonWallet are also held to the workchains TON's configuration holds, -1 and 0, which build: -128 and
  // 127 fit int8 and are refused there, since TON's action phase sends to no workchain its configuration lacks.
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
      for (const field of ["wallet", "jettonWallet"] as const) {
        const built = await exactTvm.build({ ...choice(), [field]: `${wc}:${hex(V.fixed[field])}` }, H);
        expect([wc, field, built]).toEqual([wc, field, { refused: true, code: "x402/option-malformed" }]);
      }
    }
    for (const wc of ["-1", "0"]) {
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
