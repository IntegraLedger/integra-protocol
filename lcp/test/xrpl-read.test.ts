// Runs x402-exact-xrpl.json's read rows through x402/exact/xrpl's status: the read by the payer's instrument of a
// ticket, used and not yet used, a validated tec result, a re-signed copy, a delegated payment, an inner Batch payment, a payment the payee
// signed as the payer's Delegate, one that signs no LastLedgerSequence, and a partial payment; and the search's gate, which holds a lapse
// and a sequence number another payment took. Every expected answer is the file's; the last block replays a server's
// recorded answers, its expected answer the profile's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import type { XrplReader } from "../src/xrpl.js";
import { landed, txHash, xrplReader } from "./fixtures/xrpl-reader.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
/** The payer, V2's signed Account. */
const PAYER = V.V2.expectReference.signed.account as string;

interface ReadRow {
  case: string;
  presented: string;
  landed?: string;
  ledger?: number;
  result?: string;
  parent?: string;
  delivered?: string;
  accountSequence: number;
  ticketPresent: boolean;
  expect: unknown;
}

describe("x402-exact-xrpl.json read: the read by the instrument, its signer and its authority", () => {
  for (const row of rowsOf<ReadRow>(V.read.rows, "x402-exact-xrpl.json read.rows", { exact: 11 })) {
    it(row.case, async () => {
      const payment = { x402Version: 2, accepted: V.V2.accepted, payload: { signedTxBlob: row.presented } };
      const ref = await exactXrpl.reference(payment as never, V.V2.accepted);
      if ("refused" in ref) throw new Error(ref.code);
      const l =
        row.landed === undefined
          ? undefined
          : landed(row.landed, {
              ...(row.result === undefined ? { delivered: row.delivered ?? "1000000" } : { result: row.result }),
              ...(row.parent === undefined ? {} : { parent: row.parent }),
            });
      const validated = row.ledger ?? 1000;
      const at = (ledger: string) => (ledger === "validated" ? validated : validated + 1);
      const reader = xrplReader({
        server: async () => ({ validated, latest: validated + 1, completeLedgers: `1-${validated + 1}` }),
        tx: async (h) =>
          l !== undefined && h === txHash(row.presented) && row.presented === row.landed ? l : { notFound: true, searchedAll: true },
        // Only the payer's account answers: any other account's account_tx is empty, its account_info finds no
        // account and its tickets are absent, so a read of the wrong account changes the answer.
        accountTx: async (a, range) => ({ transactions: l === undefined || a !== PAYER ? [] : [l], min: range.min, max: range.max }),
        accountInfo: async (a, ledger) =>
          a === PAYER ? { sequence: row.accountSequence, ledgerIndex: at(ledger) } : { notFound: true, ledgerIndex: at(ledger) },
        ticket: async (a, _t, ledger) => ({ present: a === PAYER && row.ticketPresent, ledgerIndex: at(ledger) }),
      });
      const answer = await exactXrpl.status({ ...ref, fromLedger: 900 }, reader, { act: "payment", finality: "validated" });
      expect(answer).toStrictEqual(row.expect);
    });
  }
});

// rippled's answers to one read, recorded from a public testnet server on API version 2
// (fixtures/xrpl-account-tx-refused.json). The server holds ledgers from 22448033 and refuses `account_tx` from the
// reference's fromLedger, 22406573, with `lgrIdxMalformed`; the reader rejects that refusal with `ReaderError` of kind
// `history`, as XrplReader documents. The expected answer is the profile x402-exact-xrpl's rule 14: complete_ledgers
// does not hold the issue ledger.
describe("x402/exact/xrpl read: a server that refuses account_tx below the ledgers it holds", () => {
  const R = JSON.parse(readFileSync(new URL("./fixtures/xrpl-account-tx-refused.json", import.meta.url), "utf8"));
  const sent: string[] = [];
  const rpc = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    sent.push(method);
    const key = JSON.stringify({ method, params: [{ ...params, api_version: 2 }] });
    const c = R.calls.find((x: { request: unknown }) => JSON.stringify(x.request) === key);
    if (c === undefined) throw new Error(`no recorded answer for ${key}`);
    return c.answer.result;
  };
  const reader: XrplReader = {
    network: "xrpl:1",
    async server() {
      const info = (await rpc("server_info", {}))["info"] as { validated_ledger: { seq: number }; complete_ledgers: string; network_id: number };
      // The latest ledger it serves: the last of complete_ledgers.
      const latest = Number(info.complete_ledgers.split(",").at(-1)!.split("-").at(-1));
      return { validated: info.validated_ledger.seq, latest, completeLedgers: info.complete_ledgers, networkId: info.network_id };
    },
    async tx(hash, range) {
      const r = await rpc("tx", { transaction: hash, binary: true, ...(range ? { min_ledger: range.min, max_ledger: range.max } : {}) });
      if (r["error"] === "txnNotFound") return { notFound: true, searchedAll: r["searched_all"] === true };
      throw new ReaderError("malformed", String(r["error"]));
    },
    async accountTx(account, range) {
      const r = await rpc("account_tx", { account, ledger_index_min: range.min, ledger_index_max: range.max, binary: true, forward: true });
      if (r["error"] === "lgrIdxMalformed") throw new ReaderError("history", "account_tx: lgrIdxMalformed");
      throw new ReaderError("malformed", String(r["error"]));
    },
    async accountInfo(account, ledger) {
      const r = await rpc("account_info", { account, ledger_index: ledger });
      return { sequence: (r["account_data"] as { Sequence: number }).Sequence, ledgerIndex: r["ledger_index"] as number };
    },
    ticket: async () => {
      throw new Error("not recorded");
    },
    channel: async () => {
      throw new Error("not recorded");
    },
  };

  it("answers unreadable history-gap, so a caller reads a server that holds the history", async () => {
    const answer = await exactXrpl.status(R.reference, reader, { act: "agreement", finality: "validated", after: R.reference.fromLedger });
    expect(sent).toStrictEqual(["server_info", "tx", "account_info", "account_tx"]);
    expect(answer).toStrictEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
});
