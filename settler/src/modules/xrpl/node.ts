/**
 * The seller's rippled or Clio server, over its JSON-RPC interface: lcp's XRPL reader, and the node calls
 * `@x402/xrpl`'s facilitator class takes in its options, so the class reads and submits through the configured server
 * over HTTP. Each call is bounded by the settler's node bounds and by its deadline, a `performance.now()` time; an
 * answer whose status is `error` rejects, but for the errors that mean "not found", which the callers read.
 */
import type { XrplAmount, XrplLanded, XrplNetwork, XrplPage, XrplReader } from "@integraledger/lcp/xrpl";
import { decode, hashes } from "xrpl";
import { isObject } from "../../answers.js";
import { NodeError, postJson, sleep } from "../../http.js";

/** One call: its `result`, the server's error names kept (`error`) so a caller can read "not found". */
export async function xrplRpc(url: string, method: string, params: Record<string, unknown>, deadline: number): Promise<Record<string, unknown>> {
  const answer = await postJson(url, { method, params: [params] }, deadline - performance.now());
  if (!isObject(answer) || !isObject(answer["result"])) throw new NodeError("malformed", true, `${method}: no result`);
  return answer["result"];
}

function failedOf(method: string, r: Record<string, unknown>): never {
  throw new NodeError("malformed", true, `${method}: ${String(r["error"] ?? "an answer without its members")}`);
}

const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/**
 * The first of `names` that `t` holds as a string. rippled names a binary answer's members by API version and by method:
 * `tx` answers `tx` and `meta` on API version 1, `tx_blob` and `meta_blob` on version 2; `account_tx` answers `tx_blob`
 * and `meta` on version 1, `tx_blob` and `meta_blob` on version 2 (rippled 3.1.3; xrpld 3.3.0).
 */
const hexOf = (t: Record<string, unknown>, ...names: string[]): string | undefined =>
  names.map((n) => t[n]).find((v): v is string => typeof v === "string");

/** A landed transaction from its binary transaction and metadata, in any of the forms rippled answers. */
function landedOf(t: Record<string, unknown>, method: string): XrplLanded {
  const blob = hexOf(t, "tx_blob", "tx");
  const metaHex = hexOf(t, "meta_blob", "meta");
  if (blob === undefined || metaHex === undefined) return failedOf(method, t);
  const meta = decode(metaHex);
  const result = meta["TransactionResult"];
  if (typeof result !== "string") return failedOf(method, t);
  const created: string[] = [];
  const deleted: string[] = [];
  for (const n of Array.isArray(meta["AffectedNodes"]) ? meta["AffectedNodes"] : []) {
    if (!isObject(n)) continue;
    for (const [kind, out] of [["CreatedNode", created], ["DeletedNode", deleted]] as const) {
      const node = n[kind];
      if (isObject(node) && node["LedgerEntryType"] === "PayChannel" && typeof node["LedgerIndex"] === "string") out.push(node["LedgerIndex"]);
    }
  }
  const delivered = meta["delivered_amount"] ?? meta["DeliveredAmount"];
  const index = int(t["ledger_index"]);
  const parent = meta["ParentBatchID"];
  return {
    hash: typeof t["hash"] === "string" ? t["hash"] : hashes.hashSignedTx(blob),
    validated: t["validated"] === true,
    ...(index === undefined ? {} : { ledgerIndex: index }),
    result,
    blob,
    ...(delivered === undefined ? {} : { delivered: delivered as XrplAmount }),
    ...(created.length ? { createdChannels: created } : {}),
    ...(deleted.length ? { deletedChannels: deleted } : {}),
    ...(typeof parent === "string" ? { parent } : {}),
  };
}

const ledgerOf = (r: Record<string, unknown>) => int(r["ledger_index"]) ?? int(r["ledger_current_index"]) ?? 0;

