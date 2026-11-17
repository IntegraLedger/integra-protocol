// The Starknet module (x402/exact/starknet): lcp's vectors (lcp/vectors/x402-exact-starknet.json) through the module's
// verify, settle, record and read, against a local JSON-RPC node stub. Expected answers come from lcp's vectors (the
// message hash, the nonce, the reference, the execute_from_outside_v2 calldata, each read row's answer), from x402's
// Starknet scheme (scheme_exact_starknet.md: its reasons, its window, its settlement steps) and from the profile
// x402-exact-starknet.md; none is taken from the module's own output. The executor's key is a throwaway key made here.
import { readFileSync } from "node:fs";
import { exactStarknet, EVENT_TRANSFER, SELECTOR_EXECUTE_FROM_OUTSIDE_V2, SELECTOR_TRANSFER } from "@integraledger/lcp/starknet";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ec, hash, Signer } from "starknet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorEntry } from "../src/answers.js";
import type { Module } from "../src/module.js";
import { serveSettler } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starknetModule, starter } from "../src/modules/starknet/index.js";
import { starknetNode } from "../src/modules/starknet/node.js";
import { testCore } from "./own-core.js";
import { freshDatabase, onLockedPort, RawBody, stub, type Stub } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-starknet.json", import.meta.url), "utf8"));
const H = V.fixed.H as `0x${string}`;
const O: PaymentRequirements = V.fixed.O;
const NETWORK = "starknet:SN_SEPOLIA";
const EXECUTOR: string = O.extra["feePayer"] as string;
const FROM_REF: string = V.S4.expectReference.from;
/** The vectors' clock: the payment was built at `now`, so its Execute Before is now + maxTimeoutSeconds. */
const NOW_MS = V.fixed.now * 1000;
/** The consumed row's trace: the executor's __execute__ over the payer's execute_from_outside_v2. */
const CONSUMED = V.S5.rows.find((r: { case: string }) => r.case.startsWith("the nonce consumed at 900"));
const LANDED = CONSUMED.node.transactions["0x4c2f9a1b"];
const OUTSIDE_CALLDATA: string[] = LANDED.trace.calls[0].calldata;

const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const big = (v: string) => BigInt(v);

async function payment(act: "payment" | "agreement" = "payment", option: PaymentRequirements = O): Promise<PaymentPayload> {
  const required = exactStarknet.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [option as never] }, H, V.fixed.link, option as never);
  if ("refused" in required) throw new Error(required.code);
  const u = await exactStarknet.build({ required, accepted: option as never, from: V.fixed.from, now: V.fixed.now }, H, act);
  if ("refused" in u) throw new Error(u.code);
  const p = u.complete(V.S3.signature);
  if ("refused" in p) throw new Error(p.code);
  return p as unknown as PaymentPayload;
}

/** A copy of `p` whose signed typed data has `change` applied to its message. */
function withMessage(p: PaymentPayload, change: (m: Record<string, unknown>) => void): PaymentPayload {
  const copy = structuredClone(p) as PaymentPayload;
  const oe = (copy.payload as { outsideExecution: { typedData: { message: Record<string, unknown> } } }).outsideExecution;
  change(oe.typedData.message);
  return copy;
}

// ── The node stub: Starknet JSON-RPC over a fixture node in lcp's vectors' form (S5's `node`), and the calls the
// module's checks and settlement make.

type Rec = { finality: string; execution: string; blockNumber: string | null; events: { fromAddress: string; keys: string[]; data: string[] }[] };
type Inv = { contract: string; selector: string; calldata: unknown; reverted: unknown; calls: unknown };
type FixtureNode = {
  network: string;
  final: { number: string; timestamp: string };
  latest: { number: string; timestamp: string };
  used: { account: string; nonce: string; at: string }[];
  stateFrom?: string;
  eventsFrom?: string;
  pageSize: number;
  events: { fromAddress: string; keys: string[]; data: string[]; transaction: string; blockNumber: string | null }[];
  transactions: Record<string, { receipt: Rec; trace: Inv | null }>;
  fail?: boolean;
  nonceError?: { code: number; message: string };
};

