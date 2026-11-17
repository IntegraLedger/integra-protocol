// Runs vectors/x402-exact-ccd.json through the ccd entry point. Every expected value is the file's (D1 to D5, each
// naming its source there); D1, D2 and the accounts are also re-derived with cborg and bs58check.
import { readFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cborg from "cborg";
import bs58check from "bs58check";
import type { AtrHash, Refusal } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import { LEGAL_CONTEXT_SCHEMA, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import {
  accountBytes,
  ccdMemo,
  exactCcd,
  memoCarrier,
  pltMemo,
  type CcdItem,
  type CcdReader,
  type CcdUnsigned,
} from "../src/ccd.js";
import { signedDigest } from "../src/internal/ccd.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-ccd.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
/** The payment `complete` returns. */
type Payment = Exclude<ReturnType<CcdUnsigned["complete"]>, Refusal>;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const required = (o: PaymentRequirements = O): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
/** recover's input: the network, D5's block item hash and the option the payment answers. */
const recoverInput = { network: V.D5.ref.network, tx: V.D5.transaction, option: O };

function pathValue(base: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((at, k) => (at as Record<string, unknown>)[k], base);
}

function set(base: unknown, changes: Record<string, unknown>): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    at[keys[keys.length - 1]!] = value;
  }
  return copy;
}

type FixtureTransfer = { kind: "ccd" | "plt"; tokenId?: string; receiver: string; amount: string; decimals?: number; memo: string | null };
type FixtureOutcome = { success: boolean; transfers: FixtureTransfer[]; unknown?: boolean };
type FixtureItem = null | "reader-error" | { state: "received" } | ({
  state: "committed" | "finalized"; sender: string | null; height?: string; nonce?: string;
} & FixtureOutcome);
const transfersOf = (ts: FixtureTransfer[]) =>
  ts.map((t) => ({
    kind: t.kind,
    ...(t.tokenId !== undefined ? { tokenId: t.tokenId } : {}),
    receiver: bytes(t.receiver),
    amount: BigInt(t.amount),
    ...(t.decimals !== undefined ? { decimals: t.decimals } : {}),
    memo: t.memo === null ? null : bytes(t.memo),
  }));
function itemOf(f: Exclude<FixtureItem, null | "reader-error">): CcdItem {
  if (f.state === "received") return { state: "received" };
  return {
    state: f.state,
    success: f.success,
    sender: f.sender === null ? null : bytes(f.sender),
    transfers: transfersOf(f.transfers),
    ...(f.unknown === undefined ? {} : { unknown: f.unknown }),
    ...(f.height === undefined ? {} : { height: BigInt(f.height) }),
    ...(f.nonce === undefined ? {} : { nonce: BigInt(f.nonce) }),
  };
}
/** A reader of one item by its hash, for recover, which reads nothing else. */
function readerFor(f: FixtureItem, network: string = V.D5.reader.network): CcdReader {
  const none = async (): Promise<never> => {
    throw new Error("recover reads the item by its hash alone");
  };
  return {
    network: network as CcdReader["network"],
    lastFinal: none,
    block: none,
    nextNonce: none,
    items: none,
    async item(): Promise<CcdItem | null> {
      if (f === "reader-error") throw new ReaderError("transport");
      return f === null ? null : itemOf(f);
    },
  };
}

/** One of the sender's items on D5's constructed node. */
type NodeItem = {
  hash: string; height: string; nonce: string; sender?: string; expiry?: string; energy?: string; sponsor?: string | null;
  payload?: string; outcome?: FixtureOutcome; undecoded?: true; hidden?: true;
};
type Node = {
  final: string; slot: string; first: string; created?: string; missing?: string[]; items: NodeItem[]; others?: string;
  hint?: Exclude<FixtureItem, null | "reader-error" | { state: "received" }> & { hash: string };
};
/**
 * The reader of D5's constructed node, as its `about` states it: its numbers are the sender's, `sender`, and any other
 * account's next number is `others` at every height, or none. Each account the read asks is pushed to `asked`.
 */
