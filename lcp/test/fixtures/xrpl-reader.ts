// An XRPL reader for tests, constructed: each call answers as the test gives it, and otherwise as a server holding
// ledgers 1 to 1001, 1000 validated, with no transaction, account, ticket or channel. A transaction's hash is
// SHA-512Half over `TXN\0` and its blob (node:crypto), as the ledger computes it.
import { createHash } from "node:crypto";
import type { XrplLanded, XrplReader } from "../../src/xrpl.js";

export const txHash = (blob: string): string =>
  createHash("sha512").update(Buffer.from(`54584E00${blob}`, "hex")).digest().subarray(0, 32).toString("hex").toUpperCase();

/** A transaction the server answers: validated at ledger 990 with `tesSUCCESS`, unless `over` says otherwise. */
export function landed(blob: string, over: Partial<XrplLanded> = {}): XrplLanded {
  return { hash: txHash(blob), validated: true, ledgerIndex: 990, result: "tesSUCCESS", blob, ...over };
}

export function xrplReader(over: Partial<XrplReader> = {}): XrplReader {
  return {
    network: "xrpl:1",
    server: async () => ({ validated: 1000, latest: 1001, completeLedgers: "1-1001" }),
    tx: async () => ({ notFound: true, searchedAll: true }),
    accountTx: async (_account, range) => ({ transactions: [], min: range.min, max: range.max }),
    accountInfo: async (_account, ledger) => ({ notFound: true, ledgerIndex: ledger === "validated" ? 1000 : 1001 }),
    ticket: async (_a, _t, ledger) => ({ present: false, ledgerIndex: ledger === "validated" ? 1000 : 1001 }),
    channel: async () => ({ notFound: true, ledgerIndex: 1000 }),
    ...over,
  };
}
