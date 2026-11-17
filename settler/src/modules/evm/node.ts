/**
 * The seller's EVM node, read over JSON-RPC: lcp's `EvmReader` for the pairings' reads, and the fee of a transaction
 * the module's key sent. Every call is bounded by the node call's own bounds and by the deadline the caller gives.
 */
import { ReaderError, type EvmLogEntry, type EvmReader, type EvmReceipt, type EvmTransaction, type Hex } from "@integraledger/lcp/evm";
import type { Eip155 } from "@integraledger/lcp/evm";
import { encodeFunctionData, serializeTransaction } from "viem";
import { NodeError, postJson } from "../../http.js";
import type { Charged, FeeNeeds } from "../../module.js";

const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function malformed(what: string): never {
  throw new ReaderError("malformed", `the node's ${what} is not one JSON-RPC defines`);
}

function quantity(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !HEX_QUANTITY.test(v)) malformed(what);
  return BigInt(v);
}

function data(v: unknown, what: string): Hex {
  if (typeof v !== "string" || !HEX_DATA.test(v)) malformed(what);
  return v.toLowerCase() as Hex;
}

function hex(v: bigint): string {
  return `0x${v.toString(16)}`;
}

/** A JSON-RPC error the node answered: the range of a log query it will not serve, history it does not hold, or other. */
function nodeRefused(e: unknown): Error {
  const code = isObject(e) ? e["code"] : undefined;
  const message = isObject(e) && typeof e["message"] === "string" ? e["message"] : "";
  if (code === -32005 || /range|too many|limit|exceed/i.test(message)) return new ReaderError("too-large", message);
  if (/missing trie node|pruned|history|not available|header not found/i.test(message)) return new ReaderError("history", message);
  return new ReaderError("transport", message || `JSON-RPC error ${String(code)}`);
}

/** One JSON-RPC call to `rpc` that ends by `deadline`, a `performance.now()` time. */
export async function rpcCall(rpc: string, method: string, params: readonly unknown[], deadline: number): Promise<unknown> {
  let answer: unknown;
  try {
    answer = await postJson(rpc, { jsonrpc: "2.0", id: 1, method, params }, deadline - performance.now());
  } catch (e) {
    if (e instanceof NodeError && (e.code === "malformed" || e.code === "too-large")) {
      throw new ReaderError(e.code === "too-large" ? "too-large" : "malformed", e.message);
    }
    throw new ReaderError(e instanceof NodeError && e.code === "timeout" ? "timeout" : "transport", String(e));
  }
  if (!isObject(answer)) malformed(method);
  if (answer["error"] !== undefined) throw nodeRefused(answer["error"]);
  if (!("result" in answer)) malformed(method);
  return answer["result"];
}

function logOf(l: unknown, what: string): { address: Hex; topics: Hex[]; data: Hex } {
  if (!isObject(l) || typeof l["address"] !== "string" || !ADDRESS.test(l["address"]) || !Array.isArray(l["topics"])) {
    malformed(what);
  }
  const topics = l["topics"].map((t) => {
    if (typeof t !== "string" || !HASH.test(t)) malformed(what);
    return t.toLowerCase() as Hex;
  });
  return { address: l["address"].toLowerCase() as Hex, topics, data: data(l["data"], what) };
}

/** The block tag of a read: a mark, or a number. */
function tag(at: "latest" | "safe" | "finalized" | bigint): string {
  return typeof at === "bigint" ? hex(at) : at;
}

/** lcp's reader of `network` over the JSON-RPC endpoint `rpc`, each call ending by `deadline`. */
export function evmReader(network: Eip155, rpc: string, deadline: number): EvmReader {
  const call = (method: string, params: readonly unknown[]) => rpcCall(rpc, method, params, deadline);
  const block = async (at: "latest" | "safe" | "finalized" | bigint) => {
    const b = await call("eth_getBlockByNumber", [tag(at), false]);
    if (b === null) throw new ReaderError("history", `no block ${tag(at)}`);
    if (!isObject(b)) malformed("block");
    return { number: quantity(b["number"], "block number"), timestamp: quantity(b["timestamp"], "block timestamp") };
  };
  return {
    network,
    async receipt(tx: Hex): Promise<EvmReceipt | null> {
      const r = await call("eth_getTransactionReceipt", [tx]);
      if (r === null) return null;
      if (!isObject(r) || !Array.isArray(r["logs"])) malformed("receipt");
      const status = quantity(r["status"], "receipt status");
      if (status !== 0n && status !== 1n) malformed("receipt status");
      return {
        status: status === 1n ? 1 : 0,
        blockNumber: quantity(r["blockNumber"], "receipt block"),
        logs: r["logs"].map((l) => logOf(l, "receipt log")),
      };
    },
    async blockNumber(mark: "safe" | "finalized"): Promise<bigint> {
      return (await block(mark)).number;
    },
    async transaction(tx: Hex): Promise<EvmTransaction | null> {
      const t = await call("eth_getTransactionByHash", [tx]);
      if (t === null) return null;
      if (!isObject(t) || typeof t["from"] !== "string" || !ADDRESS.test(t["from"])) malformed("transaction");
      const to = t["to"];
      if (to !== null && (typeof to !== "string" || !ADDRESS.test(to))) malformed("transaction");
      return {
        from: t["from"].toLowerCase() as Hex,
        to: to === null ? null : (to.toLowerCase() as Hex),
        input: data(t["input"], "transaction input"),
      };
    },
    async call(to: Hex, input: Hex, at: bigint): Promise<Hex> {
      return data(await call("eth_call", [{ to, data: input }, hex(at)]), "call result");
    },
    async logs(filter): Promise<readonly EvmLogEntry[]> {
      const params: Record<string, unknown> = {
        topics: filter.topics,
        fromBlock: hex(filter.fromBlock),
        toBlock: hex(filter.toBlock),
      };
      if (filter.address !== undefined) params["address"] = filter.address;
      const logs = await call("eth_getLogs", [params]);
      if (!Array.isArray(logs)) malformed("logs");
      return logs.map((l) => {
        if (!isObject(l) || typeof l["transactionHash"] !== "string" || !HASH.test(l["transactionHash"])) malformed("log");
        return {
          ...logOf(l, "log"),
          transactionHash: l["transactionHash"].toLowerCase() as Hex,
          blockNumber: quantity(l["blockNumber"], "log block"),
          logIndex: Number(quantity(l["logIndex"], "log index")),
        };
      });
    },
    block,
  };
}

