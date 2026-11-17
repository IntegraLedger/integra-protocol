// lcp's vectors for x402/exact/tron/lcp-trc20-memo through the Tron module, and through the settler's /supported,
// /verify and /settle over HTTP, against a local FullNode stub that answers in java-tron's HTTP shapes. Every expected answer is the vector's or the profile's: the payer the vector recovers,
// lcp's own refusal of a payload or an option (an x402 `invalid_payload` or `invalid_payment_requirements`), and, for
// the read, the answer the vector states for the node answers it gives, compared as it is. The owner's permission is
// weighed as java-tron weighs it (`TransactionCapsule.checkWeight`): every key that signed is one of the permission's
// keys, and their weights reach its threshold. Keys other than the vectors' published payer key are made here, for
// this run, and hold nothing.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isRefusal, MAX_HEADER_BYTES } from "@integraledger/lcp";
import { decodeTronTx, encodeTronRaw } from "@integraledger/lcp/tron";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorEntry } from "../src/answers.js";
import { X402_REQUEST_MAX_BYTES } from "../src/http.js";
import { serveProfileFacilitator } from "../src/index.js";
import type { Module, X402Payment } from "../src/module.js";
import { createTron, tronModules } from "../src/modules/tron/index.js";
import { fixture, freshDatabase, onLockedPort, post, stub, tronChainReads, V2_PAYER_HEX, V2_REF_BLOCK, type Stub } from "./support.js";

/** The vector file, read as lcp ships it; a plant points this at a changed copy. */
const FILE = new URL("../../lcp/vectors/x402-exact-tron-lcp-trc20-memo.json", import.meta.url);
/** A status row: the node answers it gives, the position and finality it reads at, and the answer it expects. */
interface StatusRow {
  case: string;
  solid?: unknown;
  head?: unknown;
  solidHead?: { number: string; timestamp: string } | null;
  after?: string;
  finality?: string;
  raw?: string;
  expect: unknown;
}
/** The members of the vector file read here. */
interface Vectors {
  fixed: { O: PaymentRequirements; payerKey: string; now: string | number; resource: NonNullable<PaymentPayload["resource"]> };
  V2: { expectTxid: string; expectRawHex: string; expectRecoversTo: string; expectTransactionHex: string };
  V3: { expectReference: { expiration: string }; refusals: { case: string; transaction: string; expect: string }[] };
  V4: { status: (StatusRow & { solid: { blockNumber: string } })[] };
  V5: { transactions: Record<string, string>; status: (StatusRow & Record<string, unknown>)[] };
  plant: StatusRow;
  owner: { rows: StatusRow[] };
  boundAccepted: { rows: { case: string; accepted: PaymentRequirements }[] };
}
const V = JSON.parse(readFileSync(FILE, "utf8")) as Vectors;

const O: PaymentRequirements = V.fixed.O;
const NETWORK = O.network as Network;
const PAYER_KEY: string = V.fixed.payerKey.slice(2);
const TXID: string = V.V2.expectTxid.slice(2);
const RAW: string = V.V2.expectRawHex;

/** A block id whose first eight bytes are its number and the bytes ab after it, as the vectors construct one. */
const blockId = (n: bigint | number) => `${BigInt(n).toString(16).padStart(16, "0")}${"ab".repeat(24)}`;

/** The Tron address (21 bytes, hex) of a secp256k1 secret key. */
function addressOf(secret: Uint8Array): string {
  const key = secp256k1.getPublicKey(secret, false);
  return `41${Buffer.from(keccak_256(key.subarray(1)).subarray(12)).toString("hex")}`;
}

/** r ‖ s ‖ v over the transaction id, v in {0, 1}, as java-tron writes it. */
function sign(rawHex: string, secret: Uint8Array): string {
  const id = createHash("sha256").update(Buffer.from(rawHex, "hex")).digest();
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(id, secret, { prehash: false, format: "recovered" }), "recovered");
  return Buffer.from(sig.toBytes("compact")).toString("hex") + sig.recovery!.toString(16).padStart(2, "0");
}