interface Chain {
  node: FixtureNode;
  deployed: string[];
  /** The SNIP-12 hashes the payer's account signed, each with the vectors' signature. */
  signature: { hashes: string[]; felts: string[] };
  balance: bigint;
  simulation: unknown;
  executorNonce: bigint;
  /** The receipt and trace the node gives the transaction the executor sends, once sent. */
  landing?: (hash: string) => { receipt: Rec & { fee?: string }; trace: Inv | null } | undefined;
}

class Fault {
  constructor(readonly code: number, readonly message: string) {}
}

const toRpcInvocation = (t: Inv): unknown =>
  t === null || typeof t !== "object"
    ? t
    : {
        contract_address: t.contract,
        entry_point_selector: t.selector,
        calldata: t.calldata,
        is_reverted: t.reverted,
        calls: Array.isArray(t.calls) ? t.calls.map((c) => toRpcInvocation(c as Inv)) : t.calls,
        events: [],
      };
const toRpcReceipt = (r: Rec & { fee?: string }, txHash: string) => ({
  type: "INVOKE",
  transaction_hash: txHash,
  actual_fee: { amount: r.fee ?? "0x0", unit: "FRI" },
  execution_status: r.execution,
  finality_status: r.finality,
  ...(r.blockNumber === null ? {} : { block_number: Number(r.blockNumber), block_hash: "0x1" }),
  messages_sent: [],
  events: r.events.map((e) => ({ from_address: e.fromAddress, keys: e.keys, data: e.data })),
  execution_resources: { l1_gas: 0, l1_data_gas: 0, l2_gas: 0 },
});

/** A simulation of the settlement whose payer's account transfers `amount` to `to` once, as x402's rule 8 asks. */
function simulation(events: { keys: string[]; data: string[] }[] = [{ keys: [EVENT_TRANSFER, V.fixed.from, O.payTo], data: ["0x2710", "0x0"] }], reverted = false) {
  const transfer = { contract_address: O.asset, entry_point_selector: SELECTOR_TRANSFER, calldata: [O.payTo, "0x2710", "0x0"], calls: [], events: events.map((e, order) => ({ order, ...e })), is_reverted: false };
  const outside = { contract_address: V.fixed.from, entry_point_selector: SELECTOR_EXECUTE_FROM_OUTSIDE_V2, calldata: OUTSIDE_CALLDATA, calls: [transfer], events: [], is_reverted: false };
  return [
    {
      transaction_trace: {
        type: "INVOKE",
        execute_invocation: reverted ? { revert_reason: "Transfer failed" } : { contract_address: EXECUTOR, entry_point_selector: "0x15d40a3d6ca2ac30f4031e42be28da9b056fef9bb7357ac5e85627ee876e5ad", calldata: [], calls: [outside], events: [], is_reverted: false },
      },
      fee_estimation: {
        l1_gas_consumed: "0x0",
        l1_gas_price: "0x174876e800",
        l2_gas_consumed: "0x1e8480",
        l2_gas_price: "0x2540be400",
        l1_data_gas_consumed: "0x80",
        l1_data_gas_price: "0x3e8",
        overall_fee: "0x0",
        unit: "FRI",
      },
    },
  ];
}

const executorKey = ec.starkCurve.utils.randomPrivateKey();
const executorPub = ec.starkCurve.getPublicKey(executorKey, false);
const signer = new Signer(executorKey);

let chain: Chain;
let node: Stub | undefined;
/** Every JSON-RPC call the node received, by its method and params. */
let calls: { method: string; params: Record<string, unknown> }[] = [];
/** The transactions the executor sent, as the node received them, each with the hash the node computes for it. */
let sentTx: { invoke: Record<string, unknown>; hash: string }[] = [];
let entries: OperatorEntry[] = [];

function baseChain(): Chain {
  return {
    node: structuredClone(V.S5.rows[0].node),
    deployed: [V.fixed.from],
    signature: { hashes: [V.S3.expectMessageHash, V.S7.expectMessageHash], felts: V.S3.signature },
    balance: 1_000_000n,
    simulation: simulation(),
    executorNonce: 7n,
  };
}

