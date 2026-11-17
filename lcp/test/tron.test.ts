// Runs the Tron pairing's vector file through the tron entry point. Every expected value is the file's, taken from
// a live mainnet transaction, coincurve 21.0.0, base58 2.1.1, pycryptodome 3.23.0 and
// hashlib.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
import {
  TRANSFER_TOPIC,
  decodeTronTx,
  encodeTronRaw,
  exactTronMemo,
  tronAddress,
  tronCarrier,
  type TronInfo,
  type TronReader,
  type TronRef,
} from "../src/tron.js";
import { hash, type AtrHash } from "../src/core.js";
import { pairingOf } from "../src/index.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tron-lcp-trc20-memo.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const txOf = (rawHex: string, sigHex: string) => {
  const raw = bytes(rawHex);
  const len: number[] = [];
  let n = raw.length;
  while (n >= 0x80) {
    len.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  len.push(n);
  return hex(Uint8Array.from([0x0a, ...len, ...raw, 0x12, 0x41, ...bytes(sigHex)]));
};
const payment = (transaction: string) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { transaction },
});
const choice = () => ({
  required,
  accepted: O,
  payer: V.fixed.payer as string,
  refBlock: { number: BigInt(V.fixed.refBlock.number), id: V.fixed.refBlock.id },
  now: BigInt(V.fixed.now),
  feeLimit: BigInt(V.fixed.feeLimit),
});

type NotFound = { notFound: true; timestamp: bigint };
type Answer =
  | { blockNumber: string; result: string; logs: TronInfo["logs"] }
  | { notFound: true; timestamp: string }
  | null
  | "reader-error";