/** lcp's reader over the server at `url`, its calls ending by `deadline`. */
export function xrplReader(network: XrplNetwork, url: string, deadline: number): XrplReader {
  const call = (method: string, params: Record<string, unknown>) => xrplRpc(url, method, params, deadline);
  return {
    network,
    async server() {
      const r = await call("server_info", {});
      const info = isObject(r["info"]) ? r["info"] : failedOf("server_info", r);
      const validated = isObject(info["validated_ledger"]) ? int(info["validated_ledger"]["seq"]) : undefined;
      if (validated === undefined || typeof info["complete_ledgers"] !== "string") return failedOf("server_info", r);
      const id = int(info["network_id"]);
      // `latest`, the ledger a search reads to, is the validated ledger of this same answer. `account_tx` reads validated
      // ledgers only, so a search to the open ledger (`ledger_current`) never reads whole: a consumed or lapsed payment
      // stays pending at rest, and a read during which a ledger closes can answer final where the next read does not.
      return { validated, latest: validated, completeLedgers: info["complete_ledgers"], ...(id === undefined ? {} : { networkId: id }) };
    },
    async tx(hash, range) {
      const r = await call("tx", { transaction: hash, binary: true, ...(range ? { min_ledger: range.min, max_ledger: range.max } : {}) });
      if (r["error"] === "txnNotFound") return { notFound: true, searchedAll: r["searched_all"] === true };
      if (r["error"] !== undefined) return failedOf("tx", r);
      return landedOf({ ...r, hash: r["hash"] ?? hash }, "tx");
    },
    async accountTx(account, range, marker): Promise<XrplPage> {
      const r = await call("account_tx", {
        account,
        ledger_index_min: range.min,
        ledger_index_max: range.max,
        binary: true,
        forward: true,
        ...(marker === undefined ? {} : { marker }),
      });
      const min = int(r["ledger_index_min"]);
      const max = int(r["ledger_index_max"]);
      if (r["error"] !== undefined || !Array.isArray(r["transactions"]) || min === undefined || max === undefined) {
        return failedOf("account_tx", r);
      }
      const transactions = r["transactions"].map((t) => (isObject(t) ? landedOf(t, "account_tx") : failedOf("account_tx", r)));
      return { transactions, min, max, ...(r["marker"] === undefined ? {} : { marker: r["marker"] }) };
    },
    async accountInfo(account, ledger) {
      const r = await call("account_info", { account, ledger_index: ledger });
      if (r["error"] === "actNotFound") return { notFound: true, ledgerIndex: ledgerOf(r) };
      const data = r["account_data"];
      const sequence = isObject(data) ? int(data["Sequence"]) : undefined;
      if (sequence === undefined) return failedOf("account_info", r);
      return { sequence, ledgerIndex: ledgerOf(r) };
    },
    async ticket(account, ticketSequence, ledger) {
      const r = await call("ledger_entry", { ticket: { account, ticket_seq: ticketSequence }, ledger_index: ledger });
      if (r["error"] === "entryNotFound") return { present: false, ledgerIndex: ledgerOf(r) };
      if (r["error"] !== undefined || !isObject(r["node"])) return failedOf("ledger_entry", r);
      return { present: true, ledgerIndex: ledgerOf(r) };
    },
    async channel(id, ledger) {
      const r = await call("ledger_entry", { payment_channel: id, ledger_index: ledger });
      if (r["error"] === "entryNotFound") return { notFound: true, ledgerIndex: ledgerOf(r) };
      const n = r["node"];
      if (!isObject(n) || typeof n["Account"] !== "string" || typeof n["Destination"] !== "string" || typeof n["Amount"] !== "string") {
        return failedOf("ledger_entry", r);
      }
      return { account: n["Account"], destination: n["Destination"], amount: n["Amount"] };
    },
  };
}

/** The index of the server's latest validated ledger, its call ending by `deadline`. */
export async function validatedLedger(url: string, deadline: number): Promise<number> {
  const r = await xrplRpc(url, "ledger", { ledger_index: "validated" }, deadline);
  return int(r["ledger_index"]) ?? failedOf("ledger", r);
}

/** The account's flag that disables its master key (`lsfDisableMaster`). */
const DISABLE_MASTER = 0x00100000;

/** An account's regular key and whether its master key is disabled, from its `account_data`. */
function authorizationOf(data: Record<string, unknown>): { regularKey?: string; isMasterKeyDisabled: boolean } {
  const flags = int(data["Flags"]) ?? 0;
  return {
    ...(typeof data["RegularKey"] === "string" ? { regularKey: data["RegularKey"] } : {}),
    isMasterKeyDisabled: (flags & DISABLE_MASTER) !== 0,
  };
}

/** What the class and the own module read of the payer's account and the ledger, and how they submit. */
export interface XrplNode {
  validatedLedger(): Promise<number>;
  sequence(account: string): Promise<number>;
  authorization(account: string): Promise<{ regularKey?: string; isMasterKeyDisabled: boolean }>;
  /**
   * A signer's account at the validated ledger as `authorization` reads it, or null where no such account exists: a
   * signer list's entries need not be funded accounts, and such a signer signs with the key its address derives from.
   */
  signerAuthorization(account: string): Promise<{ regularKey?: string; isMasterKeyDisabled: boolean } | null>;
  ticket(account: string, ticketSequence: number): Promise<boolean>;
  /** The account's signer list at the validated ledger: its quorum and each signer's weight, or none. */
  signerList(account: string): Promise<{ quorum: number; weights: ReadonlyMap<string, number> } | null>;
  simulate(blob: string): Promise<{ engineResult: string; engineResultMessage?: string }>;
  /** Submits the signed blob and waits up to `waitMs` for it in a validated ledger. */
  submit(blob: string): Promise<{ hash: string; validated: boolean; resultCode: string }>;
  /** The `PayChannel` ledger entry `id` names at the validated ledger, its fields as the server gives them, or none. */
  payChannel(id: string): Promise<Record<string, unknown> | null>;
  /** The validated ledger's index and its close time, in seconds since the Ripple epoch. */
  validatedClose(): Promise<{ index: number; closeTime: number }>;
  /** A transaction by its hash: whether a validated ledger holds it, and its result; none where the server holds none. */
  transaction(hash: string): Promise<{ validated: boolean; resultCode: string } | null>;
}

