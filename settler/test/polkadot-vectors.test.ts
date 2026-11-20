// lcp's vectors for x402/exact/polkadot/lcp-assets-remark through the Polkadot module, and through the settler's
// /supported, /verify and /settle over HTTP, against a local JSON-RPC node stub whose metadata answers are Polkadot Asset Hub's live answers (fixtures/polkadot-asset-hub-2005000.json.gz). Every
// expected answer is the vector's or the profile's: the payer the vector's events name, lcp's own refusal of a payload
// (an x402 `invalid_payload`), the instrument by the signer and the nonce the vector's reference reads, and, for the
// read, the answer the vector states for the reader answers it gives. The node gives those answers in its own form: a
// block by `chain_getBlock`, an extrinsic's events as `System.Events` SCALE-encoded here with the live metadata from the
// vector's events, an account's nonce as `System.Account` at a block, and the validation by `state_call`.
import { ApiPromise } from "@polkadot/api";
import { readFileSync } from "node:fs";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OperatorEntry } from "../src/answers.js";
import { serveProfileFacilitator } from "../src/index.js";
import type { Module, X402Payment } from "../src/module.js";
import { createPolkadot, polkadotModules } from "../src/modules/polkadot/index.js";
import { fixture, freshDatabase, onLockedPort, post, stub, type Stub } from "./support.js";

/** The vector file, read as lcp ships it; a plant points this at a changed copy. */
const FILE = new URL("../../lcp/vectors/x402-exact-polkadot-lcp-assets-remark.json", import.meta.url);

interface Event {
  pallet: string;
  method: string;
  data: unknown[];
}
interface StatusRow {
  case: string;
  after?: string;
  finalized?: string;
  head?: string;
  nonceFinal?: string;
  nonceHead?: string;
  valid?: string;
  raws?: string[];
  change?: { events?: Event[] } & Record<string, unknown>;
  readerError?: boolean;
  expect?: unknown;
  [k: string]: unknown;
}
/** The members of the vector file read here. */
interface Vectors {
  fixed: { O: PaymentRequirements; resource: NonNullable<PaymentPayload["resource"]> };
  V2: { expectCall: string };
  V3: {
    extrinsic: string;
    expectHash: string;
    expectReference: { signer: string; nonce: string; era: { period: number } };
    refusals: { case: string; extrinsic: string; call: string; expect: string }[];
  };
  V4: {
    block: string;
    index: number;
    raw: string[];
    extrinsicAt: { at: { height: number | string }; events: Event[] };
    status: StatusRow[];
  };
}
const V = JSON.parse(readFileSync(FILE, "utf8")) as Vectors;
const O = V.fixed.O;
const NETWORK = O.network as Network;
const SIGNER = V.V3.expectReference.signer;
/** The payer as the vector's events name it: the transfer's sender. */
const PAYER = V.V4.extrinsicAt.events.find((e) => e.method === "Transferred")!.data[1] as string;

const init = (fixture("polkadot-asset-hub-2005000.json.gz") as { calls: { method: string; params: unknown[]; result: unknown }[] }).calls;
const BEST_HASH = `0x${"bb".repeat(32)}`;
const FINALIZED_HASH = `0x${"cc".repeat(32)}`;
/** `Ok(ValidTransaction { priority: 0, requires: [], provides: [], longevity: 64, propagate: true })` */
const VALID = `0x00${"00".repeat(8)}0000${"40"}${"00".repeat(7)}01`;
/** `Err(Invalid(BadProof))`. */
const BAD_PROOF = "0x010004";

let api: ApiPromise;
beforeAll(async () => {
  const provider = {
    hasSubscriptions: false,
    isClonable: false,
    isConnected: true,
    clone: () => provider,
    async connect() {},
    async disconnect() {},
    on: () => () => {},
    async send(method: string, params: unknown[]) {
      return init.find((c) => c.method === method && JSON.stringify(c.params) === JSON.stringify(params))?.result;
    },
    subscribe: async () => 0,
    unsubscribe: async () => false,
  };
  api = await ApiPromise.create({ provider: provider as never, noInitWarn: true, initWasm: false });
});
afterAll(async () => {
  await api.disconnect();
});