/** A reader answering the row's fixtures; null, an answer status does not read, is passed through as given. */
function readerFor(a: {
  solid?: Answer;
  head?: Answer;
  solidHead?: { number: string; timestamp: string } | null;
  rawDataHex?: string | null;
  archival?: boolean;
  blockAt?: "lags" | "gap";
}): TronReader {
  // Blocks are constructed: each named by its number, the 8 bytes java-tron's blockID begins with, and the bytes ab
  // after it, linked to the one before it, holding no transaction.
  const top = a.solidHead === null || a.solidHead === undefined ? 0n : BigInt(a.solidHead.number);
  const blockOf = (n: bigint) => ({ blockId: blockId(n), number: n, parentHash: blockId(n - 1n), transactions: [] });
  const info = (x: Answer | undefined): TronInfo | NotFound => {
    if (x === "reader-error") throw new ReaderError("transport");
    if (x === null || x === undefined) return null as never;
    if ("notFound" in x) return { notFound: true, timestamp: BigInt(x.timestamp) };
    return { blockNumber: BigInt(x.blockNumber), result: x.result, logs: x.logs };
  };
  return {
    network: V.V4.ref.network,
    info: async (_txid, level) => info(level === "solid" ? a.solid : a.head),
    transaction: async () => {
      if (a.rawDataHex === "reader-error") throw new ReaderError("transport");
      return a.rawDataHex === null || a.rawDataHex === undefined ? null : { rawDataHex: a.rawDataHex };
    },
    now: async () => {
      if (a.solidHead === null || a.solidHead === undefined) throw new ReaderError("transport");
      return { number: BigInt(a.solidHead.number), blockId: blockId(BigInt(a.solidHead.number)), timestamp: BigInt(a.solidHead.timestamp) };
    },
    blocks: async (start, end) => {
      const blocks = [];
      for (let n = start; n < end && n <= top; n++) blocks.push(blockOf(n));
      return { head: top, blocks };
    },
    block: async (n) => {
      if (a.blockAt !== undefined) return { head: a.blockAt === "gap" ? n : n - 1n, block: null };
      return { head: top, block: n <= top ? blockOf(n) : null };
    },
    ...(a.archival === undefined ? {} : { archival: a.archival }),
  };
}
const blockId = (n: bigint): `0x${string}` => `0x${n.toString(16).padStart(16, "0")}${"ab".repeat(24)}`;
/** The block reads of a reader whose node answers {} for every block and names no head. */
const NO_BLOCKS = { blocks: async () => ({ head: null, blocks: [] }), block: async () => ({ head: null, block: null }) };
const REF: TronRef = V.V4.ref;
const Q = { act: "payment", finality: "solidified" } as const;
const SEARCH = { state: "pending", reason: "search-incomplete", foreign: [] };
const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };
const TRANSPORT = { state: "unreadable", reason: "transport", foreign: [] };
/** The recover input for V4's transaction id. */
const INPUT = { network: REF.network, tx: REF.txid, option: O };
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402-exact-tron-lcp-trc20-memo.json", () => {
  it("V1: the live mainnet transaction decodes, re-encodes byte-equal and hashes to its id", async () => {
    const d = decodeTronTx(txOf(V.V1.rawHex, V.V1.signatureForPayload));
    if ("refused" in d) throw new Error(d.code);
    const r = d.raw;
    expect({
      refBlockBytes: hex(r.refBlockBytes),
      refBlockHash: hex(r.refBlockHash),
      expiration: r.expiration.toString(),
      data: hex(r.data),
      owner: hex(r.owner),
      contractAddress: hex(r.contractAddress),
      callData: hex(r.callData),
      timestamp: r.timestamp.toString(),
      feeLimit: r.feeLimit.toString(),
    }).toEqual(V.V1.expectDecoded);
    expect(new TextDecoder().decode(r.data)).toBe(V.V1.expectDataUtf8);
    expect(hex(encodeTronRaw(r))).toBe(V.V1.rawHex);
    expect(await hash(d.rawBytes)).toBe(V.V1.expectTxid);
    expect(await exactTronMemo.bound(payment(txOf(V.V1.rawHex, V.V1.signatureForPayload)))).toEqual(V.V1.expectBound);
  });

  // V2's raw data and transaction are encoded here by hand from TRON's protobuf schema (tronprotocol/protocol 8432beca,
  // core/Tron.proto L336-385 and L431-449, core/contract/smart_contract.proto L74-81), the calldata viem's; the id is
  // node:crypto's SHA-256 of the raw data. build's id and complete's transaction are held to them byte for byte.
  it("V2: build gives the vector's id and complete the vector's 360-byte transaction, byte for byte as TRON's protobuf schema encodes them by hand", async () => {
    const varint = (n: bigint) => {
      const o: number[] = [];
      for (; n >= 0x80n; n >>= 7n) o.push(Number(n & 0x7fn) | 0x80);
      return [...o, Number(n)];
    };
    const int = (no: number, n: bigint) => (n === 0n ? [] : [...varint(BigInt(no << 3)), ...varint(n)]);
    const len = (no: number, b: ArrayLike<number>) =>
      b.length === 0 ? [] : [...varint(BigInt((no << 3) | 2)), ...varint(BigInt(b.length)), ...Array.from(b)];
    const calldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [`0x${V.fixed.payToBytes.slice(2)}` as Hex, BigInt(O.amount)],
    });
    const trigger = [...len(1, bytes(V.fixed.payerBytes)), ...len(2, bytes(V.fixed.assetBytes)), ...len(4, bytes(calldata))];
    const any = [...len(1, new TextEncoder().encode("type.googleapis.com/protocol.TriggerSmartContract")), ...len(2, trigger)];
    const contract = [...int(1, 31n), ...len(2, any)];
    const number = bytes(BigInt(V.fixed.refBlock.number).toString(16).padStart(16, "0"));
    const raw = Uint8Array.from([
      ...len(1, number.subarray(6, 8)),
      ...len(4, bytes(V.fixed.refBlock.id).subarray(8, 16)),
      ...int(8, BigInt(V.fixed.now) + BigInt(O.maxTimeoutSeconds) * 1000n),
      ...len(10, new TextEncoder().encode(`lcp:sha256:${H}`)),
      ...len(11, contract),
      ...int(14, BigInt(V.fixed.now)),
      ...int(18, BigInt(V.fixed.feeLimit)),
    ]);
    expect(hex(raw)).toBe(V.V2.expectRawHex);
    expect("0x" + createHash("sha256").update(raw).digest("hex")).toBe(V.V2.expectTxid);
    const transaction = hex(Uint8Array.from([...len(1, raw), ...len(2, bytes(V.V2.expectSignature))]));
    expect([transaction.length / 2, V.V2.expectTransactionHex, V.V2.expectPayload.payload.transaction]).toEqual([
      360,
      transaction,
      transaction,
    ]);

    const u = await exactTronMemo.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("tron-txid");
    expect("0x" + hex(u.request.txid)).toBe(V.V2.expectTxid);

    const key = bytes(V.fixed.payerKey);
    const recovered = secp256k1.sign(u.request.txid, key, { prehash: false, format: "recovered" });
    const signature = Uint8Array.from([...recovered.subarray(1), recovered[0]!]);
    expect(hex(signature)).toBe(V.V2.expectSignature);
    const pub = secp256k1.recoverPublicKey(recovered, u.request.txid, { prehash: false });
    expect(hex(pub)).toBe(hex(secp256k1.getPublicKey(key)));
    expect(hex((await tronAddress(V.V2.expectRecoversTo)) as Uint8Array)).toBe(V.fixed.payerBytes);

    const paid = u.complete(signature);
    expect(paid).toEqual(V.V2.expectPayload);
    if ("refused" in paid) throw new Error(paid.code);
    expect(paid.payload.transaction).toBe(transaction);
    const d = decodeTronTx(paid.payload.transaction);
    if ("refused" in d) throw new Error(d.code);
    expect(hex(d.rawBytes)).toBe(V.V2.expectRawHex);
    expect(hex(d.raw.refBlockBytes)).toBe(V.V2.expectRefBlockBytes);
    expect(hex(d.raw.refBlockHash)).toBe(V.V2.expectRefBlockHash);
    expect(await tronCarrier(d)).toEqual({ h: H, txid: V.V2.expectTxid });
  });

  it("V3: bound and reference, and each refusal", async () => {
    const p = payment(V.V2.expectTransactionHex);
    expect(await exactTronMemo.bound(p)).toBe(V.V3.expectBound);
    const ref = await exactTronMemo.reference(p, O);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of rowsOf(V.V3.refusals, "x402-exact-tron-lcp-trc20-memo.json V3.refusals")) {
      expect([row.case, await exactTronMemo.bound(payment(row.transaction))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  it("V4: status and recover on reader fixtures", async () => {
    for (const row of rowsOf(V.V4.status, "x402-exact-tron-lcp-trc20-memo.json V4.status")) {
      const after = row.after === undefined ? {} : { after: BigInt(row.after) };
      const got = await exactTronMemo.status(REF, readerFor(row), { ...Q, finality: row.finality ?? "solidified", ...after });
      expect([row.case, plain(got)]).toEqual([row.case, row.expect]);
    }
    for (const row of rowsOf(V.V4.recover, "x402-exact-tron-lcp-trc20-memo.json V4.recover")) {
      const got = await exactTronMemo.recover(INPUT, readerFor(row));
      expect([row.case, got]).toEqual([row.case, row.expect]);
    }
    expect(TRANSFER_TOPIC).toBe(V.fixed.transferTopic);
  });

  // A missing or malformed ref field cannot name the landed transaction, so the read is unreadable, never
  // failed (docs/guides/rails.md, "Reading settlement"). The option names the token in base58check; the log names it by
  // its 20 bytes; reference writes 0x, 41 and those 20 bytes.
  it("V4: a ref whose txid or asset is malformed is unreadable unparseable, with nothing read", async () => {
    const landed = V.V4.status[0];
    const malformed = [
      { txid: undefined }, { txid: REF.txid.slice(2) }, { txid: `0x${REF.txid.slice(4)}` },
      { asset: undefined }, { asset: `0x${REF.asset.slice(4)}` }, { asset: V.fixed.O.asset },
    ];
    for (const change of malformed) {
      const { reader, calls } = counting(readerFor(landed));
      expect(await exactTronMemo.status({ ...REF, ...change } as TronRef, reader, Q)).toEqual(UNPARSEABLE);
      expect(calls).toEqual([]);
    }
    expect(plain(await exactTronMemo.status({ ...REF, asset: REF.asset.slice(2) as never }, readerFor(landed), Q))).toEqual(landed.expect);
    const looked: string[] = [];
    const r = readerFor(landed);
    const upper = { ...REF, txid: `0x${REF.txid.slice(2).toUpperCase()}` as TronRef["txid"] };
    const seen: TronReader = { ...r, info: async (txid, level) => (looked.push(txid), r.info(txid, level)) };
    expect(plain(await exactTronMemo.status(upper, seen, Q))).toEqual(landed.expect);
    expect(looked).toEqual([REF.txid]);
  });

  it("V5: the search for H over constructed blocks", async () => {
    type Receipt = { level: "solid" | "head"; blockNumber: string; result: string; logs: TronInfo["logs"] };
    type Row = {
      case: string; after: string; solid: { number: string; timestamp: string }; head: string;
      blocks?: Record<string, string[]>; receipts?: Record<string, Receipt>; lookup?: Receipt;
      linkBreak?: string; missing?: string; nodeHead?: string; tooLarge?: string;
      search?: { number: string; blockId: `0x${string}` }; expect: unknown;
    };
    const txs: Record<string, string> = V.V5.transactions;
    const idOf = (h: string) => `0x${createHash("sha256").update(bytes(h)).digest("hex")}`;
    for (const row of rowsOf(V.V5.status as Row[], "x402-exact-tron-lcp-trc20-memo.json V5.status")) {
      const solid = BigInt(row.solid.number);
      const top = { solid, head: BigInt(row.head) };
      const block = (n: bigint) => ({
        blockId: blockId(n),
        number: n,
        parentHash: row.linkBreak !== undefined && n === BigInt(row.linkBreak) ? (`0x${"cd".repeat(32)}` as const) : blockId(n - 1n),
        transactions: (row.blocks?.[n.toString()] ?? []).map((name) => txs[name]!),
      });
      const receipts = new Map(Object.entries(row.receipts ?? {}).map(([name, r]) => [idOf(txs[name]!), r]));
      const infoOf = (r: Receipt) => ({ blockNumber: BigInt(r.blockNumber), result: r.result, logs: r.logs });
      const missing = row.missing === undefined ? undefined : BigInt(row.missing);
      const nodeHead = (level: "solid" | "head") => (row.nodeHead === undefined ? top[level] : BigInt(row.nodeHead));
      const reader: TronReader = {
        network: REF.network,
        info: async (txid, level) => {
          if (txid === REF.txid) {
            const l = row.lookup;
            return l !== undefined && (level === "head" || l.level === "solid") ? infoOf(l) : { notFound: true, timestamp: BigInt(row.solid.timestamp) };
          }
          const r = receipts.get(txid);
          return r !== undefined && (level === "head" || r.level === "solid") ? infoOf(r) : { notFound: true, timestamp: BigInt(row.solid.timestamp) };
        },
        transaction: async () => null,
        now: async (level) => ({ number: top[level], blockId: blockId(top[level]), timestamp: BigInt(row.solid.timestamp) }),
        blocks: async (start, end, level) => {
          const out = [];
          for (let n = start; n < end && n <= top[level]; n++) {
            if (row.tooLarge !== undefined && n === BigInt(row.tooLarge)) throw new ReaderError("too-large");
            if (n === missing) break;
            out.push(block(n));
          }
          return { head: nodeHead(level), blocks: out };
        },
        block: async (n, level) => {
          if (row.tooLarge !== undefined && n === BigInt(row.tooLarge)) throw new ReaderError("too-large");
          return { head: nodeHead(level), block: n === missing || n > top[level] ? null : block(n) };
        },
      };
      const search = row.search === undefined ? {} : { search: { number: BigInt(row.search.number), blockId: row.search.blockId } };
      const got = await exactTronMemo.status(REF, reader, { ...Q, after: BigInt(row.after), ...search });
      expect([row.case, plain(got)]).toEqual([row.case, row.expect]);
    }
  });

  it("reference refuses a presented payment whose accepted is not the option it is given", async () => {
    const p = payment(V.V2.expectTransactionHex);
    expect(await exactTronMemo.reference(p, { ...O, amount: "1" })).toEqual({ refused: true, code: "x402/accepted-not-option" });
  });

  it("the lapse is the signed expiration in the presented raw data, not the reference's expiration member", async () => {
    const live = V.V4.status[4];
    expect(live.expect.reason).toBe("instrument-live");
    const after = { after: BigInt(live.after) };
    expect(plain(await exactTronMemo.status({ ...REF, expiration: "0" }, readerFor(live), { ...Q, ...after }))).toEqual(live.expect);
  });

  it("zero: a signed transfer(to, 0) whose receipt holds no Transfer log is a transfer of zero to that call's to", async () => {
    for (const row of rowsOf(V.zero.rows, "x402-exact-tron-lcp-trc20-memo.json zero.rows", { exact: 2 })) {
      const tx = V.zero.transactions[row.raw];
      const ref: TronRef = { ...REF, raw: tx.raw, txid: tx.txid };
      expect([row.case, plain(await exactTronMemo.status(ref, readerFor(row), Q))]).toEqual([row.case, row.expect]);
    }
  });

  it("plant: a Transfer log to another account than payTo is never the settlement", async () => {
    expect(plain(await exactTronMemo.status(REF, readerFor({ solid: V.plant.solid, solidHead: V.plant.solidHead }), Q))).toEqual(V.plant.expect);
  });

  it("status on the act agreement, at a position, and a failed result below the solidified mark", async () => {
    const [solid, head] = V.V4.status;
    const agreement = { act: "agreement", finality: "solidified" } as const;
    expect(plain(await exactTronMemo.status(REF, readerFor(solid), agreement))).toEqual(solid.expect);
    // Found only at the head, the transaction is below the solidified mark.
    const { presented: _h, ...headNamed } = head.expect;
    expect(plain(await exactTronMemo.status(REF, readerFor(head), agreement))).toEqual({ ...headNamed, state: "pending", reason: "below-mark" });
    // The settled transaction at its own block number is at the position given: before-position (read-status rule 16).
    const block = BigInt(solid.expect.position);
    const { presented: _s, ...solidNamed } = solid.expect;
    expect(plain(await exactTronMemo.status(REF, readerFor(solid), { ...Q, after: block }))).toEqual({
      ...solidNamed,
      state: "failed",
      reason: "before-position",
    });
    expect(plain(await exactTronMemo.status(REF, readerFor(solid), { ...Q, after: block - 1n }))).toEqual(solid.expect);
    // A failed result found only at the head: below-mark, naming the transaction (read-status rule 17).
    const reverted = V.V4.status.find((r: { case: string }) => r.case === "solid REVERT");
    const atHead = readerFor({ solid: head.solid, head: reverted.solid, solidHead: head.solidHead });
    expect(plain(await exactTronMemo.status(REF, atHead, Q))).toEqual({
      state: "pending",
      reason: "below-mark",
      transaction: REF.txid,
      position: reverted.solid.blockNumber,
      finality: "head",
      moved: [],
      signer: REF.payer,
      foreign: [],
    });
    expect(await exactTronMemo.recover({ ...INPUT, option: undefined } as never, readerFor(solid))).toEqual({ refused: true, code: "tron/wrong-reader" });
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of rowsOf(V.agreedRefusals.rows, "x402-exact-tron-lcp-trc20-memo.json agreedRefusals.rows")) {
      if (row.option !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactTronMemo.advertise(doc, H, V.fixed.link, row.option)]).toEqual([
          row.case,
          { refused: true, code: row.expect },
        ]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.transaction !== undefined) {
        expect([row.case, await exactTronMemo.bound(payment(row.transaction))]).toEqual([
          row.case,
          { refused: true, code: row.expect },
        ]);
      } else if (row.payer !== undefined) {
        expect(await exactTronMemo.build({ ...choice(), payer: row.payer }, H)).toEqual({ refused: true, code: row.expect });
      } else if (row.feeLimit !== undefined) {
        for (const f of rowsOf(row.feeLimit, "the feeLimit row's fee limits")) {
          expect(await exactTronMemo.build({ ...choice(), feeLimit: BigInt(f) }, H)).toEqual({
            refused: true,
            code: row.expect,
          });
        }
      } else if (row.refBlockId !== undefined) {
        const c = choice();
        expect(await exactTronMemo.build({ ...c, refBlock: { ...c.refBlock, id: row.refBlockId } }, H)).toEqual({
          refused: true,
          code: row.expect,
        });
        expect(await exactTronMemo.build({ ...c, now: 0n }, H)).toEqual({ refused: true, code: row.expect });
      } else if (row.signatureV !== undefined) {
        const u = await exactTronMemo.build(choice(), H);
        if ("refused" in u) throw new Error(u.code);
        const s = bytes(V.V2.expectSignature);
        s[64] = row.signatureV;
        expect(u.complete(s)).toEqual({ refused: true, code: row.expect });
        expect(u.complete(s.subarray(0, 64))).toEqual({ refused: true, code: row.expect });
      } else if (row.case.startsWith("bound with payload.transaction")) {
        const p = { ...payment(""), payload: { transaction: 7 } };
        expect(await exactTronMemo.bound(p)).toEqual({ refused: true, code: row.expect });
      } else if (row.case.startsWith("recover when the reader fails")) {
        const r = readerFor({ rawDataHex: "reader-error" });
        expect(await exactTronMemo.recover(INPUT, r)).toEqual({
          refused: true,
          code: row.expect,
        });
      } else if (row.case.startsWith("recover of raw data")) {
        const r = readerFor({ rawDataHex: V.V1.rawHex });
        expect(await exactTronMemo.recover(INPUT, r)).toEqual({
          refused: true,
          code: row.expect,
        });
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });

  // Tron.proto: Transaction field 1 is raw_data and raw field 10 is data (tag 0x52), both length-delimited. The
  // agreedRefusals row whose data begins with a byte-order mark is V2's transaction written by hand: data EF BB BF (U+FEFF
  // in UTF-8) then H's LCP string, 80 bytes (0x50) in place of 77 (0x4d), so raw_data is 293 bytes (varint a5 02) in place
  // of 290 (a2 02), and V2's signature is kept.
  it("the agreedRefusals row whose data begins with a byte-order mark is V2's transaction with only its data changed", () => {
    const row = V.agreedRefusals.rows.find((r: { case: string }) => r.case.startsWith("data of 80 bytes: a byte-order mark"));
    const lcp = Buffer.from(`lcp:sha256:${H}`, "utf8").toString("hex");
    const v2: string = V.V2.expectTransactionHex;
    expect(v2.startsWith("0aa202")).toBe(true);
    expect(v2.split(`524d${lcp}`).length).toBe(2);
    expect(row.transaction).toBe(`0aa502${v2.slice(6).replace(`524d${lcp}`, `5250efbbbf${lcp}`)}`);
    expect(row.expect).toBe("tron/memo-not-lcp");
  });

  it("the option filter, advertise and read follow x402's document", async () => {
    expect(pairingOf(O)).toBe("x402/exact/tron/lcp-trc20-memo");
    const doc = exactTronMemo.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    const r = exactTronMemo.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: V.fixed.link, options: [O] });
    expect(exactTronMemo.unplaced(O)).toBe(O);
    expect(exactTronMemo.data.coverage).toBe("full");
    expect(exactTronMemo.claims).toBe(true);
    expect(exactTronMemo.data.carrier.member).toBeUndefined();
    // Zero is admitted only for a contract a run has shown to log a transfer of zero; none is shown yet, so the
    // agreement's floor stays one base unit (the profile's rule 9).
    const zero = { ...O, amount: "0" };
    expect(exactTronMemo.advertise({ ...required, accepts: [zero] }, H, V.fixed.link, zero)).toEqual({ refused: true, code: "tron/option-malformed" });
    expect(exactTronMemo.data.agreement?.floor).toBe("1");
  });

  // A java-tron node accepts a transaction only while its expiration is after the head block's time
  // (Manager.validateCommon: `transactionExpiration <= headBlockTime` throws TransactionExpirationException), so a
  // transaction included in a block timed before its expiration can never read as `expired`. The reader below answers
  // from a chain that advances between calls, as a node catching up or a FullNode and a SolidityNode at different
  // heights do; a lookup that finds nothing names the time of the latest block at its level.
  it("the solid head is read before the lookups, so a transaction landing between reads is never expired", async () => {
    const expiration = BigInt(REF.expiration);
    const txBlock = 1000n;
    const blockTime = (n: bigint) => expiration - 3000n + (n - txBlock) * 3000n;
    const found: TronInfo = { blockNumber: txBlock, result: "SUCCESS", logs: V.V4.status[0].solid.logs };
    for (const start of [960n, 990n, 1000n, 1010n, 1019n, 1030n]) {
      for (const step of [0n, 1n, 10n, 40n]) {
        let head = start;
        const calls: string[] = [];
        const reader: TronReader = {
          network: REF.network,
          info: async (_txid, level) => {
            calls.push(`info:${level}`);
            const top = level === "solid" ? head - 19n : head;
            head += step;
            return top >= txBlock ? found : { notFound: true, timestamp: blockTime(top) };
          },
          transaction: async () => null,
          now: async () => {
            calls.push("now");
            const solid = head - 19n;
            head += step;
            return { number: solid, blockId: blockId(solid), timestamp: blockTime(solid) };
          },
          ...NO_BLOCKS,
        };
        const got = await exactTronMemo.status(REF, reader, Q);
        expect(calls[0]).toBe("now");
        expect([start, step, got.state]).not.toEqual([start, step, "failed"]);
      }
    }
  });

  // The same rule read across two nodes: the solid head comes from a node that has seen the block holding the
  // transaction, the lookups from nodes that have not. Each lookup names the latest block time at its level on the
  // node that answered (/walletsolidity/getnowblock, /wallet/getnowblock), so absence is shown only through that time.
  it("a lookup whose node lags the solid head read first is pending, never expired", async () => {
    const expiration = BigInt(REF.expiration);
    const found: TronInfo = { blockNumber: 86542790n, result: "SUCCESS", logs: V.V4.status[0].solid.logs };
    const txTime = expiration - 3000n;
    const ahead = expiration + 9000n;
    for (const solidAt of [expiration - 6000n, txTime - 1n, txTime, ahead]) {
      for (const headAt of [expiration - 6000n, txTime - 1n, txTime, ahead]) {
        const reader: TronReader = {
          network: REF.network,
          now: async () => ({ number: 86542804n, blockId: blockId(86542804n), timestamp: ahead }),
          ...NO_BLOCKS,
          info: async (_txid, level) => {
            const at = level === "solid" ? solidAt : headAt;
            return at >= txTime ? found : { notFound: true, timestamp: at };
          },
          transaction: async () => null,
        };
        const got = await exactTronMemo.status(REF, reader, { ...Q, finality: "head" });
        const want = solidAt >= txTime || headAt >= txTime ? "settled" : "pending";
        expect([solidAt, headAt, got.state]).toEqual([solidAt, headAt, want]);
      }
    }
  });

  it("a failed or malformed solid-head read leaves a found transaction settled and a missing one unreadable", async () => {
    const solid = V.V4.status[0].solid;
    const nowhere = { notFound: true as const, timestamp: "1790300730000" };
    expect(plain(await exactTronMemo.status(REF, readerFor({ solid }), Q))).toEqual(V.V4.status[0].expect);
    const missing = readerFor({ solid: nowhere, head: nowhere });
    const malformed = { ...missing, now: async () => ({ number: 1n, blockId: blockId(1n), timestamp: "1790300730000" }) as never };
    expect(await exactTronMemo.status(REF, malformed, Q)).toEqual(UNPARSEABLE);
    expect(await exactTronMemo.status(REF, missing, Q)).toEqual(TRANSPORT);
  });

  it("a lookup answer of no documented shape is unreadable unparseable, and a not-found naming no time pending", async () => {
    const solidHead = { number: "86542801", timestamp: "1790300730000" };
    expect(await exactTronMemo.status(REF, readerFor({ solid: null, head: null, solidHead }), Q)).toEqual(UNPARSEABLE);
    const unnamed = { ...readerFor({ solidHead }), info: async () => ({ notFound: true }) as never };
    expect(await exactTronMemo.status(REF, unnamed, Q)).toEqual(SEARCH);
  });

  // java-tron's gettransactioninfobyid answers {} for a transaction the node does not know, naming no block time
  // (GetTransactionInfoByIdServlet), so a reader takes the time from a second call, which a load-balanced endpoint can
  // send to another node. A reader that cannot read the time from the node that answered names none.
  it("a lookup naming a null block time is pending, never expired", async () => {
    const head = BigInt(REF.expiration) + 9000n;
    const lookup = (timestamp: bigint | null): TronReader => ({
      network: REF.network,
      now: async () => ({ number: 86542804n, blockId: blockId(86542804n), timestamp: head }),
      ...NO_BLOCKS,
      info: async () => ({ notFound: true, timestamp }),
      transaction: async () => null,
    });
    expect(await exactTronMemo.status(REF, lookup(null), Q)).toEqual(SEARCH);
    // Each lookup at the solid head, past the lapse, with no position given on a node not declared archival: the read
    // shows no history, so absence is history-gap (read-status rule 18).
    expect(await exactTronMemo.status(REF, lookup(head), Q)).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });

  // decodeTronTx reads at most 8192 hex characters, counted in UTF-16 code units (agreedRefusals rows "over 8192 hex
  // characters" and "8191 hex characters and U+10000"); a transaction above that is tron/tx-too-large. recover reads the
  // raw data a reader returns within the same bound, and gives the same code for those rows' text above it: a later read
  // of the same transaction gives the same bytes.
  it("recover refuses raw data over 8192 hex characters as tron/tx-too-large", async () => {
    const tooLarge = { refused: true, code: "tron/tx-too-large" };
    type Row = { case: string; transaction: string; expect: string };
    const rows = rowsOf<Row>(V.agreedRefusals.rows, "x402-exact-tron-lcp-trc20-memo.json agreedRefusals.rows", {
      keep: ["the rows over the size bound", (r) => r.expect === "tron/tx-too-large"],
      leave: ["every other row", (r) => r.expect !== "tron/tx-too-large"],
      exact: 2,
    });
    for (const row of rows) {
      expect([row.case, decodeTronTx(row.transaction)]).toEqual([row.case, tooLarge]);
      const r = readerFor({ rawDataHex: row.transaction });
      expect([row.case, await exactTronMemo.recover(INPUT, r)]).toEqual([row.case, tooLarge]);
    }
  });

  it("a network mismatch is chain-mismatch for status and wrong-reader for recover", async () => {
    const r = { ...readerFor({}), network: "tron:3448148188" as const };
    expect(await exactTronMemo.status(REF, r, Q)).toEqual({ state: "unreadable", reason: "chain-mismatch", foreign: [] });
    expect(await exactTronMemo.recover(INPUT, r)).toEqual({
      refused: true,
      code: "tron/wrong-reader",
    });
  });
});