/** The hash the node gives an INVOKE v3 it receives: Starknet's transaction hash over the transaction's own fields. */
function hashOf(invoke: Record<string, unknown>): string {
  const rb = invoke["resource_bounds"] as Record<string, { max_amount: string; max_price_per_unit: string }>;
  const bn = Object.fromEntries(Object.entries(rb).map(([k, r]) => [k, { max_amount: big(r.max_amount), max_price_per_unit: big(r.max_price_per_unit) }]));
  return hash.calculateInvokeTransactionHash({
    senderAddress: invoke["sender_address"] as string,
    version: "0x3",
    compiledCalldata: invoke["calldata"] as string[],
    chainId: "0x534e5f5345504f4c4941",
    nonce: invoke["nonce"] as string,
    accountDeploymentData: [],
    nonceDataAvailabilityMode: 0,
    feeDataAvailabilityMode: 0,
    resourceBounds: bn as never,
    tip: 0,
    paymasterData: [],
  });
}

function answer(method: string, params: Record<string, unknown>): unknown {
  const n = chain.node;
  const tx = (h: unknown) => {
    const key = Object.keys(n.transactions).find((k) => big(k) === big(h as string));
    if (key !== undefined) return n.transactions[key];
    const landed = sentTx.find((s) => big(s.hash) === big(h as string));
    return landed === undefined ? undefined : chain.landing?.(landed.hash);
  };
  switch (method) {
    case "starknet_getBlockWithTxHashes": {
      const h = params["block_id"] === "l1_accepted" ? n.final : n.latest;
      return { block_number: Number(h.number), timestamp: Number(h.timestamp), transactions: [] };
    }
    case "starknet_getClassHashAt": {
      if (!chain.deployed.some((a) => big(a) === big(params["contract_address"] as string))) throw new Fault(20, "Contract not found");
      return "0x1234";
    }
    case "starknet_getNonce":
      return `0x${chain.executorNonce.toString(16)}`;
    case "starknet_call": {
      const req = params["request"] as { contract_address: string; entry_point_selector: string; calldata: string[] };
      const selector = big(req.entry_point_selector);
      if (selector === big("0x28420862938116cb3bbdbedee07451ccc54d4e9412dbef71142ad1980a30941")) {
        const [h, , ...sig] = req.calldata;
        const ok = chain.signature.hashes.some((x) => big(x) === big(h!)) && sig.length === chain.signature.felts.length && sig.every((s, k) => big(s) === big(chain.signature.felts[k]!));
        return [ok ? "0x56414c4944" : "0x0"];
      }
      if (selector === big("0x1e6d35df2b9d989fb4b6bbcebda1314e4254cbe5e589dd94ff4f29ea935e91c")) {
        if (n.nonceError !== undefined) throw new Fault(n.nonceError.code, n.nonceError.message);
        const block = params["block_id"];
        const at = typeof block === "object" && block !== null ? BigInt((block as { block_number: number }).block_number) : big(n.latest.number);
        if (n.stateFrom !== undefined && at < big(n.stateFrom)) throw new Fault(24, "Block not found");
        const used = n.used.some((u) => big(u.account) === big(req.contract_address) && big(u.nonce) === big(req.calldata[0]!) && at >= big(u.at));
        return [used ? "0x0" : "0x1"];
      }
      if (selector === big("0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33")) {
        return [`0x${(chain.balance % (1n << 128n)).toString(16)}`, `0x${(chain.balance >> 128n).toString(16)}`];
      }
      throw new Fault(21, "Requested entry point does not exist in the contract");
    }
    case "starknet_simulateTransactions":
      if (chain.simulation instanceof Fault) throw chain.simulation;
      return chain.simulation;
    case "starknet_addInvokeTransaction": {
      const invoke = params["invoke_transaction"] as Record<string, unknown>;
      const h = hashOf(invoke);
      const [r, s] = invoke["signature"] as string[];
      if (!ec.starkCurve.verify(new ec.starkCurve.Signature(big(r!), big(s!)), h, executorPub)) throw new Fault(55, "Account validation failed");
      sentTx.push({ invoke, hash: h });
      return { transaction_hash: h };
    }
    case "starknet_getTransactionReceipt": {
      const t = tx(params["transaction_hash"]);
      if (t === undefined) throw new Fault(29, "Transaction hash not found");
      return toRpcReceipt(t.receipt, params["transaction_hash"] as string);
    }
    case "starknet_traceTransaction": {
      const t = tx(params["transaction_hash"]);
      if (t === undefined) throw new Fault(29, "Transaction hash not found");
      return t.trace === null ? { type: "INVOKE" } : { type: "INVOKE", execute_invocation: toRpcInvocation(t.trace) };
    }
    case "starknet_getEvents": {
      const f = params["filter"] as { from_block: { block_number: number }; to_block: { block_number: number }; address: string; keys: string[][]; continuation_token?: string };
      if (n.eventsFrom !== undefined && BigInt(f.from_block.block_number) < big(n.eventsFrom)) throw new Fault(24, "Block not found");
      const keys = new Set((f.keys[0] ?? []).map(big));
      const all = n.events.filter(
        (e) =>
          big(e.fromAddress) === big(f.address) &&
          (keys.size === 0 || keys.has(big(e.keys[0]!))) &&
          e.blockNumber !== null &&
          big(e.blockNumber) >= BigInt(f.from_block.block_number) &&
          big(e.blockNumber) <= BigInt(f.to_block.block_number),
      );
      const start = f.continuation_token === undefined ? 0 : Number(f.continuation_token);
      const page = all.slice(start, start + n.pageSize).map((e) => ({
        from_address: e.fromAddress,
        keys: e.keys,
        data: e.data,
        transaction_hash: e.transaction,
        ...(e.blockNumber === null ? {} : { block_number: Number(e.blockNumber) }),
      }));
      return { events: page, ...(start + n.pageSize < all.length ? { continuation_token: String(start + n.pageSize) } : {}) };
    }
  }
  throw new Fault(-32601, `method not found: ${method}`);
}