/** The signed transaction: field 1 the raw data, then each signature as field 2. */
function transaction(rawHex: string, signatures: readonly string[]): string {
  const varint: number[] = [];
  for (let v = rawHex.length / 2; ; v >>>= 7) {
    if (v <= 0x7f) {
      varint.push(v);
      break;
    }
    varint.push((v & 0x7f) | 0x80);
  }
  return `0a${Buffer.from(varint).toString("hex")}${rawHex}` + signatures.map((s) => `1241${s}`).join("");
}

function payment(tx: string, requirements: PaymentRequirements = O): X402Payment {
  const payload: PaymentPayload = { x402Version: 2, resource: V.fixed.resource, accepted: requirements, payload: { transaction: tx } };
  return { payload, requirements };
}

const PAYER_SECRET = Buffer.from(PAYER_KEY, "hex");
const SIGNED = transaction(RAW, [sign(RAW, PAYER_SECRET)]);

/** Every bigint as its decimal string, as the vector file writes them. */
function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)));
}

const entries: OperatorEntry[] = [];
const log = (e: OperatorEntry) => void entries.push(e);
let node: Stub | undefined;
let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let closeSettler: (() => Promise<void>) | undefined;

beforeEach(() => {
  // V2 was signed at the vectors' `now`; the rail reads the clock to hold the expiration to its window, and the
  // settler's record to date its claims.
  vi.spyOn(Date, "now").mockReturnValue(Number(V.fixed.now));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeSettler?.();
  closeSettler = undefined;
  await node?.close();
  node = undefined;
  await db?.drop();
  db = undefined;
  entries.length = 0;
}, 60_000);

async function tronOn(answer: (path: string, body: unknown) => unknown, settleWaitMs = 400): Promise<Module> {
  node = await stub(answer);
  const rail = createTron([{ network: NETWORK as `tron:${number}`, fullNode: node.url, solidityNode: node.url }], settleWaitMs, log);
  return tronModules(rail, log)[0]!;
}

/** The settler, started as an operator starts it, with the Tron module on one node stub and a database of its own. */
async function settlerOn(answer: (path: string, body: unknown) => unknown, settleWaitMs = 3_000): Promise<string> {
  node = await stub(answer);
  db = await freshDatabase();
  const url = db.url;
  const { port, server } = await onLockedPort((p) =>
    serveProfileFacilitator({
      listen: `127.0.0.1:${p}`,
      store: { url },
      settleWaitMs,
      tron: [{ network: NETWORK as `tron:${number}`, fullNode: node!.url, solidityNode: node!.url }],
      operatorLog: log,
    }),
  );
  closeSettler = server.close;
  return `http://127.0.0.1:${port}`;
}

/** The x402 facilitator request for `p`. */
const request = (p: X402Payment) => ({ x402Version: 2, paymentPayload: p.payload, paymentRequirements: p.requirements });

/** The FullNode's answers to `/verify`'s reads, with the owner permission given, and a simulation that succeeds. */
function verifying(permission?: unknown) {
  return (path: string, body: unknown): unknown => {
    if (path === "/wallet/getaccount" && permission !== undefined) return { address: V2_PAYER_HEX, owner_permission: permission };
    if (path === "/wallet/triggerconstantcontract") return { result: { result: true }, constant_result: ["01".padStart(64, "0")] };
    return tronChainReads(path, body) ?? {};
  };
}