/** The node calls over the server at `url`, each bounded by the node bounds; a submission waits up to `waitMs`. */
export function xrplNode(url: string, waitMs: number): XrplNode {
  const call = (method: string, params: Record<string, unknown>) => xrplRpc(url, method, params, performance.now() + 5_000);
  const accountData = async (account: string, ledger: string) => {
    const r = await call("account_info", { account, ledger_index: ledger });
    return isObject(r["account_data"]) ? r["account_data"] : failedOf("account_info", r);
  };
  return {
    async validatedLedger() {
      const r = await call("ledger", { ledger_index: "validated" });
      return int(r["ledger_index"]) ?? failedOf("ledger", r);
    },
    async sequence(account) {
      return int((await accountData(account, "current"))["Sequence"]) ?? failedOf("account_info", {});
    },
    async authorization(account) {
      return authorizationOf(await accountData(account, "validated"));
    },
    async signerAuthorization(account) {
      const r = await call("account_info", { account, ledger_index: "validated" });
      if (r["error"] === "actNotFound") return null;
      return authorizationOf(isObject(r["account_data"]) ? r["account_data"] : failedOf("account_info", r));
    },
    async ticket(account, ticketSequence) {
      const r = await call("ledger_entry", { ticket: { account, ticket_seq: ticketSequence }, ledger_index: "validated" });
      if (r["error"] === "entryNotFound") return false;
      return isObject(r["node"]) ? true : failedOf("ledger_entry", r);
    },
    async signerList(account) {
      const r = await call("account_objects", { account, type: "signer_list", ledger_index: "validated" });
      if (!Array.isArray(r["account_objects"])) return failedOf("account_objects", r);
      const list = r["account_objects"].find((o) => isObject(o) && o["LedgerEntryType"] === "SignerList");
      if (!isObject(list)) return null;
      const quorum = int(list["SignerQuorum"]);
      if (quorum === undefined || !Array.isArray(list["SignerEntries"])) return failedOf("account_objects", r);
      const weights = new Map<string, number>();
      for (const e of list["SignerEntries"]) {
        const entry = isObject(e) ? e["SignerEntry"] : undefined;
        if (isObject(entry) && typeof entry["Account"] === "string") weights.set(entry["Account"], int(entry["SignerWeight"]) ?? 0);
      }
      return { quorum, weights };
    },
    async simulate(blob) {
      // rippled simulates only an unsigned transaction and answers `transactionSigned` to a signed one, so the signing fields
      // go before the call, as the published class's own default strips them (@x402/xrpl 2.31.0).
      const { TxnSignature, SigningPubKey, Signers, ...unsigned } = decode(blob) as Record<string, unknown>;
      void TxnSignature;
      void SigningPubKey;
      void Signers;
      const r = await call("simulate", { tx_json: unsigned });
      if (typeof r["engine_result"] !== "string") return failedOf("simulate", r);
      return {
        engineResult: r["engine_result"],
        ...(typeof r["engine_result_message"] === "string" ? { engineResultMessage: r["engine_result_message"] } : {}),
      };
    },
    async payChannel(id) {
      const r = await call("ledger_entry", { payment_channel: id, ledger_index: "validated" });
      if (r["error"] === "entryNotFound") return null;
      const n = r["node"];
      return isObject(n) && n["LedgerEntryType"] === "PayChannel" ? n : failedOf("ledger_entry", r);
    },
    async validatedClose() {
      const r = await call("ledger", { ledger_index: "validated" });
      const ledger = isObject(r["ledger"]) ? r["ledger"] : {};
      const index = int(r["ledger_index"]);
      const closeTime = int(ledger["close_time"]);
      return index === undefined || closeTime === undefined ? failedOf("ledger", r) : { index, closeTime };
    },
    async transaction(hash) {
      const r = await call("tx", { transaction: hash });
      if (r["error"] === "txnNotFound") return null;
      const meta = r["meta"];
      if (!isObject(meta) || typeof meta["TransactionResult"] !== "string") return { validated: false, resultCode: "" };
      return { validated: r["validated"] === true, resultCode: meta["TransactionResult"] };
    },
    async submit(blob) {
      const sent = await call("submit", { tx_blob: blob });
      const hash = isObject(sent["tx_json"]) && typeof sent["tx_json"]["hash"] === "string" ? sent["tx_json"]["hash"] : hashes.hashSignedTx(blob);
      const engine = typeof sent["engine_result"] === "string" ? sent["engine_result"] : "";
      const until = performance.now() + waitMs;
      for (;;) {
        const r = await call("tx", { transaction: hash });
        if (r["validated"] === true && isObject(r["meta"]) && typeof r["meta"]["TransactionResult"] === "string") {
          return { hash, validated: true, resultCode: r["meta"]["TransactionResult"] };
        }
        if (performance.now() + 1_000 > until) return { hash, validated: false, resultCode: engine };
        await sleep(1_000);
      }
    },
  };
}
