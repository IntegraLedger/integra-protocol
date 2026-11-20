/**
 * The NEAR module for `x402/exact/near` on each configured network: `@x402/near` 2.31.0's facilitator class,
 * registered unchanged. The payer signs a NEP-366 delegate action; the seller's relayer account wraps it in a
 * transaction of its own, which it signs and whose gas and one-yoctoNEAR deposit it pays (`extra.key` `relayer`). The
 * relayer reaches the module as the `FacilitatorNearSigner` the class takes, and its account is in `signers`. lcp's
 * checks name the instrument, the payer's access key and its nonce; lcp's read goes through the seller's RPC node.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import {
  exactNear,
  type NearKeyChange,
  type NearKeyChanges,
  type NearMark,
  type NearNetwork,
  type NearOutcome,
  type NearReader,
  type NearRef,
} from "@integraledger/lcp/near";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { Network } from "@x402/core/types";
import type { FacilitatorNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import { isObject } from "../../answers.js";
import { NodeError, postJson } from "../../http.js";
import { outcomeOf, type Instrumented, type Module, type ModuleStarter, type Refused, type Registration, type X402Payment } from "../../module.js";

export interface NearConfig {
  /** The network, exactly one. */
  readonly network: NearNetwork;
  /** The seller's relayer account and key, with its RPC node, as `@x402/near`'s facilitator class takes them. */
  readonly signer: FacilitatorNearSigner;
  /** The seller's RPC node, which lcp's read and the fee count use. */
  readonly rpc: string;
}

function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "near/option-malformed") return "invalid_payment_requirements";
  return "invalid_payload";
}

async function checked(p: X402Payment): Promise<NearRef | Refusal> {
  const bound = await exactNear.bound(p.payload);
  if (isRefusal(bound)) return bound;
  // The requirements arrive as JSON, which lcp's option type names.
  return exactNear.reference(p.payload, p.requirements as LcpOption);
}

/** The error's cause name, where the RPC answered one: `UNKNOWN_ACCESS_KEY`, `UNKNOWN_BLOCK`, `GARBAGE_COLLECTED_BLOCK`. */
function causeOf(error: unknown): string | undefined {
  const cause = isObject(error) ? error["cause"] : undefined;
  return isObject(cause) && typeof cause["name"] === "string" ? cause["name"] : undefined;
}

function height(v: unknown): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new NodeError("malformed", true, "a block height");
}