async function startNode(): Promise<string> {
  node = await stub((_path, body) => {
    const { id, method, params } = body as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method, params });
    if (chain.node.fail === true) return new RawBody("<html>bad gateway</html>");
    try {
      return { jsonrpc: "2.0", id, result: answer(method, params) };
    } catch (e) {
      if (e instanceof Fault) return { jsonrpc: "2.0", id, error: { code: e.code, message: e.message } };
      throw e;
    }
  });
  return node.url;
}

async function moduleOn(): Promise<Module> {
  const url = await startNode();
  const core = testCore();
  entries = core.entries;
  return starknetModule({ network: NETWORK, rpc: url, executor: { address: EXECUTOR, signer } }, core);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW_MS });
  chain = baseChain();
  calls = [];
  sentTx = [];
  entries = [];
});
afterEach(async () => {
  vi.useRealTimers();
  await node?.close();
  node = undefined;
});

// The settler started with this module alone, through its HTTP surface, on a fresh database.
const CREDENTIAL = "own-a-starknet-test";
const LIST = [listed("starknet", async () => ({ starter }))] as const;
let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let closeSettler: (() => Promise<void>) | undefined;
let base = "";
afterEach(async () => {
  await closeSettler?.();
  closeSettler = undefined;
  await db?.drop();
  db = undefined;
}, 60_000);

async function serve(): Promise<void> {
  const url = await startNode();
  db = await freshDatabase();
  const config = { network: NETWORK, rpc: url, executor: { address: EXECUTOR, signer } } as const;
  const { port, server } = await onLockedPort((p) =>
    serveSettler(
      { listen: `127.0.0.1:${p}`, store: { url: db!.url }, settleWaitMs: 5_000, credential: CREDENTIAL, operatorLog: (e) => void entries.push(e), starknet: { networks: [config] } },
      LIST,
    ),
  );
  closeSettler = server.close;
  base = `http://127.0.0.1:${port}`;
}

async function call(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CREDENTIAL}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res.json();
}
const request = (p: PaymentPayload, r: PaymentRequirements = O) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: r });
const shortest = (f: string) => `0x${big(f).toString(16)}`;
/** The outside execution's calldata in the executor's one call, as the transaction the node received carries it. */
const outsideIn = (invoke: Record<string, unknown>) => (invoke["calldata"] as string[]).map(big);

