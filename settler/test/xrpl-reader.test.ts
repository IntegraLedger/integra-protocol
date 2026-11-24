// The settler's XRPL reader (`xrplReader`, modules/xrpl/node.ts) against rippled's own answers: the XRPL Testnet answers
// lcp records in ../../lcp/test/fixtures/xrpl-delegated-batch-testnet.json (rippled 3.4.1, API version 2), replayed
// over HTTP, and the same transactions in the members rippled's API version 1 names them by (`tx` answers `tx` and
// `meta`, `account_tx` answers `tx_blob` and `meta`; rippled 3.1.3, xrpld 3.3.0), which the settler's calls get, since
// they name no `api_version`. Every expected answer is lcp's read of the recorded history, or the recorded value.
import { readFileSync } from "node:fs";
import type { AtrHash } from "@integraledger/lcp";
import { exactXrpl } from "@integraledger/lcp/x402-exact-xrpl";
import { xrplStatus } from "@integraledger/lcp/xrpl";
import { decode, hashes } from "xrpl";
import { afterEach, describe, expect, it } from "vitest";
import { xrplReader } from "../src/modules/xrpl/node.js";
import { stub, type Stub } from "./support.js";

interface Call {
  request: { method: string; params: [Record<string, unknown>] };
  answer: { result: Record<string, unknown> };
}
const F = JSON.parse(readFileSync(new URL("../../lcp/test/fixtures/xrpl-delegated-batch-testnet.json", import.meta.url), "utf8")) as {
  buyer: string;
  payee: string;
  delegate: string;
  delegated: string;
  reads: { name: string; blob: string; h: AtrHash; fromLedger: number }[];
  calls: Call[];
};
type Version = 1 | 2;

/** The recorded answer to a call, the call's members as the settler sends them (no `api_version`). */
function recorded(method: string, params: Record<string, unknown>): Record<string, unknown> | undefined {
  const key = JSON.stringify({ method, params: [{ ...params, api_version: 2 }] });
  return F.calls.find((c) => JSON.stringify(c.request) === key)?.answer.result;
}

/** One transaction of an answer in the members `version` names it by, for `method`. */
function shaped(t: Record<string, unknown>, method: "tx" | "account_tx", version: Version): Record<string, unknown> {
  if (version === 2) return t;
  const { tx_blob, meta_blob, ...rest } = t;
  return method === "tx" ? { ...rest, tx: tx_blob, meta: meta_blob } : { ...rest, tx_blob, meta: meta_blob };
}

let node: Stub | undefined;
afterEach(async () => {
  await node?.close();
  node = undefined;
});

/** A server answering as the recording, in `version`'s members; a call the recording does not hold is refused. */
async function serverAs(version: Version, extra: (method: string, p: Record<string, unknown>) => Record<string, unknown> | undefined = () => undefined) {
  node = await stub((_path, body) => {
    const { method, params } = body as { method: string; params: Record<string, unknown>[] };
    const p = params[0] ?? {};
    const r = extra(method, p) ?? recorded(method, p);
    if (r === undefined) return { result: { error: "unknownCmd", status: "error" } };
    if (method === "account_tx" && Array.isArray(r["transactions"])) {
      return { result: { ...r, transactions: (r["transactions"] as Record<string, unknown>[]).map((t) => shaped(t, "account_tx", version)) } };
    }
    return { result: r };
  });
  return xrplReader("xrpl:1", node.url, performance.now() + 10_000);
}
const methods = () => node!.calls.map((c) => (c.body as { method: string }).method);

/** The recorded account_tx's transactions, as rippled answered them (API version 2). */
const LANDED = F.calls.find((c) => c.request.method === "account_tx")!.answer.result["transactions"] as Record<string, unknown>[];
const VALIDATED = (F.calls[0]!.answer.result["info"] as { validated_ledger: { seq: number } }).validated_ledger.seq;

describe("the settler's XRPL reader takes a landed transaction in every form rippled answers it", () => {
  it.each([1, 2] as const)("`tx` on API version %i: the transaction, its result and its ledger", async (version) => {
    const t = LANDED[0]!;
    const hash = hashes.hashSignedTx(t["tx_blob"] as string);
    const reader = await serverAs(version, (m, p) => (m === "tx" && p["transaction"] === hash ? { ...shaped(t, "tx", version), hash, status: "success" } : undefined));
    expect(await reader.tx(hash, null)).toMatchObject({ hash, validated: true, ledgerIndex: t["ledger_index"], result: "tesSUCCESS", blob: t["tx_blob"] });
  });

  it.each([1, 2] as const)("`account_tx` on API version %i: every transaction of the page", async (version) => {
    const reader = await serverAs(version);
    const page = await reader.accountTx(F.buyer, { min: 22467728, max: VALIDATED });
    expect(page.transactions.map((t) => [t.hash, t.blob, t.result])).toEqual(
      LANDED.map((t) => [hashes.hashSignedTx(t["tx_blob"] as string), t["tx_blob"], expect.stringMatching(/^tes|^tec/)]),
    );
  });

  it("refuses an answer with no binary transaction or metadata, as `tx` answers without `binary`: JSON objects", async () => {
    const t = LANDED[0]!;
    const hash = hashes.hashSignedTx(t["tx_blob"] as string);
    const reader = await serverAs(1, (m) => (m === "tx" ? { tx: { TransactionType: "Payment" }, meta: { TransactionResult: "tesSUCCESS" }, hash, validated: true, status: "success" } : undefined));
    await expect(reader.tx(hash, null)).rejects.toThrow(/^malformed: tx: /);
  });
});

describe("the settler's XRPL reader names the validated ledger as the latest a search reads to", () => {
  it("answers `server_info`'s validated ledger as both, and asks the server nothing else", async () => {
    const reader = await serverAs(2);
    expect(await reader.server()).toMatchObject({ validated: VALIDATED, latest: VALIDATED });
    expect(methods()).toEqual(["server_info"]);
  });

  it("refuses a `server_info` that names no validated ledger", async () => {
    const reader = await serverAs(2, (m) => (m === "server_info" ? { info: { complete_ledgers: "empty" }, status: "success" } : undefined));
    await expect(reader.server()).rejects.toThrow(/^malformed: server_info: /);
  });
});

// lcp's own reading of the recorded history, through the settler's reader on both versions: the payment's Sequence was
// taken by the buyer's delegated Payment, which the search to the validated ledger reads whole: final failed.
describe("lcp's read through the settler's reader, over the recorded Testnet history", () => {
  const r = F.reads.find((x) => x.name === "delegated")!;
  it.each([1, 2] as const)("on API version %i: failed, instrument-consumed, at the validated mark", async (version) => {
    // The payment as the buyer presented it, its option's invoice the recorded H: lcp's reference names its instrument.
    const accepted = { scheme: "exact", network: "xrpl:1", amount: String(decode(r.blob)["Amount"]), asset: "XRP", payTo: F.payee, maxTimeoutSeconds: 60, extra: { areFeesSponsored: false, invoiceId: `lcp:sha256:${r.h}` } };
    const signed = await exactXrpl.reference({ x402Version: 2, accepted, payload: { signedTxBlob: r.blob } } as never, accepted as never);
    if ("code" in signed) throw new Error(signed.code);
    expect(signed.h).toBe(r.h);
    const ref = { ...signed, fromLedger: r.fromLedger };
    const reader = await serverAs(version);
    expect(await xrplStatus(ref, reader, { act: "payment", finality: "validated" })).toMatchObject({
      state: "failed",
      reason: "instrument-consumed",
      finality: "validated",
      transaction: F.delegated,
      signer: F.delegate,
    });
  });
});
