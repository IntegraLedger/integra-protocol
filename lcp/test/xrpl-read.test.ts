// Runs x402-exact-xrpl.json's read rows through x402/exact/xrpl's status: the read by the payer's instrument of a
// ticket, used and not yet used, a validated tec result, a re-signed copy, a delegated payment, an inner Batch payment, a payment the payee
// signed as the payer's Delegate, one that signs no LastLedgerSequence, and a partial payment; and the search's gate, which holds a lapse
// and a sequence number another payment took. Every expected answer is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
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