/** A value's SCALE bytes, in hex without `0x`. */
const scale = (v: { toU8a(): Uint8Array }) => Buffer.from(v.toU8a()).toString("hex");
const u32le = (n: number) => Buffer.from(Uint32Array.of(n).buffer).toString("hex");

/**
 * `System.Events` holding `events`, each in phase `ApplyExtrinsic(index)`: the pallet's and the variant's index from the
 * live metadata, then each argument encoded as the variant's field type, then no topics.
 */
function eventsAt(index: number, events: readonly Event[]): string {
  const pallets = api.runtimeMetadata.asLatest.pallets;
  const records = events.map((e) => {
    const pallet = pallets.find((p) => p.name.toString().toLowerCase() === e.pallet.toLowerCase());
    if (pallet === undefined) throw new Error(`no pallet ${e.pallet} in the metadata`);
    const variants = api.registry.lookup.getSiType(pallet.events.unwrap().type).def.asVariant.variants;
    const variant = variants.find((v) => v.name.toString() === e.method);
    if (variant === undefined) throw new Error(`no event ${e.pallet}.${e.method} in the metadata`);
    const data = variant.fields.map((f, i) => scale(api.registry.createType(api.registry.createLookupType(f.type), e.data[i])));
    const at = `${pallet.index.toNumber().toString(16).padStart(2, "0")}${variant.index.toNumber().toString(16).padStart(2, "0")}`;
    return `00${u32le(index)}${at}${data.join("")}00`;
  });
  return `0x${scale(api.registry.createType("Compact<u32>", records.length))}${records.join("")}`;
}

function accountInfo(nonce: number): string {
  return `0x${scale(api.createType("AccountInfo", { nonce }))}`;
}

const hex = (n: number | bigint) => `0x${n.toString(16)}`;
/** A block's hash: V4's block at its height, and one made of the height at every other. */
const hashAt = (n: number) => (n === Number(V.V4.extrinsicAt.at.height) ? V.V4.block : `0x${n.toString(16).padStart(64, "0")}`);

/**
 * A JSON-RPC node for a status row, as lcp's own fixture reads it: V4's extrinsics at block 100 (or the row's), its
 * record's events at index 2, and one bare item at every other height from 90 to 120; the row's finalized height, head,
 * nonces at each and validation.
 */
function rowNode(row: StatusRow) {
  const height = Number(V.V4.extrinsicAt.at.height);
  const events = row.change?.events ?? V.V4.extrinsicAt.events;
  const accountKey = api.query["system"]!["account"]!.key(SIGNER);
  const eventsKey = api.query["system"]!["events"]!.key();
  const validAt = row.valid === undefined || row.valid === "invalid" ? undefined : Number(row.valid);
  return (method: string, params: unknown[]): unknown => {
    const known = init.find((c) => c.method === method && JSON.stringify(c.params) === JSON.stringify(params));
    if (known !== undefined) return { result: known.result };
    if (row.readerError) return { error: { code: -32000, message: "unavailable" } };
    const p = JSON.stringify(params);
    if (method === "chain_getFinalizedHead") return { result: FINALIZED_HASH };
    if (method === "chain_getBlockHash" && p === "[]") return { result: BEST_HASH };
    if (method === "chain_getHeader" && p === JSON.stringify([FINALIZED_HASH])) return { result: { number: hex(Number(row.finalized ?? 0)) } };
    if (method === "chain_getHeader" && p === JSON.stringify([BEST_HASH])) return { result: { number: hex(validAt ?? 0) } };
    if (method === "chain_getHeader" && p === "[]") return { result: { number: hex(Number(row.head ?? row.finalized ?? 0)) } };
    if (method === "state_call") return { result: validAt === undefined ? BAD_PROOF : VALID };
    if (method === "chain_getBlockHash") {
      const n = params[0] as number;
      return { result: n >= 90 && n <= 120 ? hashAt(n) : null };
    }
    if (method === "chain_getBlock") {
      const n = [...Array(31).keys()].map((i) => 90 + i).find((h) => hashAt(h) === params[0]);
      if (n === undefined) return { result: null };
      const extrinsics = n === height ? (row.raws ?? V.V4.raw) : ["0x0c040000"];
      return { result: { block: { header: { number: hex(n) }, extrinsics } } };
    }
    if (method === "state_getStorage" && params[0] === eventsKey) {
      return { result: params[1] === V.V4.block ? eventsAt(V.V4.index, events) : "0x00" };
    }
    if (method === "state_getStorage" && params[0] === accountKey) {
      return { result: accountInfo(Number((params[1] === FINALIZED_HASH ? row.nonceFinal : row.nonceHead) ?? 0)) };
    }
    return { error: { code: -32601, message: `no stub for ${method} ${p}` } };
  };
}