function nodeReader(n: Node, network: string = V.D5.reader.network, sender: string = V.D5.ref.sender, asked: string[] = []): CcdReader {
  const final = BigInt(n.final);
  const missing = new Set(n.missing ?? []);
  const held = (h: bigint) => h >= 0n && h <= final && !missing.has(h.toString());
  return {
    network: network as CcdReader["network"],
    lastFinal: async () => final,
    block: async (h) => (held(h) ? { slotTime: h === final ? BigInt(n.slot) : 0n } : null),
    nextNonce: async (account, at) => {
      asked.push(account);
      if (account !== sender) return n.others === undefined ? null : BigInt(n.others);
      if (at !== "best" && !held(at)) return null;
      if (at !== "best" && n.created !== undefined && at < BigInt(n.created)) return null;
      const used = n.items.filter((i) => at === "best" || BigInt(i.height) <= at).map((i) => BigInt(i.nonce));
      return used.length === 0 ? BigInt(n.first) : used.reduce((a, b) => (a > b ? a : b)) + 1n;
    },
    items: async (h) =>
      n.items
        .filter((i) => BigInt(i.height) === h && i.hidden !== true)
        .map((i) =>
          i.undecoded === true
            ? { hash: i.hash, undecoded: true as const }
            : {
                hash: i.hash,
                sender: bytes(i.sender!),
                nonce: BigInt(i.nonce),
                expiry: BigInt(i.expiry!),
                energy: BigInt(i.energy!),
                sponsor: i.sponsor === null || i.sponsor === undefined ? null : bytes(i.sponsor),
                payload: bytes(i.payload!),
              },
        ),
    item: async (hash) => {
      if (n.hint !== undefined && n.hint.hash === hash) return itemOf(n.hint);
      const i = n.items.find((x) => x.hash === hash && x.outcome !== undefined);
      return i === undefined ? null : itemOf({ state: BigInt(i.height) <= final ? "finalized" : "committed", sender: i.sender!, ...i.outcome! });
    },
  };
}
/** A query in the vector file's spelling, its positions decimal strings, as status takes it. */
function queryOf(q: Record<string, unknown> = {}): never {
  return {
    act: q["act"] ?? "payment",
    finality: "finalized",
    ...(q["after"] === undefined ? {} : { after: BigInt(q["after"] as string) }),
    ...(q["search"] === undefined ? {} : { search: { next: BigInt((q["search"] as { next: string }).next) } }),
    ...(q["others"] === undefined ? {} : { others: q["others"] }),
  } as never;
}
/** An answer with its bigints written as decimal strings, as the vector file writes them. */
const withStrings = (a: unknown): unknown => JSON.parse(JSON.stringify(a, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402/exact/ccd", () => {
  it("the fixed accounts are base58check of version byte 01 and SHA-256 of their labels", async () => {
    for (const who of ["payer", "payee", "sponsor"] as const) {
      const body = createHash("sha256").update(V.fixed[`${who}Label`]).digest();
      expect(bs58check.encode(Uint8Array.from([1, ...body]))).toBe(V.fixed[who]);
      expect(hex(accountBytes(V.fixed[who]) as Uint8Array)).toBe(body.toString("hex"));
    }
    expect(hex(accountBytes(V.fixed.payer) as Uint8Array)).toBe(V.fixed.payerBytes);
  });

  it("D1: ccdMemo and pltMemo", () => {
    expect(hex(ccdMemo(H))).toBe(V.D1.expectCcdMemo);
    expect(hex(cborg.encode(V.D1.lcpString))).toBe(V.D1.expectCcdMemo);
    expect(cborg.decode(bytes(V.D1.expectCcdMemo))).toBe(V.D1.lcpString);
    expect(hex(pltMemo(H))).toBe(V.D1.expectPltMemo);
    expect(memoCarrier(ccdMemo(H))).toBe(H);
  });

  it("D2: the PLT operations fixture decodes as the steward's encoder writes it", () => {
    const ops = bytes(V.D2.operations);
    expect(ops.length).toBe(V.D2.length);
    const tags: cborg.TagDecoder[] = [];
    tags[4] = (decode) => ({ tag: 4, v: decode() });
    tags[24] = (decode) => ({ tag: 24, v: decode() });
    tags[40307] = (decode) => ({ tag: 40307, v: decode() });
    const decoded = cborg.decode(ops, { tags, useMaps: true }) as Map<string, unknown>[];
    const transfer = decoded[0]!.get("transfer") as Map<string, { tag: number; v: unknown }>;
    const e = V.D2.expectDecoded;
    expect(transfer.get("memo")).toEqual({ tag: e.memoTag, v: bytes(e.memo) });
    expect(transfer.get("amount")).toEqual({ tag: e.amountTag, v: e.amount });
    const recipient = transfer.get("recipient")!;
    expect(recipient.tag).toBe(e.recipientTag);
    expect((recipient.v as Map<number, Uint8Array>).get(e.recipientKey)).toEqual(bytes(e.recipient));
  });

  it("D3: the CCD transaction is x402's wire form, whose memo is a 2-byte length (0x004f = 79) and then D1", () => {
    const tx = V.D3.ccd.payment.payload.signedTransaction;
    expect(tx.payload.memo).toBe(`004f${V.D1.expectCcdMemo}`);
    expect(tx.header.sponsor).toEqual({ account: V.fixed.sponsor, numSignatures: 1 });
    expect(Object.keys(tx.header)).toContain("executionEnergyAmount");
  });

  it("D3: bound gives H for a CCD and a PLT transfer", async () => {
    expect(await exactCcd.bound(V.D3.ccd.payment)).toBe(V.D3.ccd.expect);
    expect(await exactCcd.bound(V.D3.plt.payment)).toBe(V.D3.plt.expect);
  });

  // The header the sender signs holds the transaction's whole energy, which no member of x402's wire form holds: the
  // wallet computes it at signing from executionEnergyAmount, the signature counts and the sizes (D3.signedEnergy's
  // source). D3's own sender signatures are the oracle: each verifies over the header with that energy alone.
  describe("D3: the energy the sender signed", () => {
    const E = V.D3.signedEnergy;
    const seed = bytes(E.seed);
    const key = createPublicKey(
      createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" }),
    );
    const u64 = (n: bigint | number) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64BE(BigInt(n));
      return b;
    };
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const account = (a: string) => accountBytes(a) as Uint8Array;
    /** The payload in the protocol's binary form (`concordium-base` `Execution.hs:776-780`, `:829-832`), from the wire form. */
    const payloadOf = (p: Record<string, string>): Buffer =>
      p["type"] === "transferWithMemo"
        ? Buffer.concat([Buffer.from([22]), account(p["toAddress"]!), Buffer.from(p["memo"]!, "hex"), u64(BigInt(p["amount"]!))])
        : Buffer.concat([
            Buffer.from([27, Buffer.byteLength(p["tokenId"]!)]),
            Buffer.from(p["tokenId"]!),
            u32(p["operations"]!.length / 2),
            Buffer.from(p["operations"]!, "hex"),
          ]);
    for (const kind of ["ccd", "plt"] as const) {
      it(`${kind}: the sender's signature verifies over the header energy ${E[kind]}, not over executionEnergyAmount, and reference digests ${E[kind]}`, async () => {
        expect(key.export({ format: "der", type: "spki" }).subarray(12).toString("hex")).toBe(E.publicKey);
        const tx = V.D3[kind].payment.payload.signedTransaction;
        const h = tx.header;
        const payload = payloadOf(tx.payload);
        const signDigest = (energy: bigint) => {
          const header = Buffer.concat([
            Buffer.from([0, 1]), account(h.sender), u64(h.nonce), u64(energy), u32(payload.length), u64(h.expiry), account(h.sponsor.account),
          ]);
          return createHash("sha256").update(Buffer.concat([Buffer.alloc(31), Buffer.from([1]), header, payload])).digest();
        };
        const signature = Buffer.from(tx.signatures.sender["0"]["0"], "hex");
        expect(verify(null, signDigest(BigInt(E[kind])), key, signature)).toBe(true);
        expect(verify(null, signDigest(BigInt(h.executionEnergyAmount)), key, signature)).toBe(false);
        const ref = await exactCcd.reference(V.D3[kind].payment, kind === "ccd" ? O : V.fixed.OPlt);
        const members = { sender: account(h.sender), nonce: BigInt(h.nonce), expiry: BigInt(h.expiry), sponsor: account(h.sponsor.account), payload };
        expect((ref as { signed: string }).signed).toBe(await signedDigest({ ...members, energy: BigInt(E[kind]) }));
        expect((ref as { signed: string }).signed).not.toBe(await signedDigest({ ...members, energy: BigInt(h.executionEnergyAmount) }));
      });
    }

    it("the reference D3's payments give, read where the node holds the item as the sender signed it: settled, presented yes", async () => {
      type Row = { case: string; ref?: string; refSet?: unknown; node: Node; expect: { presented?: string } };
      const rows = rowsOf(V.D5.rows as Row[], "x402-exact-ccd.json D5.rows", {
        exact: 3,
        keep: ["the rows whose item is D3's own payment, presented yes", (r) => r.expect.presented === "yes" && r.refSet === undefined],
        leave: [
          "every other row, whose answer states no presented payment or presented no, or whose ref changes D3's; the D5 tests run them",
          (r) => r.expect.presented !== "yes" || r.refSet !== undefined,
        ],
      });
      for (const row of rows) {
        const plt = row.ref === "refPlt";
        expect(row.node.items[0]!.energy).toBe(E[plt ? "plt" : "ccd"]);
        const ref = await exactCcd.reference(plt ? V.D3.plt.payment : V.D3.ccd.payment, plt ? V.fixed.OPlt : O);
        expect(withStrings(await exactCcd.status(ref as never, nodeReader(row.node), queryOf((row as { query?: Record<string, unknown> }).query)))).toEqual(row.expect);
        expect(ref).toEqual(V.D5[row.ref ?? "ref"]);
      }
    });
  });

  describe("D3: bound's refusals", () => {
    for (const row of rowsOf(V.D3.rows, "x402-exact-ccd.json D3.rows")) {
      it(row.case, async () => {
        const payment = set(V.D3[row.base].payment, row.set);
        expect(await exactCcd.bound(payment)).toEqual(row.expect);
      });
    }
  });

  describe("D3: the wire form only", () => {
    type WireRow = { case: string; base: "ccd" | "plt"; bigints?: string[]; asText?: boolean; expect: unknown };
    const presented = (row: WireRow): Payment => {
      const payment = structuredClone(V.D3[row.base].payment);
      if (row.asText) payment.payload.signedTransaction = JSON.stringify(payment.payload.signedTransaction);
      const changes = Object.fromEntries((row.bigints ?? []).map((path) => [path, BigInt(pathValue(payment, path) as number)]));
      return set(payment, changes) as Payment;
    };
    for (const row of rowsOf(V.D3.wireForm.rows as WireRow[], "x402-exact-ccd.json D3.wireForm.rows")) {
      it(row.case, async () => {
        const payment = presented(row);
        expect(await exactCcd.bound(payment)).toEqual(row.expect);
        expect(await exactCcd.reference(payment, O)).toEqual(row.expect);
      });
    }
    it("complete refuses the SDK's object before serialization", async () => {
      const u = (await exactCcd.build({ required: required(), accepted: O, now: V.fixed.now }, H)) as CcdUnsigned;
      const tx = presented(V.D3.wireForm.rows[0]).payload.signedTransaction;
      expect(u.complete(tx)).toEqual(V.D3.wireForm.rows[0].expect);
    });
  });

  it("D4: reference", async () => {
    expect(await exactCcd.reference(V.D3.ccd.payment, O)).toEqual(V.D4.ccd.expect);
    expect(await exactCcd.reference(V.D3.plt.payment, V.fixed.OPlt)).toEqual(V.D4.plt.expect);
    expect(await exactCcd.reference(V.D3.ccd.payment, {} as PaymentRequirements)).toEqual({ refused: true, code: "x402/option-malformed" });
    // A payment that answers another option than the one given: the CCD payment given the token option.
    expect(await exactCcd.reference(V.D3.ccd.payment, V.fixed.OPlt)).toEqual({ refused: true, code: "x402/accepted-not-option" });
  });

  describe("D4: a receiver, an amount or a header member bound does not read gives H from bound and a refusal from reference", () => {
    type Row = { case: string; base: "ccd" | "plt"; set: Record<string, unknown>; expectBound: string; expectReference: unknown };
    const rows = rowsOf(V.D4.rows as Row[], "x402-exact-ccd.json D4.rows");
    for (const row of rows) {
      it(row.case, async () => {
        const payment = set(V.D3[row.base].payment, row.set);
        expect(await exactCcd.bound(payment)).toBe(row.expectBound);
        expect(await exactCcd.reference(payment, O)).toEqual(row.expectReference);
      });
    }

    it("the rows' inputs, read with bs58check 4.0.0 and cborg 6.1.3", () => {
      expect(rows.map((r) => r.expectBound)).toEqual(rows.map(() => H));
      const value = (r: Row) => Object.values(r.set)[0];
      const address = rows.find((r) => "payload.signedTransaction.payload.toAddress" in r.set)!;
      expect(() => bs58check.decode(value(address) as string)).toThrow();
      expect(rows.map(value)).toContain((1n << 64n).toString());

      const tags: cborg.TagDecoder[] = [];
      for (const t of [4, 5, 24, 40305, 40306, 40307]) tags[t] = (decode) => ({ tag: t, v: decode() });
      const transfer = (ops: string) =>
        (cborg.decode(bytes(ops), { tags, useMaps: true }) as Map<string, Map<string, { tag: number; v: unknown }>>[])[0]!.get("transfer")!;
      const signed = transfer(V.D3.plt.payment.payload.signedTransaction.payload.operations);
      const changed = rowsOf(rows, "x402-exact-ccd.json D4.rows", {
        exact: 2,
        keep: ["the PLT rows, whose changed operations this test decodes", (r) => r.base === "plt"],
        leave: ["the CCD rows, which carry no PLT operations; the bound and reference tests above run every row", (r) => r.base === "ccd"],
      }).map((r) => transfer(value(r) as string));
      expect(changed.map((t) => [t.get("recipient")!.tag, t.get("amount")!.tag])).toEqual([
        [40306, 4],
        [40307, 5],
      ]);
      for (const t of changed) {
        expect(t.get("memo")).toEqual(signed.get("memo"));
        expect(t.get("recipient")!.v).toEqual(signed.get("recipient")!.v);
        expect(t.get("amount")!.v).toEqual(signed.get("amount")!.v);
      }
    });
  });

  describe("D5: status through a constructed node", () => {
    // Each row's read asks the sequence numbers of the reference's sender alone, by its text.
    for (const row of rowsOf(V.D5.rows, "x402-exact-ccd.json D5.rows")) {
      it(row.case, async () => {
        const ref = { ...V.D5[row.ref ?? "ref"], ...(row.refSet ?? {}) };
        const asked: string[] = [];
        expect(withStrings(await exactCcd.status(ref, nodeReader(row.node, undefined, ref.sender, asked), queryOf(row.query)))).toEqual(row.expect);
        expect(asked.filter((a) => a !== ref.sender)).toEqual([]);
      });
    }
    it("a reader for another network", async () => {
      const reader = nodeReader(V.D5.rows[0].node, V.D5.wrongReader.network);
      expect(await exactCcd.status(V.D5.ref, reader, queryOf())).toEqual(V.D5.wrongReader.expectStatus);
      expect(await exactCcd.recover(recoverInput, readerFor(V.D5.recover.rows[0].item, V.D5.wrongReader.network))).toEqual(V.D5.wrongReader.expectRecover);
    });
    it("a reader that rejects reads by the ReaderError's kind, and any other rejection as transport", async () => {
      for (const [error, reason] of [
        [new ReaderError("timeout"), "transport"],
        [new ReaderError("too-large"), "too-large"],
        [new ReaderError("malformed"), "unparseable"],
        [new Error("x"), "transport"],
      ] as const) {
        const reader: CcdReader = { ...nodeReader(V.D5.rows[0].node), lastFinal: async () => { throw error; } };
        expect(await exactCcd.status(V.D5.ref, reader, queryOf())).toEqual({ state: "unreadable", reason, foreign: [] });
      }
    });
    it("an outcome whose PLT transfer gives no decimals, or whose CCD transfer gives some, is unreadable unparseable", async () => {
      const each = (node: Node, kind: "ccd" | "plt", change: (t: Record<string, unknown>) => void): Node => {
        const copy = structuredClone(node);
        const walk = (v: unknown): void => {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v !== null && typeof v === "object") {
            const o = v as Record<string, unknown>;
            if (o["kind"] === kind && "receiver" in o) change(o);
            Object.values(o).forEach(walk);
          }
        };
        walk(copy);
        return copy;
      };
      const plt = V.D5.rows.find((r: { case: string }) => r.case.startsWith("a token transfer carrying H in its memo"));
      const ccd = V.D5.rows[0];
      const unparseable = { state: "unreadable", reason: "unparseable", foreign: [] };
      for (const [row, kind, change] of [
        [plt, "plt", (t: Record<string, unknown>) => delete t["decimals"]],
        [plt, "plt", (t: Record<string, unknown>) => (t["decimals"] = 1.5)],
        [ccd, "ccd", (t: Record<string, unknown>) => (t["decimals"] = 6)],
      ] as const) {
        const ref = { ...V.D5[row.ref ?? "ref"], ...(row.refSet ?? {}) };
        expect(withStrings(await exactCcd.status(ref, nodeReader(row.node, undefined, ref.sender), queryOf(row.query)))).toEqual(row.expect);
        const changed = nodeReader(each(row.node, kind, change), undefined, ref.sender);
        expect(await exactCcd.status(ref, changed, queryOf(row.query))).toEqual(unparseable);
      }
    });
    // A ref not in the form reference writes cannot name the act, so the read is unreadable unparseable, never failed.
    it("a ref whose members are not in the form reference writes is unreadable unparseable, with nothing read", async () => {
      const ref = V.D5.ref;
      const malformed = [
        { h: undefined }, { h: "0x1234" }, { h: ref.h.slice(2) }, { sender: "x" }, { nonce: "0" }, { nonce: "07" }, { nonce: 7 },
        { expiry: -1 }, { expiry: "1790000060" }, { signed: undefined }, { signed: ref.signed.slice(2) }, { transaction: 1 },
        { payee: "x" }, { payee: `${ref.payee.slice(0, -1)}${ref.payee.endsWith("x") ? "y" : "x"}` },
      ];
      for (const change of malformed) {
        const { reader, calls } = counting(nodeReader(V.D5.rows[0].node));
        expect(await exactCcd.status({ ...ref, ...change }, reader, queryOf())).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
        expect(calls).toEqual([]);
      }
    });
  });

  describe("D5: recover", () => {
    for (const row of rowsOf(V.D5.recover.rows, "x402-exact-ccd.json D5.recover.rows")) {
      it(row.case, async () => {
        expect(await exactCcd.recover(recoverInput, readerFor(row.item))).toEqual(row.expect);
      });
    }
    it("recover refuses an input whose tx is not 64 hex digits or whose option is not an object, with nothing read", async () => {
      for (const input of [{ ...recoverInput, tx: "x" }, { ...recoverInput, option: null }, null]) {
        const { reader, calls } = counting(readerFor(V.D5.recover.rows[0].item));
        expect(await exactCcd.recover(input as never, reader)).toEqual({ refused: true, code: "ccd/wrong-reader" });
        expect(calls).toEqual([]);
      }
    });
    // One block item can hold several transfers, as a PLT TokenUpdate holds a list of operations. recover gives H from
    // the one transfer whose memo memoCarrier reads, whatever memos the others hold; more than one such transfer is
    // ccd/no-carrier. The other memo is the CBOR text string "IETF", 64 49 45 54 46 (RFC 8949 Appendix A), wrapped for a
    // PLT in tag 24 around a 5-byte string, d8 18 45 (RFC 8949 §3.4.5.1, §3.1); the second hash is SHA-256 of the empty
    // string (GNU coreutils sha256sum), its memo written by cborg.
    describe("recover reads the one transfer whose memo memoCarrier reads, beside the item's other transfers", () => {
      const H2 = "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const ccdH: FixtureTransfer = V.D5.recover.rows[0].item.transfers[0];
      const pltH: FixtureTransfer = V.D5.recover.rows[1].item.transfers[0];
      const ietf: FixtureTransfer = { kind: "ccd", receiver: V.fixed.payerBytes, amount: "1", memo: "6449455446" };
      const ietfPlt: FixtureTransfer = { ...pltH, receiver: V.fixed.payerBytes, amount: "1", memo: "d818456449455446" };
      const noCarrier = { refused: true, code: "ccd/no-carrier" };
      const cases: [string, FixtureTransfer[], unknown][] = [
        ['the H transfer, then a transfer whose memo is "IETF"', [ccdH, ietf], H],
        ['a transfer whose memo is "IETF", then the H transfer', [ietf, ccdH], H],
        ['a PLT H transfer beside a PLT transfer whose memo is "IETF"', [ietfPlt, pltH], H],
        ["the H transfer beside a transfer without a memo", [ccdH, { ...ietf, memo: null }], H],
        ["the H transfer beside a transfer whose memo carries another hash", [ccdH, { ...ietf, memo: hex(cborg.encode(`lcp:sha256:${H2}`)) }], noCarrier],
        ['one transfer, whose memo is "IETF"', [ietf], noCarrier],
      ];
      for (const [name, transfers, recovered] of cases) {
        it(name, async () => {
          const reader = readerFor({ state: "finalized", success: true, sender: V.fixed.payerBytes, transfers });
          expect(await exactCcd.recover(recoverInput, reader)).toEqual(recovered);
        });
      }
    });
  });

  it("build: the transfer the wallet signs, and complete wraps what it returns", async () => {
    const u = (await exactCcd.build({ required: required(), accepted: O, now: V.fixed.now }, H)) as CcdUnsigned;
    expect(u.request).toEqual({
      kind: "ccd-transfer",
      network: V.fixed.network,
      sponsor: V.fixed.sponsor,
      toAddress: V.fixed.payee,
      asset: "CCD",
      amount: "1000000",
      memo: bytes(V.D1.expectCcdMemo),
      // The stock client signs now plus maxTimeoutSeconds less 5 seconds (@x402/concordium 2.30.0,
      // src/exact/client/scheme.ts:120-129), so that its facilitator takes a payment built at the bound.
      expiresBy: V.fixed.now + O.maxTimeoutSeconds - 5,
    });
    const tx = V.D3.ccd.payment.payload.signedTransaction;
    const payment = u.complete(tx);
    expect(payment).toEqual(V.D3.ccd.payment);
    expect(await exactCcd.bound(payment)).toBe(H);
    const plt = (await exactCcd.build(
      { required: required(V.fixed.OPlt), accepted: V.fixed.OPlt, now: V.fixed.now },
      H,
    )) as CcdUnsigned;
    expect(hex(plt.request.memo)).toBe(V.D1.expectPltMemo);
  });

  // The stock facilitator takes an option at "0" and an asset named CCD in any case (stockOptions' source). The lowercase
  // row holds build to the CCD memo, a transfer with memo, where the token memo would be another payload type.
  describe("stockOptions: the options of rule 3 that the stock facilitator takes", () => {
    type Row = { case: string; option: PaymentRequirements; presentedSet?: Record<string, unknown>; expectRequest: unknown; expectBound: string; expectReference: unknown };
    for (const row of rowsOf(V.stockOptions.rows as Row[], "x402-exact-ccd.json stockOptions.rows", { exact: 2 })) {
      it(row.case, async () => {
        const o = row.option;
        const doc = exactCcd.advertise(required(o), H, V.fixed.link, o);
        expect(exactCcd.read(doc as PaymentRequired)).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [o] } });
        const u = (await exactCcd.build({ required: required(o), accepted: o, now: V.fixed.now }, H)) as CcdUnsigned;
        expect({ ...u.request, memo: hex(u.request.memo) }).toEqual(row.expectRequest);
        const payment = set({ ...V.D3.ccd.payment, accepted: o }, row.presentedSet ?? {});
        expect(await exactCcd.bound(payment)).toBe(row.expectBound);
        expect(await exactCcd.reference(payment, o)).toEqual(row.expectReference);
      });
    }
    it("the lowercase row's memo is the CCD memo, not the token memo", () => {
      const lower = (V.stockOptions.rows as Row[]).find((r) => r.option.asset === "ccd")!;
      expect((lower.expectRequest as { memo: string }).memo).toBe(V.D1.expectCcdMemo);
      expect(V.D1.expectCcdMemo).not.toBe(V.D1.expectPltMemo);
    });
  });

  describe("one reading of the memo: a memo bound refuses is one status never settles, and one bound reads settles", () => {
    const blob = (m: string) => (m.length / 2).toString(16).padStart(4, "0") + m;
    // D5's first row with the memo of its item at the signed number, in its payload and its outcome, replaced.
    const landed = (memo: string): Node => {
      const node: Node = structuredClone(V.D5.rows[0].node);
      const it = node.items[0]!;
      const p = bytes(it.payload!);
      it.payload = hex(p.subarray(0, 33)) + blob(memo) + hex(p.subarray(p.length - 8));
      it.outcome!.transfers[0]!.memo = memo;
      return node;
    };
    const memos: [string, string][] = rowsOf(V.D5.recover.rows, "x402-exact-ccd.json D5.recover.rows", {
      keep: ["the rows whose item's first transfer is a CCD transfer with a memo", (r) => r.item?.transfers?.[0]?.kind === "ccd" && typeof r.item.transfers[0].memo === "string"],
      leave: [
        "the rows with no item, a reader error, no transfer, a token transfer, or no memo on a first transfer; D5's recover tests above run them",
        (r) => r.item === null || r.item === "reader-error" || r.item.transfers?.[0]?.kind !== "ccd" || (r.item.transfers[0]?.memo ?? null) === null,
      ],
    }).map((r: { case: string; item: { transfers: { memo: string | null }[] } }) => [r.case, r.item.transfers[0]?.memo]) as [string, string][];
    for (const [name, memo] of memos) {
      it(name, async () => {
        const payment = set(V.D3.ccd.payment, { "payload.signedTransaction.payload.memo": blob(memo) });
        const b = await exactCcd.bound(payment);
        const s = await exactCcd.status(V.D5.ref, nodeReader(landed(memo)), queryOf({ after: "50" }));
        expect(b === H).toBe(s.state === "settled");
      });
    }
  });

  it("the non-canonical memo rows: cborg 6.1.3's strict decode refuses the non-preferred head, and upper-case or U+FEFF text is not ccdMemo(H)", () => {
    const rows = V.D3.rows.filter((r: { expect: { code: string } }) => r.expect.code === "ccd/memo-not-lcp");
    const memos = rows.map((r: { set: Record<string, string> }) => bytes(r.set["payload.signedTransaction.payload.memo"]!.slice(4)));
    const nonPreferred = memos.find((m: Uint8Array) => hex(m).startsWith("79004d"))!;
    expect(cborg.decode(nonPreferred)).toBe(V.D1.lcpString);
    expect(() => cborg.decode(nonPreferred, { strict: true })).toThrow(/more bytes than necessary/);
    expect(memos.map((m: Uint8Array) => cborg.decode(m))).toContain(`lcp:sha256:0x${H.slice(2).toUpperCase()}`);
    const withBom = memos.find((m: Uint8Array) => hex(m).startsWith("7850efbbbf"))!;
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(withBom.subarray(2))).toBe(`﻿${V.D1.lcpString}`);
  });

  describe("advertise: payTo and extra.feePayer are base58check account addresses (the option filter)", () => {
    const payee: string = V.fixed.payee;
    const broken = payee.slice(0, -1) + (payee.endsWith("x") ? "y" : "x");
    it("the changed payee fails bs58check 4.0.0's checksum and accountBytes", () => {
      expect(() => bs58check.decode(broken)).toThrow();
      expect(accountBytes(broken)).toEqual({ refused: true, code: "ccd/address-malformed" });
    });
    for (const [name, change] of [
      ["payTo", { payTo: broken }],
      ["extra.feePayer", { extra: { feePayer: broken } }],
    ] as const) {
      it(name, () => {
        const o = { ...O, ...change } as PaymentRequirements;
        expect(exactCcd.advertise(required(o), H, V.fixed.link, o)).toMatchObject({ refused: true });
      });
    }
  });

  it("advertise and read: the legal context in extensions.legalContext, accepts untouched", () => {
    const doc = exactCcd.advertise(required(), H, V.fixed.link, O);
    expect(doc).toEqual({
      ...required(),
      extensions: {
        legalContext: { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link }, schema: LEGAL_CONTEXT_SCHEMA },
      },
    });
    expect(exactCcd.read(doc as PaymentRequired)).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [O] } });
  });
});
