/**
 * The seller's Starknet node, over Starknet's JSON-RPC (specification 0.9 or later, whose block tags are `latest`,
 * `pre_confirmed` and `l1_accepted`): the calls the module's checks and its settlement make, and the reader lcp's
 * `x402/exact/starknet` read takes. Every call is bounded by the node bound of `../../http.js` and by its deadline.
 */
import {
  FELT_P,
  type Felt,
  type StarknetEventPage,
  type StarknetEventQuery,
  type StarknetHead,
  type StarknetInvocation,
  type StarknetMark,
  type StarknetNetwork,
  type StarknetReader,
  type StarknetReceipt,
} from "@integraledger/lcp/starknet";
import { isObject } from "../../answers.js";
import { NodeError, postJson } from "../../http.js";

/** A JSON-RPC error the node answered: the request reached it, and it refused it with this code. */
export class RpcFault extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${code}: ${message}`);
  }
}

/** Starknet JSON-RPC error codes the module reads (the specification's `starknet_api_openrpc.json`). */
export const RPC = {
  CONTRACT_NOT_FOUND: 20,
  ENTRYPOINT_NOT_FOUND: 21,
  BLOCK_NOT_FOUND: 24,
  TXN_HASH_NOT_FOUND: 29,
  CONTRACT_ERROR: 40,
  TRANSACTION_EXECUTION_ERROR: 41,
} as const;

const FELT = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * A felt in its shortest lowercase spelling, or undefined for a value that is not `0x` and 1 to 64 hex digits below the
 * STARK prime.
 */
export function felt(v: unknown): Felt | undefined {
  if (typeof v !== "string" || !FELT.test(v)) return undefined;
  const n = BigInt(v);
  return n < FELT_P ? `0x${n.toString(16)}` : undefined;
}

/** A felt in its shortest spelling where it is one, else the value as given. */
function loose(v: unknown): unknown {
  return felt(v) ?? v;
}

function felts(v: unknown): Felt[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Felt[] = [];
  for (const x of v) {
    const f = felt(x);
    if (f === undefined) return undefined;
    out.push(f);
  }
  return out;
}

/** One block a call reads: a tag, or a number. */
export type BlockId = "latest" | "pre_confirmed" | "l1_accepted" | { block_number: number };

/** An event of a receipt or a trace, as the node gives it. */
export interface NodeEvent {
  from: Felt;
  keys: Felt[];
  data: Felt[];
}

/** A receipt as the module reads it: lcp's receipt and the fee the transaction paid, in the fee token's smallest unit. */
export interface NodeReceipt extends StarknetReceipt {
  fee: bigint;
}

/** What one simulation of the settlement shows: its execution, the events by the contract that emitted them, and its fee. */
export interface Simulated {
  reverted: boolean;
  events: NodeEvent[];
  fee: { l1Gas: bigint; l1GasPrice: bigint; l2Gas: bigint; l2GasPrice: bigint; l1DataGas: bigint; l1DataGasPrice: bigint };
}

export interface StarknetNode {
  readonly network: StarknetNetwork;
  call(contract: Felt, entrypoint: Felt, calldata: readonly Felt[], block: BlockId, deadline: number): Promise<Felt[]>;
  classHashAt(contract: Felt, deadline: number): Promise<Felt>;
  nonce(account: Felt, block: BlockId, deadline: number): Promise<bigint>;
  head(mark: StarknetMark, deadline: number): Promise<StarknetHead>;
  receipt(tx: Felt, deadline: number): Promise<NodeReceipt | null>;
  trace(tx: Felt, deadline: number): Promise<StarknetInvocation | null>;
  events(query: StarknetEventQuery, deadline: number): Promise<StarknetEventPage | null>;
  simulate(invoke: Record<string, unknown>, deadline: number): Promise<Simulated>;
  add(invoke: Record<string, unknown>, deadline: number): Promise<Felt>;
  /** lcp's reader over this node, its calls ending by `deadline`. */
  reader(deadline: number): StarknetReader;
}

/** The most events one page of `starknet_getEvents` asks for: lcp reads at most 1024 in a page. */
const CHUNK = 1_000;

export function starknetNode(network: StarknetNetwork, url: string): StarknetNode {
  let id = 0;
  async function rpc(method: string, params: Record<string, unknown>, deadline: number): Promise<unknown> {
    id += 1;
    const answer = await postJson(url, { jsonrpc: "2.0", id, method, params }, deadline - performance.now());
    if (!isObject(answer)) throw new NodeError("malformed", true, `${method}: not an object`);
    const error = answer["error"];
    if (isObject(error)) {
      const code = error["code"];
      throw new RpcFault(typeof code === "number" ? code : -1, String(error["message"] ?? ""), error["data"]);
    }
    if (!("result" in answer)) throw new NodeError("malformed", true, `${method}: no result`);
    return answer["result"];
  }
  const malformed = (what: string) => new NodeError("malformed", true, what);

  function receiptOf(r: unknown): NodeReceipt {
    if (!isObject(r)) throw malformed("receipt");
    const finality = r["finality_status"];
    const execution = r["execution_status"];
    if (finality !== "PRE_CONFIRMED" && finality !== "ACCEPTED_ON_L2" && finality !== "ACCEPTED_ON_L1") throw malformed("finality");
    if (execution !== "SUCCEEDED" && execution !== "REVERTED") throw malformed("execution");
    const number = r["block_number"];
    if (number !== undefined && number !== null && !Number.isSafeInteger(number)) throw malformed("block_number");
    const events: NodeEvent[] = [];
    if (!Array.isArray(r["events"])) throw malformed("events");
    for (const e of r["events"] as unknown[]) events.push(eventOf(e, "from_address"));
    const actual = r["actual_fee"];
    const amount = isObject(actual) ? felt(actual["amount"]) : undefined;
    if (amount === undefined) throw malformed("actual_fee");
    return {
      finality,
      execution,
      blockNumber: typeof number === "number" ? BigInt(number) : null,
      events: events.map((e) => ({ fromAddress: e.from, keys: e.keys, data: e.data })),
      fee: BigInt(amount),
    };
  }

  function eventOf(e: unknown, emitter: string, from?: Felt): NodeEvent {
    if (!isObject(e)) throw malformed("event");
    const address = from ?? felt(e[emitter]);
    const keys = felts(e["keys"]);
    const data = felts(e["data"]);
    if (address === undefined || keys === undefined || data === undefined) throw malformed("event");
    return { from: address, keys, data };
  }

  /**
   * A `FUNCTION_INVOCATION` as lcp's reader gives it, its members renamed and left as the node gave them, so that lcp
   * judges one that is not well formed; a whole execution that reverted is one reverted invocation. Below 32 levels,
   * deeper than lcp reads, its calls are not mapped.
   */
  function invocationOf(v: unknown, depth = 1): StarknetInvocation {
    if (!isObject(v)) return v as never;
    if (typeof v["revert_reason"] === "string" && v["contract_address"] === undefined) {
      return { contract: "0x0", selector: "0x0", calldata: [], reverted: true, calls: [] };
    }
    const calls = v["calls"];
    return {
      contract: loose(v["contract_address"]),
      selector: loose(v["entry_point_selector"]),
      calldata: Array.isArray(v["calldata"]) ? v["calldata"].map(loose) : v["calldata"],
      reverted: v["is_reverted"],
      calls: Array.isArray(calls) ? (depth >= 32 ? [] : calls.map((c) => invocationOf(c, depth + 1))) : calls,
    } as never;
  }

  /** A receipt as lcp's reader gives it, renamed and left as the node gave it. */
  function looseReceipt(r: unknown): StarknetReceipt {
    if (!isObject(r)) return r as never;
    const number = r["block_number"];
    const events = r["events"];
    return {
      finality: r["finality_status"],
      execution: r["execution_status"],
      blockNumber: typeof number === "number" && Number.isSafeInteger(number) ? BigInt(number) : number === undefined ? null : number,
      events: Array.isArray(events) ? events.map(looseEvent) : events,
    } as never;
  }

  function looseEvent(e: unknown): Record<string, unknown> {
    if (!isObject(e)) return e as never;
    const keys = e["keys"];
    const data = e["data"];
    return {
      fromAddress: loose(e["from_address"]),
      keys: Array.isArray(keys) ? keys.map(loose) : keys,
      data: Array.isArray(data) ? data.map(loose) : data,
    };
  }

  /** Every event of a simulated execution, each with the contract whose invocation emitted it, in no order. */
  function eventsOf(v: unknown, out: NodeEvent[], depth = 0): void {
    if (!isObject(v) || depth > 64) throw malformed("invocation");
    const contract = felt(v["contract_address"]);
    if (contract === undefined || !Array.isArray(v["calls"]) || !Array.isArray(v["events"] ?? [])) throw malformed("invocation");
    if (v["is_reverted"] === true) return;
    for (const e of (v["events"] ?? []) as unknown[]) out.push(eventOf(e, "", contract));
    for (const c of v["calls"] as unknown[]) eventsOf(c, out, depth + 1);
  }

  async function rawReceipt(tx: Felt, deadline: number): Promise<unknown> {
    try {
      return await rpc("starknet_getTransactionReceipt", { transaction_hash: tx }, deadline);
    } catch (e) {
      if (e instanceof RpcFault && e.code === RPC.TXN_HASH_NOT_FOUND) return null;
      throw e;
    }
  }

  const asBig = (v: unknown, what: string): bigint => {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
    const f = felt(v);
    if (f === undefined) throw malformed(what);
    return BigInt(f);
  };

  const node: StarknetNode = {
    network,
    async call(contract, entrypoint, calldata, block, deadline) {
      const r = await rpc(
        "starknet_call",
        { request: { contract_address: contract, entry_point_selector: entrypoint, calldata }, block_id: block },
        deadline,
      );
      const out = felts(r);
      if (out === undefined) throw malformed("starknet_call");
      return out;
    },
    async classHashAt(contract, deadline) {
      const r = felt(await rpc("starknet_getClassHashAt", { block_id: "latest", contract_address: contract }, deadline));
      if (r === undefined) throw malformed("starknet_getClassHashAt");
      return r;
    },
    async nonce(account, block, deadline) {
      return asBig(await rpc("starknet_getNonce", { block_id: block, contract_address: account }, deadline), "nonce");
    },
    async head(mark, deadline) {
      const tag = mark === "ACCEPTED_ON_L1" ? "l1_accepted" : "latest";
      const b = await rpc("starknet_getBlockWithTxHashes", { block_id: tag }, deadline);
      if (!isObject(b) || !Number.isSafeInteger(b["block_number"]) || !Number.isSafeInteger(b["timestamp"])) {
        throw malformed("block header");
      }
      return { number: BigInt(b["block_number"] as number), timestamp: BigInt(b["timestamp"] as number) };
    },
    async receipt(tx, deadline) {
      const r = await rawReceipt(tx, deadline);
      return r === null ? null : receiptOf(r);
    },
    async trace(tx, deadline) {
      let t: unknown;
      try {
        t = await rpc("starknet_traceTransaction", { transaction_hash: tx }, deadline);
      } catch (e) {
        if (e instanceof RpcFault && e.code === RPC.TXN_HASH_NOT_FOUND) return null;
        throw e;
      }
      if (!isObject(t)) throw malformed("trace");
      const execute = t["execute_invocation"];
      return execute === undefined || execute === null ? null : invocationOf(execute);
    },
    async events(q, deadline) {
      let r: unknown;
      try {
        r = await rpc(
          "starknet_getEvents",
          {
            filter: {
              from_block: { block_number: Number(q.from) },
              to_block: { block_number: Number(q.to) },
              address: q.address,
              keys: q.keys,
              chunk_size: CHUNK,
              ...(q.continuation === undefined ? {} : { continuation_token: q.continuation }),
            },
          },
          deadline,
        );
      } catch (e) {
        if (e instanceof RpcFault && e.code === RPC.BLOCK_NOT_FOUND) return null;
        throw e;
      }
      if (!isObject(r) || !Array.isArray(r["events"])) throw malformed("starknet_getEvents");
      const events = (r["events"] as unknown[]).map((e) => {
        if (!isObject(e)) return e;
        const block = e["block_number"];
        return {
          ...looseEvent(e),
          transaction: loose(e["transaction_hash"]),
          blockNumber: typeof block === "number" && Number.isSafeInteger(block) ? BigInt(block) : block === undefined ? null : block,
        };
      }) as never;
      const token = r["continuation_token"];
      return { events, continuation: typeof token === "string" && token !== "" ? token : null };
    },
    async simulate(invoke, deadline) {
      const r = await rpc(
        "starknet_simulateTransactions",
        { block_id: "latest", transactions: [invoke], simulation_flags: ["SKIP_VALIDATE", "SKIP_FEE_CHARGE"] },
        deadline,
      );
      const first = Array.isArray(r) ? r[0] : undefined;
      if (!isObject(first) || !isObject(first["transaction_trace"]) || !isObject(first["fee_estimation"])) {
        throw malformed("starknet_simulateTransactions");
      }
      const execute = first["transaction_trace"]["execute_invocation"];
      const fee = first["fee_estimation"];
      const reverted = !isObject(execute) || typeof execute["revert_reason"] === "string" || execute["is_reverted"] === true;
      const events: NodeEvent[] = [];
      if (!reverted) eventsOf(execute, events);
      return {
        reverted,
        events,
        fee: {
          l1Gas: asBig(fee["l1_gas_consumed"], "l1_gas_consumed"),
          l1GasPrice: asBig(fee["l1_gas_price"], "l1_gas_price"),
          l2Gas: asBig(fee["l2_gas_consumed"], "l2_gas_consumed"),
          l2GasPrice: asBig(fee["l2_gas_price"], "l2_gas_price"),
          l1DataGas: asBig(fee["l1_data_gas_consumed"], "l1_data_gas_consumed"),
          l1DataGasPrice: asBig(fee["l1_data_gas_price"], "l1_data_gas_price"),
        },
      };
    },
    async add(invoke, deadline) {
      const r = await rpc("starknet_addInvokeTransaction", { invoke_transaction: invoke }, deadline);
      const hash = isObject(r) ? felt(r["transaction_hash"]) : undefined;
      if (hash === undefined) throw malformed("starknet_addInvokeTransaction");
      return hash;
    },
    reader(deadline) {
      return {
        network,
        async receipt(tx) {
          const r = await rawReceipt(tx, deadline);
          return r === null ? null : looseReceipt(r);
        },
        trace: (tx) => node.trace(tx, deadline),
        head: (mark) => node.head(mark, deadline),
        async nonceValid(account, nonce, block) {
          let out: Felt[];
          try {
            out = await node.call(account, IS_VALID_NONCE, [nonce], { block_number: Number(block) }, deadline);
          } catch (e) {
            // A block whose state the node does not serve: lcp reads it as a history gap.
            if (e instanceof RpcFault && e.code === RPC.BLOCK_NOT_FOUND) return null;
            throw e;
          }
          if (out.length !== 1 || (out[0] !== "0x0" && out[0] !== "0x1")) throw malformed("is_valid_outside_execution_nonce");
          return out[0] === "0x1";
        },
        events: (q) => node.events(q, deadline),
      };
    },
  };
  return node;
}

/** sn_keccak("is_valid_outside_execution_nonce") */
export const IS_VALID_NONCE: Felt = "0x1e6d35df2b9d989fb4b6bbcebda1314e4254cbe5e589dd94ff4f29ea935e91c";
/** sn_keccak("is_valid_signature") */
export const IS_VALID_SIGNATURE: Felt = "0x28420862938116cb3bbdbedee07451ccc54d4e9412dbef71142ad1980a30941";
/** sn_keccak("balance_of") */
export const BALANCE_OF: Felt = "0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33";
/** sn_keccak("balanceOf") */
export const BALANCE_OF_CAMEL: Felt = "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e";
/** SNIP-6's `VALID`, the short string `VALID`. */
export const VALID: Felt = "0x56414c4944";
