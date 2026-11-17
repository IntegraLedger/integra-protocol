/**
 * A Stellar RPC node: JSON-RPC 2.0 over HTTP, the methods `getNetwork`, `getLatestLedger`, `getLedgerEntries`,
 * `simulateTransaction`, `sendTransaction`, `getTransaction` and `getEvents` (Stellar RPC's API reference), each call
 * bounded as every node call of the settler is and ending by its caller's deadline; and lcp's `StellarReader` over it.
 */
import type { StellarEventRow, StellarReader } from "@integraledger/lcp/stellar";
import { Keypair, xdr } from "@stellar/stellar-sdk/base";
import { isObject } from "../../answers.js";
import { NodeError, postJson } from "../../http.js";

/** A JSON-RPC error the node answered: it read the request and refused it. */
export class RpcFault extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** `simulateTransaction`'s answer, as the module reads it. */
export type Simulated =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      /** The smallest resource fee the transaction needs, in stroops. */
      readonly minResourceFee: bigint;
      /** The `SorobanTransactionData` the transaction is to carry, base64. */
      readonly transactionData: string;
      /** Each `DiagnosticEvent` the simulation emitted, base64. */
      readonly events: readonly string[];
    };

/** `sendTransaction`'s answer. */
export interface Sent {
  readonly status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR";
  readonly hash: string;
  /** For `ERROR`: the `TransactionResult` the node refused it with, base64. */
  readonly errorResultXdr?: string;
}

/** `getTransaction`'s answer. */
export interface Got {
  readonly status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  readonly ledger?: number;
  readonly applicationOrder?: number;
  readonly envelopeXdr?: string;
  /** The `TransactionResult`, base64, which holds the fee charged. */
  readonly resultXdr?: string;
  readonly oldestLedger: number;
  readonly latestLedger: number;
}

/** The events one `getEvents` page asks for: Stellar RPC's default page, which its documentation states as 100. */
const PAGE = 100;

const isLedger = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

export interface StellarNode {
  passphrase(deadline: number): Promise<string>;
  latestLedger(deadline: number): Promise<{ sequence: number; closeTime?: number }>;
  /** An account's sequence number, or null where the account does not exist. */
  sequence(account: string, deadline: number): Promise<bigint | null>;
  simulate(transaction: string, deadline: number): Promise<Simulated>;
  send(transaction: string, deadline: number): Promise<Sent>;
  transaction(hash: string, deadline: number): Promise<Got>;
  /** lcp's reader over this node, each of its calls ending by `deadline`. */
  reader(deadline: number): StellarReader;
}