const entries: OperatorEntry[] = [];
const log = (e: OperatorEntry) => void entries.push(e);
let node: Stub | undefined;
let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let closeSettler: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeSettler?.();
  closeSettler = undefined;
  await node?.close();
  node = undefined;
  await db?.drop();
  db = undefined;
  entries.length = 0;
}, 60_000);

/** A JSON-RPC node stub whose answer to each call is `answer`'s. */
async function rpcNode(answer: (method: string, params: unknown[]) => unknown): Promise<Stub> {
  return stub(async (_path, body) => {
    const { id, method, params } = body as { id: number; method: string; params: unknown[] };
    return { jsonrpc: "2.0", id, ...(answer(method, params) as object) };
  });
}

async function polkadotOn(answer: (method: string, params: unknown[]) => unknown, settleWaitMs = 400): Promise<Module> {
  node = await rpcNode(answer);
  const rail = createPolkadot([{ network: NETWORK as never, rpc: node.url }], settleWaitMs, log);
  return polkadotModules(rail, log)[0]!;
}

/** The settler, started as an operator starts it, with the Polkadot module on one node stub and a database of its own. */
async function settlerOn(answer: (method: string, params: unknown[]) => unknown, settleWaitMs = 4_000, network = NETWORK): Promise<string> {
  node = await rpcNode(answer);
  db = await freshDatabase();
  const url = db.url;
  const { port, server } = await onLockedPort((p) =>
    serveProfileFacilitator({
      listen: `127.0.0.1:${p}`,
      store: { url },
      settleWaitMs,
      polkadot: [{ network: network as never, rpc: node!.url }],
      operatorLog: log,
    }),
  );
  closeSettler = server.close;
  return `http://127.0.0.1:${port}`;
}

/** The x402 facilitator request for `p`. */
const request = (p: X402Payment) => ({ x402Version: 2, paymentPayload: p.payload, paymentRequirements: p.requirements });

function payment(extrinsic = V.V3.extrinsic, call = V.V2.expectCall, requirements: PaymentRequirements = O): X402Payment {
  return { payload: { x402Version: 2, resource: V.fixed.resource, accepted: O, payload: { extrinsic, call } }, requirements };
}

/** Every bigint as its decimal string, as the vector file writes them. */
function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)));
}