describe("the Starknet module through the settler's HTTP surface", () => {
  it("/supported states the kind: the pairing, the executor's key purpose, no zero, the executor as feePayer and signer", async () => {
    await serve();
    expect(await call("/supported")).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: NETWORK,
          extra: { feePayer: shortest(EXECUTOR), key: "relayer", pairings: ["x402/exact/starknet"], acceptsZero: false },
        },
      ],
      extensions: [],
      signers: { "starknet:*": [shortest(EXECUTOR)] },
    });
  });

  it("verifies and settles lcp's payment vector: one transaction, the executor's one execute_from_outside_v2 on the payer", async () => {
    chain.landing = () => ({ receipt: { ...LANDED.receipt, finality: "ACCEPTED_ON_L2", blockNumber: "1005", fee: "0x3e8" }, trace: LANDED.trace });
    await serve();
    const p = await payment();
    expect(await call("/verify", request(p))).toEqual({ isValid: true, payer: FROM_REF });
    // The signature is checked by the payer's account over the vectors' SNIP-12 message hash.
    const sig = calls.find((c) => (c.params["request"] as { entry_point_selector?: string } | undefined)?.entry_point_selector?.startsWith("0x2842"));
    expect((sig!.params["request"] as { calldata: string[] }).calldata.map(big)).toEqual([V.S3.expectMessageHash, "0x2", ...V.S3.signature].map(big));
    const answer = await call("/settle", request(p));
    expect(sentTx).toHaveLength(1);
    expect(answer).toEqual({ success: true, transaction: shortest(sentTx[0]!.hash), network: NETWORK, payer: FROM_REF });
    // One call, execute_from_outside_v2 on the payer, the outside execution as the vectors' landed trace carries it.
    expect(outsideIn(sentTx[0]!.invoke)).toEqual(["0x1", V.fixed.from, SELECTOR_EXECUTE_FROM_OUTSIDE_V2, `0x${OUTSIDE_CALLDATA.length.toString(16)}`, ...OUTSIDE_CALLDATA].map(big));
    expect(big(sentTx[0]!.invoke["sender_address"] as string)).toBe(big(EXECUTOR));
  });

  it("settles lcp's agreement vector and the payment under the same H as two instruments, each its own transaction", async () => {
    chain.landing = () => ({ receipt: { ...LANDED.receipt, finality: "ACCEPTED_ON_L2", blockNumber: "1005" }, trace: LANDED.trace });
    await serve();
    expect(await call("/settle", request(await payment()))).toMatchObject({ success: true });
    expect(await call("/settle", request(await payment("agreement")))).toMatchObject({ success: true });
    expect(sentTx).toHaveLength(2);
    // The second carries the agreement's nonce, the low 250 bits of its agreement value (the vectors' S7).
    expect(outsideIn(sentTx[1]!.invoke)[5]).toBe(big(V.S7.expectNonce));
  });

  it("answers a payment lcp refuses with lcp's code as x402's message, at /verify and at /settle", async () => {
    await serve();
    const p = withMessage(await payment(), (msg) => (msg["Caller"] = V.S8.rows[0].Caller));
    const code = V.S8.rows[0].expect.code;
    expect(await call("/verify", request(p))).toEqual({ isValid: false, invalidReason: "invalid_exact_starknet_payload_caller", invalidMessage: code });
    expect(await call("/settle", request(p))).toEqual({
      success: false,
      errorReason: "invalid_exact_starknet_payload_caller",
      errorMessage: code,
      transaction: "",
      network: NETWORK,
    });
  });
});