/** lcp's reader over the RPC node at `url`, its calls ending by `deadline`. */
export function nearReader(network: NearNetwork, url: string, deadline: number): NearReader {
  let id = 0;
  async function rpc(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }> {
    const a = await postJson(url, { jsonrpc: "2.0", id: ++id, method, params }, deadline - performance.now());
    if (!isObject(a)) throw new NodeError("malformed", true, method);
    // `query` answers some errors inside its result, as `error` beside the block it read.
    const inner = isObject(a["result"]) && typeof a["result"]["error"] === "string" ? { name: a["result"]["error"] } : undefined;
    if (a["error"] !== undefined || inner !== undefined) return { error: a["error"] ?? { cause: { name: /does not exist/.test(inner!.name) ? "UNKNOWN_ACCESS_KEY" : inner!.name } } };
    return { result: a["result"] };
  }
  async function blockHeight(hash: string): Promise<bigint | undefined> {
    const a = await rpc("block", { block_id: hash });
    const header = isObject(a.result) ? a.result["header"] : undefined;
    return isObject(header) ? height(header["height"]) : undefined;
  }
  /** One block's changes of `type` for the account, or `none` where no block is at the height, `missing` where the node pruned it. */
  async function changesAt(h: bigint, params: object): Promise<NearKeyChange[] | "none" | "missing"> {
    const a = await rpc("EXPERIMENTAL_changes", { block_id: Number(h), ...params });
    if (a.error !== undefined) {
      const cause = causeOf(a.error);
      if (cause === "GARBAGE_COLLECTED_BLOCK") return "missing";
      if (cause === "UNKNOWN_BLOCK") return "none";
      throw new NodeError("http-status", true, `changes: ${cause ?? "error"}`);
    }
    const changes = isObject(a.result) && Array.isArray(a.result["changes"]) ? a.result["changes"] : [];
    return changes.filter(isObject).map((c) => {
      const change = isObject(c["change"]) ? c["change"] : {};
      const cause = isObject(c["cause"]) ? c["cause"] : {};
      const key = change["access_key"];
      const nonce = c["type"] === "access_key_deletion" ? null : isObject(key) ? key["nonce"] : undefined;
      if (typeof change["public_key"] !== "string" || (nonce !== null && typeof nonce !== "number")) throw new NodeError("malformed", true, "a key change");
      const tx = cause["type"] === "transaction_processing" && typeof cause["tx_hash"] === "string" ? cause["tx_hash"] : undefined;
      return {
        height: h,
        publicKey: change["public_key"],
        nonce: nonce === null ? null : BigInt(nonce),
        ...(tx === undefined || typeof change["account_id"] !== "string" ? {} : { transaction: { hash: tx, signer: change["account_id"] } }),
      };
    });
  }
  async function finalHeight(): Promise<bigint> {
    const a = await rpc("block", { finality: "final" });
    const header = isObject(a.result) ? a.result["header"] : undefined;
    if (!isObject(header)) throw new NodeError("malformed", true, "the final block");
    return height(header["height"]);
  }
  /** Block by block from `from` to `to`, as far as the deadline lets the read go. */
  async function range(from: bigint, to: bigint, params: object): Promise<NearKeyChanges> {
    const changes: NearKeyChange[] = [];
    let through = from - 1n;
    for (let h = from; h <= to; h++) {
      if (deadline - performance.now() <= 0) break;
      const at = await changesAt(h, params);
      if (at === "missing" || (at === "none" && h === from)) {
        if (h === from) return { history: "missing" };
        break;
      }
      if (at !== "none") changes.push(...at);
      through = h;
    }
    return { changes, through };
  }
  return {
    network,
    async txStatus(txHash, sender): Promise<NearOutcome | null> {
      const a = await rpc("EXPERIMENTAL_tx_status", { tx_hash: txHash, ...(sender === undefined ? {} : { sender_account_id: sender }), wait_until: "NONE" });
      if (a.error !== undefined) {
        if (causeOf(a.error) === "UNKNOWN_TRANSACTION") return null;
        throw new NodeError("http-status", true, `tx status: ${causeOf(a.error) ?? "error"}`);
      }
      const r = a.result;
      if (!isObject(r)) throw new NodeError("malformed", true, "a transaction status");
      const tx = isObject(r["transaction"]) ? r["transaction"] : {};
      const action = Array.isArray(tx["actions"]) ? tx["actions"][0] : undefined;
      const d = isObject(action) && isObject(action["Delegate"]) && isObject(action["Delegate"]["delegate_action"]) ? action["Delegate"]["delegate_action"] : undefined;
      const receipts = [];
      for (const o of Array.isArray(r["receipts_outcome"]) ? r["receipts_outcome"].filter(isObject) : []) {
        const outcome = isObject(o["outcome"]) ? o["outcome"] : {};
        const status = isObject(outcome["status"]) ? outcome["status"] : {};
        const state = "Failure" in status ? "failure" : "SuccessValue" in status || "SuccessReceiptId" in status ? "success" : "pending";
        const at = state !== "pending" && typeof o["block_hash"] === "string" ? await blockHeight(o["block_hash"]) : undefined;
        receipts.push({ id: String(o["id"]), executor: String(outcome["executor_id"]), outcome: state as "success" | "failure" | "pending", ...(at === undefined ? {} : { height: at }) });
      }
      return {
        status: typeof r["final_execution_status"] === "string" ? r["final_execution_status"] : "",
        delegate:
          d === undefined
            ? null
            : {
                senderId: String(d["sender_id"]),
                publicKey: String(d["public_key"]),
                nonce: BigInt(d["nonce"] as number),
                maxBlockHeight: BigInt(d["max_block_height"] as number),
                receiverId: String(d["receiver_id"]),
                actions: (Array.isArray(d["actions"]) ? d["actions"] : []).map((x) => {
                  const f = isObject(x) && isObject(x["FunctionCall"]) ? x["FunctionCall"] : undefined;
                  return f === undefined
                    ? null
                    : { methodName: String(f["method_name"]), argsBase64: String(f["args"]), gas: BigInt(f["gas"] as number), deposit: BigInt(String(f["deposit"])) };
                }),
              },
        receipts,
      };
    },
    finalHeight,
    async accessKeyNonce(account, publicKey, finality: NearMark) {
      const a = await rpc("query", { request_type: "view_access_key", finality: finality === "final" ? "final" : "optimistic", account_id: account, public_key: publicKey });
      if (a.error !== undefined) {
        if (causeOf(a.error) !== "UNKNOWN_ACCESS_KEY") throw new NodeError("http-status", true, `view_access_key: ${causeOf(a.error) ?? "error"}`);
        const at = isObject(a.error) && isObject(a.error["cause"]) && isObject(a.error["cause"]["info"]) ? a.error["cause"]["info"]["block_height"] : undefined;
        return { nonce: null, blockHeight: at === undefined ? await finalHeight() : height(at) };
      }
      const r = a.result;
      if (!isObject(r) || typeof r["nonce"] !== "number") throw new NodeError("malformed", true, "an access key");
      return { nonce: BigInt(r["nonce"]), blockHeight: height(r["block_height"]) };
    },
    async accessKeyChanges(account, publicKey, from, to) {
      return range(from, to, { changes_type: "single_access_key_changes", keys: [{ account_id: account, public_key: publicKey }] });
    },
    async accountKeyChanges(account, from, to) {
      return range(from, to, { changes_type: "all_access_key_changes", account_ids: [account] });
    },
  };
}