describe("lcp's V3 payment through the Polkadot module", () => {
  it("refuses each of V3's payloads lcp refuses, as invalid_payload, reading no node", async () => {
    const m = await polkadotOn(rowNode({ case: "valid", valid: "21054320" }));
    for (const row of V.V3.refusals) {
      const p = payment(row.extrinsic, row.call);
      expect([row.case, await m.facilitator.verify(p.payload, p.requirements)]).toEqual([row.case, { isValid: false, invalidReason: "invalid_payload" }]);
      expect([row.case, await m.record.instrument(p)]).toEqual([row.case, { refused: "invalid_payload" }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("is keyed by the signer and the nonce the vector's reference reads, never by the extrinsic's hash", async () => {
    const m = await polkadotOn(rowNode({ case: "valid" }));
    expect(await m.record.instrument(payment())).toEqual({
      pairing: "x402/exact/polkadot/lcp-assets-remark",
      instrument: { by: "single-use", network: NETWORK, signer: SIGNER, value: V.V3.expectReference.nonce },
      nonce: "single-use",
      // The era's period, 64 blocks, at 12 s a block.
      keep: { until: "life", ms: V.V3.expectReference.era.period * 12_000 },
    });
    expect(node!.calls).toEqual([]);
  });
});

describe("lcp's read of the payment, through the module's reader over the node", () => {
  // The settler reads the act `payment` at the final mark, from the extrinsic it was given, with no timepoint named:
  // the rows that read another act or mark, name a hint or another signer, or give a record the endpoint names by a
  // hash other than its bytes' or a `success` its events do not show, ask what this node cannot answer.
  const applies = (r: StatusRow) =>
    r.act === undefined &&
    r.finality === undefined &&
    r.hint === undefined &&
    r.signer === undefined &&
    r.canonicalExtrinsicHash === undefined &&
    Object.keys(r.change ?? {}).every((k) => k === "events");

  it("answers V4's status rows as the vector states", async () => {
    const rows = V.V4.status.filter(applies);
    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      const m = await polkadotOn(rowNode(row));
      // The position as the settler's record gives it back.
      const from = row.after === undefined ? undefined : { after: BigInt(row.after), search: { next: BigInt(row.after) + 1n, hits: [] } };
      const read = await m.record.read(payment(), { deadline: performance.now() + 10_000, ...(from === undefined ? {} : { from }) });
      expect([row.case, plain(read.answer)]).toEqual([row.case, row.expect]);
      await node!.close();
    }
  });
});

/** A node at which V3 validates at block 99 over a finalized head at 98, and, once submitted, lands at index 2 of block 100, its events V4's. */
function landing(submit: () => unknown = () => ({ result: V.V4.block })) {
  const row = { case: "landed", finalized: "98", head: "98", valid: "99", nonceFinal: "0", nonceHead: "0" };
  let submitted = false;
  const before = rowNode(row);
  const after = rowNode({ ...row, finalized: "100", head: "101", nonceFinal: "1", nonceHead: "1" });
  return (method: string, params: unknown[]) => {
    if (method === "author_submitExtrinsic") {
      const answer = submit() as { result?: unknown };
      submitted ||= answer.result !== undefined;
      return answer;
    }
    return submitted ? after(method, params) : before(method, params);
  };
}

describe("the Polkadot module's own answer to a submission", () => {
  it("answers a submission the node has already seen invalid_transaction_state, naming the extrinsic", async () => {
    const m = await polkadotOn(landing(() => ({ error: { code: 1013, message: "Transaction Already Imported" } })), 3_000);
    const p = payment();
    expect(await m.facilitator.settle(p.payload, p.requirements)).toEqual({
      success: false,
      errorReason: "invalid_transaction_state",
      transaction: V.V3.expectHash,
      network: NETWORK,
    });
  });
});

describe("lcp's V3 payment through the settler's /supported, /verify and /settle", () => {
  const SUCCESS = { success: true, transaction: `${V.V4.block}-${V.V4.index}`, network: NETWORK, payer: PAYER };
  const submits = () => node!.calls.filter((c) => (c.body as { method: string }).method === "author_submitExtrinsic").length;
  const settle = async (base: string) => (await post(`${base}/settle`, request(payment()))).json;

  it("/supported states the kind: the profile's transfer method, no key and no signer (the payer pays every fee), no zero (the assets pallet emits no event for one), its pairing", async () => {
    const base = await settlerOn(landing());
    const res = await fetch(`${base}/supported`);
    expect(await res.json()).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: NETWORK,
          extra: { assetTransferMethod: "lcp-assets-remark", key: "none", acceptsZero: [], pairings: ["x402/exact/polkadot/lcp-assets-remark"] },
        },
      ],
      extensions: [],
      signers: { "polkadot:*": [] },
    });
  });

  it("verifies V3 with the payer its events name, settles it with the timepoint V4's block names, and refuses it once settled: a repeat submits nothing", async () => {
    const base = await settlerOn(landing());
    expect((await post(`${base}/verify`, request(payment()))).json).toEqual({ isValid: true, payer: PAYER });
    expect(await settle(base)).toEqual(SUCCESS);
    // The search starts after the finalized head read before the validation, not after the best block validated,
    // which can be a fork; the validated head is kept, which proves the era's last block.
    const row = await db!.pool.query<{ since: unknown }>("SELECT since FROM instrument");
    expect(row.rows).toEqual([{ since: { after: { $bigint: "98" }, search: { next: { $bigint: "99" }, hits: [], validated: { $bigint: "99" } } } }]);
    // x402's exact scheme: a consumed payment is a settlement failure, never a second success.
    expect(await settle(base)).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: SUCCESS.transaction, network: NETWORK });
    expect(submits()).toBe(1);
  });

  it("refuses at /verify what rule 5 requires: another call, transfer or method, an immortal era, an extrinsic the chain's validation refuses", async () => {
    let row: StatusRow = { case: "valid", finalized: "98", head: "98", valid: "99", nonceFinal: "0", nonceHead: "0" };
    const base = await settlerOn((method, params) => rowNode(row)(method, params));
    const verdict = async (p: X402Payment) => (await post(`${base}/verify`, request(p))).json;
    const refused = { isValid: false, invalidReason: "invalid_payload" };
    expect(await verdict(payment())).toEqual({ isValid: true, payer: PAYER });
    // The call equal byte for byte to payload.call.
    const call = `${V.V2.expectCall.slice(0, -2)}${V.V2.expectCall.endsWith("64") ? "65" : "64"}`;
    expect(await verdict(payment(V.V3.extrinsic, call))).toEqual(refused);
    // For asset, payTo and amount exactly, under the profile's transfer method.
    for (const change of [{ asset: "1984" }, { payTo: "16SYiSu5tWgdV4sWiaxir7GYEiFfTc9GYnRd34PDGCUMgkmP" }, { amount: "10001" }]) {
      expect([change, await verdict(payment(V.V3.extrinsic, V.V2.expectCall, { ...O, ...change }))]).toEqual([change, refused]);
    }
    for (const extra of [{ assetTransferMethod: "lcp-assets" }, {}]) {
      const answer = await verdict(payment(V.V3.extrinsic, V.V2.expectCall, { ...O, extra }));
      expect([extra, answer]).toEqual([extra, { isValid: false, invalidReason: "invalid_payment_requirements" }]);
    }
    // A mortal era: V3 with its era bytes a502 (after the prefix, 0x84, the address and the signature) replaced by 00,
    // immortal, one byte shorter, so the length prefix is 0x8d03.
    expect(V.V3.extrinsic.slice(204, 208)).toBe("a502");
    expect(await verdict(payment(`0x8d03${V.V3.extrinsic.slice(6, 204)}00${V.V3.extrinsic.slice(208)}`))).toEqual(refused);
    // TaggedTransactionQueue_validate_transaction at the best block answering Ok.
    row = { ...row, valid: "invalid" };
    expect(await verdict(payment())).toEqual({ isValid: false, invalidReason: "invalid_transaction", payer: PAYER });
    expect(submits()).toBe(0);
  });

  it("serves no network whose node answers another genesis: CAIP-2 names a Polkadot chain by its genesis hash", async () => {
    const other = "polkadot:67f9723393ef76214df0118c34bbbd3d";
    const base = await settlerOn(landing(), 4_000, other);
    const there = { ...O, network: other as Network };
    const p = payment(V.V3.extrinsic, V.V2.expectCall, there);
    const res = await post(`${base}/verify`, request({ ...p, payload: { ...p.payload, accepted: there } }));
    expect(res.json).toEqual({ isValid: false, invalidReason: "unexpected_verify_error" });
  });

  it("a submission the node refuses as invalid is not final: unexpected_settle_error with no transaction, and a repeat submits again and settles", async () => {
    // The facilitator this settler grew from stored the refusal as the payment's final answer, so a payment whose
    // submission a node refused could never be settled; nothing was submitted, and the nonce is not consumed.
    let refuse = true;
    const base = await settlerOn(
      landing(() => (refuse ? { error: { code: 1010, message: "Invalid Transaction", data: "Transaction has a bad signature" } } : { result: V.V4.block })),
    );
    expect(await settle(base)).toEqual({ success: false, errorReason: "unexpected_settle_error", transaction: "", network: NETWORK });
    refuse = false;
    expect(await settle(base)).toEqual(SUCCESS);
    expect(submits()).toBe(2);
  });

  it("answers the lapse once the era's last block is final and holds nothing, by the validated head the record kept at the claim (V4's instrument-unused row)", async () => {
    // V4's row: validation answered valid at 50, so the era (64, 42) ends at block 105; finalized 110, the nonce not
    // past the signed one, the search to the head whole and empty. Once the era has ended the node no longer answers
    // the extrinsic valid, so only the head kept at the claim proves the era's last block.
    const lapse = V.V4.status.find((r) => r.expect !== undefined && (r.expect as { reason?: string }).reason === "instrument-unused")!;
    expect(lapse).toMatchObject({ after: "95", finalized: "110", valid: "50" });
    const bare = ["0x0c040000"];
    let now = rowNode({ case: "submitted", finalized: "94", head: "94", valid: lapse.valid!, nonceFinal: "0", nonceHead: "0", raws: bare });
    const base = await settlerOn((method, params) => (method === "author_submitExtrinsic" ? { result: V.V3.expectHash } : now(method, params)), 2_000);
    expect(await settle(base)).toEqual({ success: false, errorReason: "settlement_pending", transaction: V.V3.expectHash, network: NETWORK });
    now = rowNode({ ...lapse, valid: "invalid", raws: bare });
    // The lapse names the extrinsic the settler submitted, by the hash its pending answer named.
    expect(await settle(base)).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: V.V3.expectHash, network: NETWORK });
    expect(submits()).toBe(1);
  });

  it("answers success, submitting nothing more, once the node shows in a block the extrinsic a pending answer named by its hash (V4's settled row)", async () => {
    // The facilitator this settler grew from answered this repeat success; lcp's read names the landed extrinsic by
    // its timepoint, where the pending answer named its hash (the profile's rule 5).
    const landed = V.V4.status.find((r) => r.case.startsWith("the signer's extrinsic at the signed nonce, found by the search"))!;
    expect(landed.expect).toMatchObject({ state: "settled", transaction: SUCCESS.transaction, presented: "yes" });
    let now = rowNode({ case: "submitted", finalized: "94", head: "94", valid: "50", nonceFinal: "0", nonceHead: "0", raws: ["0x0c040000"] });
    const base = await settlerOn((method, params) => (method === "author_submitExtrinsic" ? { result: V.V3.expectHash } : now(method, params)), 2_000);
    expect(await settle(base)).toEqual({ success: false, errorReason: "settlement_pending", transaction: V.V3.expectHash, network: NETWORK });
    now = rowNode(landed);
    expect(await settle(base)).toEqual(SUCCESS);
    expect(submits()).toBe(1);
  });
});