describe("lcp's vectors through the module (the contract's members)", () => {
  it("keys the payment and the agreement by the payer and the signed nonce the vectors give, kept to Execute Before", async () => {
    const m = await moduleOn();
    expect(await m.record.instrument({ payload: await payment(), requirements: O })).toEqual({
      pairing: "x402/exact/starknet",
      instrument: { by: "single-use", network: NETWORK, signer: V.S4.expectReference.from, value: V.S4.expectReference.nonce },
      nonce: "single-use",
      keep: { until: "lapse", at: V.S4.expectReference.settleBy * 1000 },
    });
    expect(await m.record.instrument({ payload: await payment("agreement"), requirements: O })).toMatchObject({
      instrument: { by: "single-use", signer: V.S7.reference.from, value: V.S7.expectNonce },
    });
    expect(calls).toEqual([]);
  });

  it("refuses each of lcp's refusal vectors with lcp's code, before any node call", async () => {
    const m = await moduleOn();
    const verifyWith = (p: PaymentPayload, r: PaymentRequirements = O) => m.facilitator.verify(p, r);
    const p = await payment();
    // S8: the Caller, the selector, and requirements other than the option accepted.
    expect(await verifyWith(withMessage(p, (msg) => (msg["Caller"] = V.S8.rows[0].Caller)))).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_starknet_payload_caller",
      invalidMessage: V.S8.rows[0].expect.code,
    });
    expect(await verifyWith(withMessage(p, (msg) => ((msg["Calls"] as { Selector: string }[])[0]!.Selector = V.S8.rows[1].Selector)))).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
      invalidMessage: V.S8.rows[1].expect.code,
    });
    expect(await verifyWith(p, V.S8.acceptedNotOption.option)).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: V.S8.acceptedNotOption.expect.code });
    // S4: a legal context whose H's low bits are not the nonce, and none.
    const other = structuredClone(p);
    (other.extensions!["legalContext"] as { info: { value: string } }).info.value = V.S4.boundWithEmptyHash.value;
    expect(await verifyWith(other)).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: V.S4.boundWithEmptyHash.expect.code });
    const bare = structuredClone(p);
    delete bare.extensions;
    expect(await verifyWith(bare)).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: V.S4.boundWithoutExtension.code });
    // The agreed refusals: an option the requirements' fault, a domain or a signature the payload's.
    let read = 0;
    for (const row of V.agreedRefusals.rows as { case: string; option?: PaymentRequirements; expect: string; revision?: number; chainId?: string; signatureLengths?: number[] }[]) {
      if (row.option !== undefined) {
        const r = await verifyWith({ ...p, accepted: row.option }, row.option);
        // An option on another network is no network the module is configured for: x402's first rule.
        expect(r, row.case).toEqual(row.option.network !== NETWORK ? { isValid: false, invalidReason: "invalid_network" } : { isValid: false, invalidReason: "invalid_payment_requirements", invalidMessage: row.expect });
        read++;
      } else if (row.revision !== undefined || row.chainId !== undefined) {
        const q = structuredClone(p);
        const domain = (q.payload as { outsideExecution: { typedData: { domain: Record<string, unknown> } } }).outsideExecution.typedData.domain;
        if (row.revision !== undefined) domain["revision"] = row.revision;
        if (row.chainId !== undefined) domain["chainId"] = row.chainId;
        expect(await verifyWith(q), row.case).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: row.expect });
        read++;
      } else if (row.signatureLengths !== undefined) {
        for (const n of row.signatureLengths) {
          const q = structuredClone(p);
          (q.payload as { outsideExecution: { signature: string[] } }).outsideExecution.signature = Array.from({ length: n }, () => "0x1");
          expect(await verifyWith(q), row.case).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: row.expect });
        }
        read++;
      }
    }
    expect(read).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});

describe("lcp's read vectors through the module's reader", () => {
  const queryOf = (q: { after?: string; search?: Record<string, string | number> }) => ({
    ...q,
    ...(q.after === undefined ? {} : { after: big(q.after) }),
    ...(q.search === undefined
      ? {}
      : { search: Object.fromEntries(Object.entries(q.search).map(([k, v]) => [k, k === "from" || k === "to" ? BigInt(v as string) : v])) }),
  });
  for (const row of V.S5.rows as { case: string; node: FixtureNode; query: never; expect: unknown; transaction?: string }[]) {
    it(`S5: ${row.case}`, async () => {
      chain.node = structuredClone(row.node);
      const url = await startNode();
      const reader = starknetNode(NETWORK, url).reader(performance.now() + 10_000);
      const ref = { ...V.S5.ref, ...(row.transaction === undefined ? {} : { transaction: row.transaction }) };
      expect(plain(await exactStarknet.status(ref, reader, queryOf(row.query) as never))).toEqual(row.expect);
    });
  }
  it(`S7: ${V.S7.status.case}`, async () => {
    chain.node = structuredClone(V.S7.status.node);
    const url = await startNode();
    const reader = starknetNode(NETWORK, url).reader(performance.now() + 10_000);
    expect(plain(await exactStarknet.status({ ...V.S7.reference, h: H }, reader, queryOf(V.S7.status.query) as never))).toEqual(V.S7.status.expect);
  });
});