/** The module of `x402/exact/near` on the configured network. */
export function nearModule(c: NearConfig): Module {
  const network = c.network as Network;
  return {
    // The standard token refuses a zero ft_transfer, so the kind does not take zero.
    descriptor: { name: "near", key: "relayer", pairings: [exactNear.id], acceptsZero: [] },
    network,
    facilitator: new ExactNearScheme(c.signer),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await checked(p);
        if (isRefusal(ref)) return { refused: reasonOf(ref) };
        return {
          pairing: exactNear.id,
          // The access key's nonce is single-use for that key of the sender's account.
          instrument: { by: "single-use", network, signer: ref.payer, scope: ref.publicKey, value: ref.nonce },
          nonce: exactNear.data.nonce,
          // Its life ends at max_block_height, a height, which no clock bounds from above.
          keep: { until: "settler" },
        };
      },
      async position(_p, at) {
        return nearReader(c.network, c.rpc, at.deadline).finalHeight();
      },
      async read(p, at) {
        const ref = await checked(p);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const search = at.search as bigint | undefined;
        const after = at.from as bigint | undefined;
        return outcomeOf(
          await exactNear.status(at.transaction === undefined ? ref : { ...ref, transaction: at.transaction }, nearReader(c.network, c.rpc, at.deadline), {
            act: "payment",
            finality: "final",
            ...(search === undefined ? {} : { search }),
            ...(after === undefined ? {} : { after }),
          }),
        );
      },
    },
    fees: {
      // The relayer pays the gas of every transaction it sends.
      paysFee: () => true,
      payerBroadcast: () => false,
      async charged(_p, sent) {
        // The gas the relayer's transaction burnt, its own and its receipts', as the node's outcome shows it.
        const a = await postJson(
          c.rpc,
          { jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: sent.transaction, sender_account_id: c.signer.getRelayerIds()[0], wait_until: "NONE" } },
          sent.deadline - performance.now(),
        );
        const r = isObject(a) ? a["result"] : undefined;
        const outcomes = isObject(r) ? [r["transaction_outcome"], ...(Array.isArray(r["receipts_outcome"]) ? r["receipts_outcome"] : [])] : [];
        let fee = 0n;
        for (const o of outcomes) {
          const burnt = isObject(o) && isObject(o["outcome"]) ? o["outcome"]["tokens_burnt"] : undefined;
          if (typeof burnt !== "string" || !/^\d+$/.test(burnt)) throw new NodeError("malformed", true, "tokens_burnt");
          fee += BigInt(burnt);
        }
        if (outcomes.length === 0) throw new NodeError("malformed", true, "a transaction status");
        return { fee, included: true };
      },
    },
  };
}

export function nearRegistration(c: NearConfig): Registration {
  return { network: c.network as Network, module: nearModule(c), own: [] };
}

/** The module's start: one registration of `exact` per configured network. */
export const starter: ModuleStarter<readonly NearConfig[]> = {
  name: "near",
  async start(config) {
    return { registrations: config.map(nearRegistration) };
  },
};