/** The OP Stack's GasPriceOracle predeploy, as viem's `op-stack` contracts name it. */
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const GET_L1_FEE = [
  { type: "function", name: "getL1Fee", stateMutability: "view", inputs: [{ name: "_data", type: "bytes" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * The L1 data fee the transaction `t`, as the node answers it unmined, would pay now on an OP Stack chain: the
 * GasPriceOracle's `getL1Fee` over its serialized form, as viem's `estimateL1Fee` asks it. 0 where the call answers no
 * one word, as on a chain with no such predeploy, or the node refuses it.
 */
async function l1FeeNow(rpc: string, t: Record<string, unknown>, deadline: number): Promise<bigint> {
  try {
    const optional = (v: unknown, what: string) => (v === undefined || v === null ? undefined : quantity(v, what));
    const serialized = serializeTransaction({
      type: "eip1559",
      chainId: Number(quantity(t["chainId"], "chain id")),
      nonce: Number(quantity(t["nonce"], "nonce")),
      gas: quantity(t["gas"], "gas limit"),
      maxFeePerGas: quantity(t["maxFeePerGas"] ?? t["gasPrice"], "fee cap"),
      maxPriorityFeePerGas: optional(t["maxPriorityFeePerGas"], "priority fee") ?? 0n,
      ...(typeof t["to"] === "string" ? { to: t["to"] as Hex } : {}),
      value: optional(t["value"], "value") ?? 0n,
      data: data(t["input"] ?? "0x", "input"),
    });
    const call = encodeFunctionData({ abi: GET_L1_FEE, functionName: "getL1Fee", args: [serialized] });
    const word = await rpcCall(rpc, "eth_call", [{ to: GAS_PRICE_ORACLE, data: call }, "latest"], deadline);
    return typeof word === "string" && HASH.test(word) ? BigInt(word) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * What a transaction the module's key sent costs it, in wei: once the node shows its receipt, the fee it paid, the gas
 * used times the effective gas price, and on an OP Stack chain the L1 data fee the receipt shows (`l1Fee`), which the
 * key pays beside it; until then the most it can pay, its gas limit times its fee cap (or its gas price, for a
 * transaction of a type that has no cap), and the L1 data fee it would pay now. Undefined where the node holds neither.
 */
export async function transactionFee(
  rpc: string,
  transaction: Hex,
  deadline: number,
): Promise<{ readonly included: bigint } | { readonly bound: bigint } | undefined> {
  const r = await rpcCall(rpc, "eth_getTransactionReceipt", [transaction], deadline);
  if (r !== null) {
    if (!isObject(r)) malformed("receipt");
    const l1 = r["l1Fee"] === undefined || r["l1Fee"] === null ? 0n : quantity(r["l1Fee"], "L1 fee");
    return { included: quantity(r["gasUsed"], "gas used") * quantity(r["effectiveGasPrice"], "effective gas price") + l1 };
  }
  const t = await rpcCall(rpc, "eth_getTransactionByHash", [transaction], deadline);
  if (t === null) return undefined;
  if (!isObject(t)) malformed("transaction");
  const cap = t["maxFeePerGas"] ?? t["gasPrice"];
  return { bound: quantity(t["gas"], "gas limit") * quantity(cap, "fee cap") + (await l1FeeNow(rpc, t, deadline)) };
}

/** `transactionFee` as the fee count takes it: what was paid once included, the bound until then. */
export async function feeShown(rpc: string, transaction: string, deadline: number): Promise<Charged | undefined> {
  const fee = await transactionFee(rpc, transaction as Hex, deadline);
  if (fee === undefined) return undefined;
  return "included" in fee ? { fee: fee.included, included: true } : { fee: fee.bound, included: false };
}

/**
 * The fee budget's read of a transaction a class sent, from the module's node: the fee the chain shows once included,
 * its own bound until then. A transaction the node holds neither as sent nor as included rejects.
 */
export function chargedFrom(rpc: string): NonNullable<FeeNeeds["charged"]> {
  return async (_payment, sent) => {
    const shown = await feeShown(rpc, sent.transaction, sent.deadline);
    if (shown === undefined) throw new Error(`the node holds no transaction ${sent.transaction}`);
    return shown;
  };
}
