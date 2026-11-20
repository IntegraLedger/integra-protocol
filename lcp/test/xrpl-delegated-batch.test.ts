// Replays fixtures/xrpl-delegated-batch-testnet.json: two x402/exact/xrpl payments the buyer signed and never submitted,
// whose Sequence a delegated Payment and an inner Batch Payment of the buyer's account took, read through rippled's
// recorded answers on the XRPL Testnet. The reader answers as XrplReader documents: `tx` and `account_tx` in binary
// form, each transaction's result, delivered amount, channels and ParentBatchID read from its metadata
// (ripple-binary-codec), and its hash, which rippled's binary `account_tx` on API version 2 does not name, SHA-512Half
// over `TXN\0` and its blob.
import { readFileSync } from "node:fs";
import { decode } from "ripple-binary-codec";
import { expect, it } from "vitest";
import type { AtrHash } from "../src/index.js";
import { decodeBlob, xrplStatus, type XrplLanded, type XrplReader } from "../src/xrpl.js";
import { signedOf } from "../src/internal/xrpl.js";
import { txHash } from "./fixtures/xrpl-reader.js";

interface Call {
  request: { method: string; params: [Record<string, unknown>] };
  answer: { result: Record<string, unknown> };
}
const F = JSON.parse(readFileSync(new URL("./fixtures/xrpl-delegated-batch-testnet.json", import.meta.url), "utf8")) as {
  buyer: string;
  payee: string;
  delegate: string;
  delegated: string;
  batch: string;
  innerPayments: [string, string];
  reads: { name: "delegated" | "batch"; blob: string; h: AtrHash; fromLedger: number }[];
  calls: Call[];
};

function rpc(method: string, params: Record<string, unknown>): Record<string, unknown> {
  const key = JSON.stringify({ method, params: [{ ...params, api_version: 2 }] });
  const c = F.calls.find((x) => JSON.stringify(x.request) === key);
  if (c === undefined) throw new Error(`no recorded answer for ${key}`);
  return c.answer.result;
}

interface Node {
  LedgerEntryType?: string;
  LedgerIndex?: string;
}
function landedOf(blob: string, metaBlob: string, ledgerIndex: number, validated: boolean, hash?: string): XrplLanded {
  const m = decode(metaBlob) as unknown as { TransactionResult: string; DeliveredAmount?: XrplLanded["delivered"]; ParentBatchID?: string; AffectedNodes?: Record<string, Node>[] };
  const channels = (kind: string) =>
    (m.AffectedNodes ?? []).flatMap((n) => (n[kind]?.LedgerEntryType === "PayChannel" ? [n[kind]!.LedgerIndex!] : []));
  return {
    hash: hash ?? txHash(blob),
    validated,
    ledgerIndex,
    result: m.TransactionResult,
    blob,
    ...(m.DeliveredAmount === undefined ? {} : { delivered: m.DeliveredAmount }),
    createdChannels: channels("CreatedNode"),
    deletedChannels: channels("DeletedNode"),
    ...(m.ParentBatchID === undefined ? {} : { parent: m.ParentBatchID }),
  };
}

interface Binary {
  tx_blob: string;
  meta_blob: string;
  ledger_index: number;
  validated?: boolean;
  hash?: string;
}
const reader: XrplReader = {
  network: "xrpl:1",
  async server() {
    const info = rpc("server_info", {})["info"] as { validated_ledger: { seq: number }; complete_ledgers: string; network_id: number };
    const latest = Number(info.complete_ledgers.split(",").at(-1)!.split("-").at(-1));
    return { validated: info.validated_ledger.seq, latest, completeLedgers: info.complete_ledgers, networkId: info.network_id };
  },
  async tx(hash, range) {
    const r = rpc("tx", { transaction: hash, binary: true, ...(range ? { min_ledger: range.min, max_ledger: range.max } : {}) });
    if (r["error"] === "txnNotFound") return { notFound: true, searchedAll: r["searched_all"] === true };
    const t = r as unknown as Binary;
    return landedOf(t.tx_blob, t.meta_blob, t.ledger_index, t.validated === true, t.hash);
  },
  async accountTx(account, range, marker) {
    const r = rpc("account_tx", {
      account,
      ledger_index_min: range.min,
      ledger_index_max: range.max,
      binary: true,
      forward: true,
      ...(marker === undefined ? {} : { marker }),
    });
    const transactions = (r["transactions"] as Binary[]).map((t) => landedOf(t.tx_blob, t.meta_blob, t.ledger_index, t.validated === true));
    return { transactions, min: r["ledger_index_min"] as number, max: r["ledger_index_max"] as number, ...(r["marker"] === undefined ? {} : { marker: r["marker"] }) };
  },
  async accountInfo(account, ledger) {
    const r = rpc("account_info", { account, ledger_index: ledger });
    return { sequence: (r["account_data"] as { Sequence: number }).Sequence, ledgerIndex: r["ledger_index"] as number };
  },
  ticket: async () => {
    throw new Error("no ticket read is recorded");
  },
  channel: async () => {
    throw new Error("no channel read is recorded");
  },
};

// The transaction that took each payment's Sequence, its signer and the authority it acted under.
const TOOK = {
  delegated: { transaction: F.delegated, signer: F.delegate, authority: `Delegate for ${F.buyer}` },
  batch: { transaction: F.innerPayments[0], signer: F.buyer, authority: `inner Batch of ${F.batch}` },
};

it.each(F.reads)("a search read whole proves absence: the buyer's $name transaction took the payment's Sequence", async (r) => {
  const decoded = await decodeBlob(r.blob);
  if ("code" in decoded) throw new Error(decoded.code);
  const signed = await signedOf(decoded.tx);
  if (signed === undefined) throw new Error("the blob names no instrument");
  const ref = { network: "xrpl:1" as const, transaction: txHash(r.blob), h: r.h, payee: F.payee, signed, fromLedger: r.fromLedger };
  const status = await xrplStatus(ref, reader, { act: "payment", finality: "validated" });
  expect(status).toMatchObject({ state: "failed", reason: "instrument-consumed", finality: "validated", ...TOOK[r.name], foreign: [] });
});