describe("lcp's V2 payment through the Tron module", () => {
  it("refuses each of V3's payloads lcp's decoder refuses, as invalid_payload, reading no node", async () => {
    const m = await tronOn(verifying());
    for (const row of V.V3.refusals as { case: string; transaction: string; expect: string }[]) {
      const p = payment(row.transaction);
      expect([row.case, await m.facilitator.verify(p.payload, p.requirements)]).toEqual([row.case, { isValid: false, invalidReason: "invalid_payload" }]);
      expect([row.case, await m.record.instrument(p)]).toEqual([row.case, { refused: "invalid_payload" }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("refuses each option lcp refuses for the vectors' payment, as invalid_payment_requirements, reading no node", async () => {
    const m = await tronOn(verifying());
    const rows = (V.boundAccepted.rows as { case: string; accepted: PaymentRequirements }[]).filter((r) => r.accepted.network === NETWORK);
    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      const p = payment(SIGNED, row.accepted);
      const verdict = await m.facilitator.verify(p.payload, p.requirements);
      expect([row.case, verdict]).toEqual([row.case, { isValid: false, invalidReason: "invalid_payment_requirements" }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("is keyed by the transaction id the vector states, kept until the signed expiration", async () => {
    const m = await tronOn(verifying());
    expect(await m.record.instrument(payment(SIGNED))).toEqual({
      pairing: "x402/exact/tron/lcp-trc20-memo",
      instrument: { by: "transaction", network: NETWORK, transaction: TXID },
      nonce: "single-use",
      keep: { until: "lapse", at: Number(V.V3.expectReference.expiration) },
    });
  });
});

// Rule 5: `/verify` MUST "require signatures that the owner's permission accepts"; lcp decodes one to five.
describe("the owner's permission, by the weights of the keys that signed", () => {
  const k1 = secp256k1.utils.randomSecretKey();
  const k2 = secp256k1.utils.randomSecretKey();
  const [a0, a1, a2] = [V2_PAYER_HEX, addressOf(k1), addressOf(k2)];
  const signed = (...keys: Uint8Array[]) => payment(transaction(RAW, keys.map((k) => sign(RAW, k))));
  const verdict = async (m: Module, p: X402Payment) => m.facilitator.verify(p.payload, p.requirements);
  const refused = { isValid: false, invalidReason: "unsupported_permission", payer: V.V2.expectRecoversTo };
  const valid = { isValid: true, payer: V.V2.expectRecoversTo };

  it("a 2-of-3 owner permission: two of its keys meet its threshold, one alone does not", async () => {
    const m = await tronOn(verifying({ threshold: 2, keys: [{ address: a0, weight: 1 }, { address: a1, weight: 1 }, { address: a2, weight: 1 }] }));
    expect(await verdict(m, signed(PAYER_SECRET, k1))).toEqual(valid);
    expect(await verdict(m, signed(k2))).toEqual(refused);
  });

  it("refuses the owner's own key once the owner permission holds only another key", async () => {
    const m = await tronOn(verifying({ threshold: 1, keys: [{ address: a1, weight: 1 }] }));
    expect(await verdict(m, signed(PAYER_SECRET))).toEqual(refused);
    expect(await verdict(m, signed(k1))).toEqual(valid);
  });

  it("gives an account the node does not hold java-tron's default owner permission: its own key, weight 1, threshold 1", async () => {
    // java-tron answers `/wallet/getaccount` with {} for an account it does not hold (AccountCapsule's
    // createDefaultOwnerPermission is the permission such an account signs under).
    const m = await tronOn((path, body) => (path === "/wallet/getaccount" ? {} : verifying()(path, body)));
    expect(await verdict(m, signed(PAYER_SECRET))).toEqual(valid);
    expect(await verdict(m, signed(k1))).toEqual(refused);
  });

  it("refuses six signatures, as lcp's decoder does, as invalid_payload, reading no node", async () => {
    const m = await tronOn(verifying());
    const six = signed(PAYER_SECRET, k1, k2, PAYER_SECRET, k1, k2);
    expect(await m.facilitator.verify(six.payload, six.requirements)).toEqual({ isValid: false, invalidReason: "invalid_payload" });
    expect(node!.calls).toEqual([]);
  });
});

/**
 * A node whose solidified and head reads give a status row's fixtures, as lcp's own reader fixture gives them: each
 * level's latest block is the row's solidified head, the block before a lookup names the time the row's lookup names,
 * and the blocks from the position on are constructed, linked, holding the row's transactions.
 */
function rowNode(row: {
  solid?: unknown;
  head?: unknown;
  solidHead?: { number: string; timestamp: string } | null;
  blocks?: Record<string, string[]>;
  receipts?: Record<string, { level: string; blockNumber: string; result: string; logs: unknown[] }>;
  headTop?: string;
  linkBreak?: string;
}, txs: Record<string, string> = {}) {
  const top = (level: string) => BigInt(level === "head" && row.headTop !== undefined ? row.headTop : (row.solidHead?.number ?? "0"));
  const nowAt = (level: string, timestamp: string | undefined) => {
    if (row.solidHead === null || row.solidHead === undefined) return undefined;
    const n = top(level);
    return { blockID: blockId(n), block_header: { raw_data: { number: Number(n), timestamp: Number(timestamp ?? row.solidHead.timestamp) } } };
  };
  const idOf = (h: string) => createHash("sha256").update(Buffer.from(h, "hex")).digest("hex");
  const receipts = new Map(Object.entries(row.receipts ?? {}).map(([name, r]) => [idOf(txs[name]!), r]));
  const infoOf = (r: { blockNumber: string; result: string; logs: unknown[] }) => ({
    id: TXID,
    blockNumber: Number(r.blockNumber),
    receipt: { result: r.result },
    log: r.logs,
  });
  const block = (n: bigint) => ({
    blockID: blockId(n),
    block_header: {
      raw_data: { number: Number(n), parentHash: row.linkBreak !== undefined && n === BigInt(row.linkBreak) ? "cd".repeat(32) : blockId(n - 1n) },
    },
    ...((row.blocks?.[n.toString()] ?? []).length === 0 ? {} : { transactions: row.blocks![n.toString()]!.map((name) => ({ raw_data_hex: txs[name] })) }),
  });
  /** The lookup a level's next getnowblock comes before: each lookup reads its level's latest block first. */
  const lookups = { solid: 0, head: 0 };
  return (path: string, body: unknown): unknown => {
    const level = path.startsWith("/walletsolidity") ? "solid" : "head";
    const call = path.slice(path.lastIndexOf("/") + 1);
    const lookup = (level === "solid" ? row.solid : row.head) as Record<string, unknown> | "reader-error" | null | undefined;
    if (call === "getnowblock") {
      // lcp reads the solidified head first; each receipt lookup then reads its level's head, which the row's
      // not-found lookup names.
      const first = level === "solid" && lookups.solid++ === 0;
      const named = !first && typeof lookup === "object" && lookup !== null && "notFound" in lookup ? String(lookup["timestamp"]) : undefined;
      return nowAt(level, named) ?? "not json";
    }
    if (call === "gettransactioninfobyid") {
      const id = (body as { value: string }).value;
      if (id === TXID) {
        if (lookup === "reader-error") return "not json";
        if (lookup === null || lookup === undefined || "notFound" in lookup) return {};
        return infoOf(lookup as never);
      }
      const r = receipts.get(id);
      return r !== undefined && (level === "head" || r.level === "solid") ? infoOf(r) : {};
    }
    if (call === "getblockbylimitnext") {
      const { startNum, endNum } = body as { startNum: number; endNum: number };
      const out = [];
      for (let n = BigInt(startNum); n < BigInt(endNum) && n <= top(level); n++) out.push(block(n));
      return out.length === 0 ? {} : { block: out };
    }
    if (call === "getblockbynum") {
      const n = BigInt((body as { num: number }).num);
      return n <= top(level) ? block(n) : {};
    }
    return {};
  };
}

describe("lcp's read of the payment, through the module's reader over the node", () => {
  type Row = { case: string; solid?: unknown; head?: unknown; solidHead?: { number: string; timestamp: string } | null; after?: string; finality?: string; expect: unknown };

  /** The module's read of V2 for a row, from the position the row gives, as the settler's record gives it back. */
  async function readRow(row: Row & Record<string, unknown>, txs?: Record<string, string>, search?: unknown) {
    const m = await tronOn(rowNode(row as never, txs));
    const from = row.after === undefined ? undefined : { number: BigInt(row.after), blockId: `0x${blockId(BigInt(row.after))}` };
    return m.record.read(payment(SIGNED), {
      deadline: performance.now() + 10_000,
      ...(from === undefined ? {} : { from }),
      ...(search === undefined ? {} : { search }),
    });
  }

  it("answers V4's status rows as the vector states, at the final mark, solidified", async () => {
    // The settler declares its FullNode archival, as it requires one that keeps the whole history, and gives the read
    // its position as a search position: the row that asks about a node not so declared, given no position, and the
    // rows that read the history at a position given, do not arise.
    const undeclared = (r: Row & Record<string, unknown>) => r.archival === undefined && r.after === undefined && (r.expect as { reason?: string }).reason === "history-gap";
    const rows = (V.V4.status as (Row & Record<string, unknown>)[]).filter(
      (r) => (r.finality ?? "solidified") === "solidified" && !undeclared(r) && r.blockAt === undefined,
    );
    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      const read = await readRow(row);
      expect([row.case, plain(read.answer)]).toEqual([row.case, row.expect]);
      expect([row.case, read.outcome]).toEqual([row.case, (row.expect as { state: string }).state === "settled" || (row.expect as { state: string }).state === "failed" ? "final" : "live"]);
      await node!.close();
    }
  });

  it("answers V5's search for H over constructed blocks as the vector states, reading the blocks from the node", async () => {
    type V5Row = Row & { solid: { number: string; timestamp: string }; head: string; blocks?: Record<string, string[]>; receipts?: Record<string, never>; lookup?: unknown; linkBreak?: string; missing?: string; nodeHead?: string; tooLarge?: string; search?: unknown };
    // A row whose node lags at one block, or answers one block over the byte bound, needs a node other than this stub.
    const rows = (V.V5.status as V5Row[]).filter((r) => r.missing === undefined && r.tooLarge === undefined);
    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      const lookup = row.lookup as { level: string } | undefined;
      const absent = { notFound: true, timestamp: row.solid.timestamp };
      const asRow = {
        ...row,
        solid: lookup?.level === "solid" ? lookup : absent,
        head: lookup ?? absent,
        solidHead: row.solid,
        headTop: row.head,
      };
      const search = row.search as { number: string; blockId: string } | undefined;
      const read = await readRow(asRow, V.V5.transactions, search && { number: BigInt(search.number), blockId: search.blockId });
      expect([row.case, plain(read.answer)]).toEqual([row.case, row.expect]);
      await node!.close();
    }
  });

  it("answers the plant and the owner rows on V4's transaction as the vector states", async () => {
    const read = await readRow({ ...V.plant, case: "plant" });
    expect(plain(read.answer)).toEqual(V.plant.expect);
    await node!.close();
    for (const row of (V.owner.rows as (Row & { raw: string })[]).filter((r) => r.raw === "V4")) {
      const got = await readRow(row);
      expect([row.case, plain(got.answer)]).toEqual([row.case, row.expect]);
      await node!.close();
    }
  });
});


/** V4's row of a node declared archival on which V2 is nowhere, before its lapse: lcp's read answers `instrument-live`. */
const NOWHERE = V.V4.status.find((r) => r.case === "the same on a node declared archival: before the lapse, instrument-live")!;

/**
 * A node at which V2 passes `/verify`'s reads, whose broadcast answers `broadcast`, and whose read gives V4's row
 * `NOWHERE` until a broadcast it accepts, and `row` from then on.
 */
function settling(row: StatusRow, broadcast: () => unknown = () => ({ result: true })) {
  expect(NOWHERE.expect).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
  const before = rowNode(NOWHERE as never);
  const after = rowNode({ ...row, solidHead: row.solidHead ?? { number: V.V4.status[0]!.solid.blockNumber, timestamp: String(Number(V.fixed.now)) } } as never);
  const chain = verifying();
  let accepted = false;
  return (path: string, body: unknown): unknown => {
    if (path === "/wallet/broadcasthex") {
      const answer = broadcast();
      accepted ||= (answer as { result?: unknown }).result === true;
      return answer;
    }
    // lcp's read: the Solidity node's calls, and the FullNode's head, receipt and block reads, which TaPoS shares.
    if (path.startsWith("/walletsolidity") || /\/(getnowblock|gettransactioninfobyid|getblockbylimitnext|getblockbynum)$/.test(path)) {
      return (accepted ? after : before)(path, body);
    }
    return chain(path, body);
  };
}

describe("the Tron module's own answer to a broadcast", () => {
  it("answers a broadcast the node refuses as a duplicate invalid_transaction_state, naming the id", async () => {
    const m = await tronOn(settling(V.V4.status[0]!, () => ({ code: "DUP_TRANSACTION_ERROR", message: "dup" })));
    const p = payment(SIGNED);
    expect(await m.facilitator.settle(p.payload, p.requirements)).toEqual({
      success: false,
      errorReason: "invalid_transaction_state",
      transaction: TXID,
      network: NETWORK,
    });
  });
});

describe("lcp's V2 payment through the settler's /supported, /verify and /settle", () => {
  const settled = V.V4.status[0]!;
  const reverted = V.V4.status.find((r) => r.case === "solid REVERT")!;
  /** Answers read live from Tron mainnet (fixtures/tron-mainnet-answers.json). */
  const live = fixture("tron-mainnet-answers.json") as Record<string, Record<string, unknown>>;
  const SUCCESS = { success: true, transaction: TXID, network: NETWORK, payer: V.V2.expectRecoversTo };
  const CONSUMED = { success: false, errorReason: "invalid_transaction_state", transaction: TXID, network: NETWORK };
  /** V2's reference block as `/wallet/getblock` answers it. */
  const REF_BLOCK = { blockID: V2_REF_BLOCK.id, block_header: { raw_data: { number: V2_REF_BLOCK.number } } };
  const broadcasts = () => node!.calls.filter((c) => c.path === "/wallet/broadcasthex").length;
  const settle = async (base: string) => (await post(`${base}/settle`, request(payment(SIGNED)))).json;

  it("/supported states the kind: the profile's transfer method, no key and no signer (the payer pays every fee), no zero (rule 1's floor), its pairing", async () => {
    const base = await settlerOn(settling(settled));
    const res = await fetch(`${base}/supported`);
    expect(await res.json()).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: NETWORK,
          extra: { assetTransferMethod: "lcp-trc20-memo", key: "none", acceptsZero: false, pairings: ["x402/exact/tron/lcp-trc20-memo"] },
        },
      ],
      extensions: [],
      signers: { "tron:*": [] },
    });
  });

  it("verifies V2 with the payer the vector recovers, settles it with the id the vector states, and refuses it once settled: a repeat broadcasts nothing", async () => {
    const base = await settlerOn(settling(settled));
    expect(SIGNED).toBe(V.V2.expectTransactionHex);
    expect((await post(`${base}/verify`, request(payment(SIGNED)))).json).toEqual({ isValid: true, payer: V.V2.expectRecoversTo });
    expect(await settle(base)).toEqual(SUCCESS);
    // x402's exact scheme: a consumed payment is a settlement failure, never a second success.
    expect(await settle(base)).toEqual(CONSUMED);
    expect((await post(`${base}/verify`, request(payment(SIGNED)))).json).toEqual({
      isValid: false,
      invalidReason: "invalid_transaction_state",
      payer: V.V2.expectRecoversTo,
    });
    expect(broadcasts()).toBe(1);
  });

  it("refuses at /verify what rule 5 requires: an expiration outside its window, another transfer, method or memo, a simulation that reverts, a reference block whose id differs", async () => {
    let trigger: unknown = live["triggerSuccess"];
    let refBlock = REF_BLOCK;
    const chain = settling(settled);
    const base = await settlerOn((path, body) => {
      if (path === "/wallet/triggerconstantcontract") return trigger;
      if (path === "/wallet/getblock") return refBlock;
      return chain(path, body);
    });
    const verdict = async (p: X402Payment) => (await post(`${base}/verify`, request(p))).json;
    const payer = V.V2.expectRecoversTo;
    const refused = (invalidReason: string, withPayer = true) => ({ isValid: false, invalidReason, ...(withPayer ? { payer } : {}) });
    expect(await verdict(payment(SIGNED))).toEqual({ isValid: true, payer });
    // The expiration in the future, and no later than now + maxTimeoutSeconds.
    const expiration = Number(V.V3.expectReference.expiration);
    expect(expiration - Number(V.fixed.now)).toBe(O.maxTimeoutSeconds * 1000);
    for (const now of [expiration, Number(V.fixed.now) - 1]) {
      vi.mocked(Date.now).mockReturnValue(now);
      expect([now, await verdict(payment(SIGNED))]).toEqual([now, refused("invalid_payload")]);
    }
    vi.mocked(Date.now).mockReturnValue(Number(V.fixed.now));
    // transfer(payTo, amount) on asset, exactly, and the profile's transfer method.
    for (const change of [{ amount: "10001" }, { payTo: O.asset }, { asset: O.payTo }]) {
      expect([change, await verdict(payment(SIGNED, { ...O, ...change }))]).toEqual([change, refused("invalid_payload", false)]);
    }
    for (const extra of [{ assetTransferMethod: "lcp-trc20" }, {}]) {
      expect([extra, await verdict(payment(SIGNED, { ...O, extra }))]).toEqual([extra, refused("invalid_payment_requirements", false)]);
    }
    // `data` an LCP sha256 string: V2 signed again with V1's memo.
    const decoded = decodeTronTx(SIGNED);
    if (isRefusal(decoded)) throw new Error("V2 did not decode");
    const memo = Buffer.from(encodeTronRaw({ ...decoded.raw, data: Buffer.from("提现", "utf8") })).toString("hex");
    expect(await verdict(payment(transaction(memo, [sign(memo, PAYER_SECRET)])))).toEqual(refused("invalid_payload", false));
    // The node's simulation, as Tron mainnet answered it for an unfunded owner.
    trigger = live["triggerRevert"];
    expect(await verdict(payment(SIGNED))).toEqual(refused("invalid_transaction"));
    trigger = live["triggerSuccess"];
    // TaPoS: ref_block_hash is bytes 8-15 of the reference block's id, here read from Tron mainnet.
    refBlock = { ...REF_BLOCK, blockID: `${V2_REF_BLOCK.id.slice(0, 16)}${"00".repeat(8)}${V2_REF_BLOCK.id.slice(32)}` };
    expect(await verdict(payment(SIGNED))).toEqual(refused("invalid_transaction"));
    expect(broadcasts()).toBe(0);
  });

  it("two concurrent settles of V2 broadcast once, and only one of them answers success (rule 5: deduplicated atomically)", async () => {
    const base = await settlerOn(settling(settled), 5_000);
    const answers = await Promise.all([settle(base), settle(base)]);
    expect(answers.filter((a) => (a as { success: boolean }).success)).toEqual([SUCCESS]);
    expect(answers.filter((a) => !(a as { success: boolean }).success)).toEqual([CONSUMED]);
    expect(broadcasts()).toBe(1);
  });

  it("answers settlement_pending with the id while lcp's read is live (V4's solid REVERT row), its search starting at the last solidified block read before the broadcast", async () => {
    expect(reverted.expect).toMatchObject({ state: "pending" });
    const base = await settlerOn(settling(reverted as never), 2_000);
    expect(await settle(base)).toEqual({ success: false, errorReason: "settlement_pending", transaction: TXID, network: NETWORK });
    // The node's latest solidified block before the broadcast is NOWHERE's.
    const before = (NOWHERE.solidHead as { number: string }).number;
    const row = await db!.pool.query<{ since: unknown; final: boolean }>("SELECT since, final FROM instrument");
    expect(row.rows).toEqual([{ final: false, since: { number: { $bigint: before }, blockId: `0x${blockId(BigInt(before))}` } }]);
  });

  it("a broadcast java-tron refuses (a recorded mainnet answer) is not final: unexpected_settle_error with no transaction, and a repeat broadcasts again and settles", async () => {
    // The facilitator this settler grew from stored the refusal as the payment's final answer, so a payment whose
    // broadcast a node refused could never be settled; nothing was broadcast, and the id is not consumed.
    let refuse = true;
    const base = await settlerOn(settling(settled, () => (refuse ? live["broadcastExpired"] : { result: true })));
    expect(live["broadcastExpired"]).toMatchObject({ result: false, code: "TRANSACTION_EXPIRATION_ERROR" });
    expect(await settle(base)).toEqual({ success: false, errorReason: "unexpected_settle_error", transaction: "", network: NETWORK });
    refuse = false;
    expect(await settle(base)).toEqual(SUCCESS);
    expect(broadcasts()).toBe(2);
  });

  it("refuses a body over the request bound, lcp's x402 header bound twice and the body's own members, and reads one at it", async () => {
    const base = await settlerOn(settling(settled));
    expect(X402_REQUEST_MAX_BYTES).toBe(2 * MAX_HEADER_BYTES + 1024);
    const over = await fetch(`${base}/verify`, { method: "POST", body: "x".repeat(X402_REQUEST_MAX_BYTES + 1) });
    expect(over.status).toBe(413);
    // A body at the bound is read: it is not JSON, so it is refused as the client's own payload.
    const at = await fetch(`${base}/verify`, { method: "POST", body: "x".repeat(X402_REQUEST_MAX_BYTES) });
    expect([at.status, await at.json()]).toEqual([400, { isValid: false, invalidReason: "invalid_payload" }]);
  });

  it("answers x402's reasons for a request it cannot serve, a /settle naming the requirements' network where they name one as a string", async () => {
    // x402's settlement response carries the `network`, and an empty `transaction` when nothing was broadcast.
    const base = await settlerOn(settling(settled));
    const body = request(payment(SIGNED));
    const refused = (errorReason: string, network: string) => ({ success: false, errorReason, transaction: "", network });
    const settle = async (b: unknown) => (await post(`${base}/settle`, b)).json;
    expect((await post(`${base}/verify`, request(payment(SIGNED, { ...O, network: "tron:3448148188" as Network })))).json).toEqual({
      isValid: false,
      invalidReason: "invalid_network",
    });
    expect(await settle({ ...body, x402Version: 1 })).toEqual(refused("invalid_x402_version", NETWORK));
    expect(await settle({ ...body, paymentPayload: [] })).toEqual(refused("invalid_payload", NETWORK));
    expect(await settle({ ...body, paymentRequirements: { ...O, scheme: "upto" } })).toEqual(refused("unsupported_scheme", NETWORK));
    expect(await settle({ ...body, paymentRequirements: { ...O, network: 728126428 } })).toEqual(refused("invalid_network", ""));
    expect(await settle([body])).toEqual(refused("invalid_payload", ""));
    expect(broadcasts()).toBe(0);
  });
});