export function stellarNode(url: string): StellarNode {
  let id = 0;
  async function call(method: string, params: unknown, deadline: number): Promise<Record<string, unknown>> {
    const answer = await postJson(url, { jsonrpc: "2.0", id: ++id, method, params }, deadline - performance.now());
    if (!isObject(answer)) throw new NodeError("malformed", true, method);
    const error = answer["error"];
    if (isObject(error)) throw new RpcFault(Number(error["code"]), String(error["message"]));
    const result = answer["result"];
    if (!isObject(result)) throw new NodeError("malformed", true, method);
    return result;
  }
  const malformed = (method: string): never => {
    throw new NodeError("malformed", true, method);
  };

  const node: StellarNode = {
    async passphrase(deadline) {
      const r = await call("getNetwork", {}, deadline);
      return typeof r["passphrase"] === "string" ? r["passphrase"] : malformed("getNetwork");
    },
    async latestLedger(deadline) {
      const r = await call("getLatestLedger", {}, deadline);
      if (!isLedger(r["sequence"])) return malformed("getLatestLedger");
      const close = Number(r["closeTime"]);
      return { sequence: r["sequence"], ...(Number.isSafeInteger(close) ? { closeTime: close } : {}) };
    },
    async sequence(account, deadline) {
      const key = xdr.LedgerKey.fromXdrObject({ type: 0, account: { accountId: { type: 0, ed25519: Keypair.fromPublicKey(account).rawPublicKey() } } });
      const r = await call("getLedgerEntries", { keys: [key.toXdr("base64")] }, deadline);
      const entries = r["entries"];
      if (entries === undefined || entries === null || (Array.isArray(entries) && entries.length === 0)) return null;
      if (!Array.isArray(entries) || entries.length !== 1 || !isObject(entries[0]) || typeof entries[0]["xdr"] !== "string") {
        return malformed("getLedgerEntries");
      }
      const data = xdr.LedgerEntryData.fromXdr(entries[0]["xdr"], "base64").toXdrObject();
      return data.type === 0 ? data.account.seqNum : malformed("getLedgerEntries");
    },
    async simulate(transaction, deadline) {
      const r = await call("simulateTransaction", { transaction }, deadline);
      if (typeof r["error"] === "string") return { ok: false, error: r["error"] };
      // A transaction that needs archived entries restored first cannot land as it is.
      if (r["restorePreamble"] !== undefined && r["restorePreamble"] !== null) return { ok: false, error: "restore needed" };
      const fee = r["minResourceFee"];
      const data = r["transactionData"];
      const events = r["events"] ?? [];
      if (typeof fee !== "string" || !/^[0-9]{1,19}$/.test(fee) || typeof data !== "string" || !Array.isArray(events)) {
        return malformed("simulateTransaction");
      }
      if (!events.every((e) => typeof e === "string")) return malformed("simulateTransaction");
      return { ok: true, minResourceFee: BigInt(fee), transactionData: data, events: events as string[] };
    },
    async send(transaction, deadline) {
      const r = await call("sendTransaction", { transaction }, deadline);
      const status = r["status"];
      if (status !== "PENDING" && status !== "DUPLICATE" && status !== "TRY_AGAIN_LATER" && status !== "ERROR") return malformed("sendTransaction");
      if (typeof r["hash"] !== "string") return malformed("sendTransaction");
      return { status, hash: r["hash"].toLowerCase(), ...(typeof r["errorResultXdr"] === "string" ? { errorResultXdr: r["errorResultXdr"] } : {}) };
    },
    async transaction(hash, deadline) {
      const r = await call("getTransaction", { hash }, deadline);
      const status = r["status"];
      if (status !== "SUCCESS" && status !== "FAILED" && status !== "NOT_FOUND") return malformed("getTransaction");
      if (!isLedger(r["oldestLedger"]) || !isLedger(r["latestLedger"])) return malformed("getTransaction");
      const out: { -readonly [K in keyof Got]: Got[K] } = { status, oldestLedger: r["oldestLedger"], latestLedger: r["latestLedger"] };
      if (isLedger(r["ledger"])) out.ledger = r["ledger"];
      if (Number.isInteger(r["applicationOrder"])) out.applicationOrder = r["applicationOrder"] as number;
      if (typeof r["envelopeXdr"] === "string") out.envelopeXdr = r["envelopeXdr"];
      if (typeof r["resultXdr"] === "string") out.resultXdr = r["resultXdr"];
      return out;
    },
    reader(deadline) {
      return {
        passphrase: () => node.passphrase(deadline),
        latestLedger: () => node.latestLedger(deadline),
        async transaction(hash) {
          const t = await node.transaction(hash, deadline);
          return {
            status: t.status,
            oldestLedger: t.oldestLedger,
            latestLedger: t.latestLedger,
            ...(t.envelopeXdr === undefined ? {} : { envelopeXdr: t.envelopeXdr }),
            ...(t.ledger === undefined ? {} : { ledger: t.ledger }),
            ...(t.applicationOrder === undefined ? {} : { applicationOrder: t.applicationOrder }),
          };
        },
        // Stellar RPC's `getEvents` takes a ledger range or a cursor, never both, and its `endLedger` is exclusive (lcp's
        // `StellarReader.events`); a page shorter than the page asked for is the last of the range.
        async events(f) {
          const filters = [{ type: "contract", topics: f.topics }];
          const params =
            f.cursor === undefined
              ? { startLedger: f.fromLedger, endLedger: f.toLedger + 1, filters, pagination: { limit: PAGE } }
              : { filters, pagination: { cursor: f.cursor, limit: PAGE } };
          const r = await call("getEvents", params, deadline);
          const rows = r["events"];
          if (!Array.isArray(rows) || !isLedger(r["oldestLedger"]) || !isLedger(r["latestLedger"])) return malformed("getEvents");
          const events: StellarEventRow[] = [];
          let past = false;
          for (const e of rows) {
            if (!isObject(e) || !isLedger(e["ledger"])) return malformed("getEvents");
            if (e["ledger"] > f.toLedger) {
              past = true;
              continue;
            }
            events.push({
              id: e["id"] as string,
              ledger: e["ledger"],
              txHash: e["txHash"] as string,
              contractId: e["contractId"] as string,
              topic: e["topic"] as string[],
              value: e["value"] as string,
            });
          }
          const more = rows.length === PAGE && !past && typeof r["cursor"] === "string";
          return { events, oldestLedger: r["oldestLedger"], latestLedger: r["latestLedger"], ...(more ? { cursor: r["cursor"] as string } : {}) };
        },
      };
    },
  };
  return node;
}
