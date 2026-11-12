/** The data of the Solana pairings on x402 and MPP. */
import { freeze } from "./freeze.js";

const NOTE = "a Solana node whose `getFirstAvailableBlock` is at or below the issue slot";

const SEARCH =
  "Memo-carrying signatures of the buyer's own account, never of the fee payer: 10 pages of 1,000 from the issue slot, " +
  "read whole to the latest head at finalized and, before a `failed`, on at confirmed.";

const HISTORY = "the node holds history from the issue slot (`getFirstAvailableBlock` at or below it); otherwise `unreadable`, `history-gap`";

const LIFE = {
  value: 150,
  unit: "blocks",
  rule: "the blockhash's validity, which the chain ends 150 blocks after the blockhash's own block; none for a durable-nonce message",
};

const lapse = (what: string, consumed: string): string =>
  `the signed ${what}: its blockhash invalid at finalized at a slot at least 150 past the first read after the payment ` +
  `was presented, or its durable nonce advanced by another transaction${consumed}; each only once the search for H, ` +
  "read whole, holds no payer act for H";

const SUCCEEDED =
  "`getTransaction` at finalized returns the transaction with `meta.err` null; the buyer is among its signers; exactly " +
  "one of its top-level Memo instructions holds an LCP string, and it is H's; what it transfers is recorded as observed";

export const SOLANA = /* @__PURE__ */ freeze({
  "x402/exact/solana": {
    coverage: "full",
    carrier: {
      signed: "one Memo instruction, H's LCP string, in the transaction the buyer and the fee payer sign; all of H",
      member: ["extra", "memo"],
    },
    source: "stock `@x402/svm` 2.30.0, copying `extra.memo`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)"],
      lapse: lapse("message", ", or the signed message landed paying no account of the payee"),
      life: LIFE,
    },
    destination:
      "the account a `TransferChecked` from the buyer's token account reaches (top-level or inner), counting on a charge " +
      "where its owner per `meta.postTokenBalances` is the option's payee",
    asset: "the transfer's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    agreement: { floor: "0", fee: "the seller's settler (`extra.feePayer`)", succeeded: SUCCEEDED },
    proves:
      "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string " +
      "form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the " +
      "transaction's instruction data on chain. This does not show that amount, recipient, mint or timing " +
      "match the ATR's content.",
  },
  "x402/upto/solana": {
    coverage: "full",
    carrier: {
      signed: "the Memo of the open that escrows the signed maximum in a one-request channel; H's LCP string, all of H",
      member: ["extra", "memo"],
    },
    source: "stock `@x402/svm` 2.30.0, copying `extra.memo`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)", "the payment-channels program (devnet only)"],
      lapse: lapse("open", ""),
      life: LIFE,
    },
    destination: "the channel's token account, counting where the distribution its open names holds the option's payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    proves:
      "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string " +
      "form, and which opened a one-request payment channel escrowing the signed maximum; it executed without " +
      "error. The memo is in the transaction's instruction data on chain. The amount charged from the escrow, " +
      "which may be zero, is the seller's metering, settled by the facilitator in a later transaction that " +
      "does not carry the hash, and the rest returns to the payer. This does not show that amount, recipient, " +
      "mint or timing match the ATR's content.",
  },
  "x402/batch-settlement/solana": {
    coverage: "full",
    carrier: {
      signed: "the seller's Memo instruction in the channel's opening, H's LCP string, next to the scheme's own receiver-authorizer memo",
      member: ["extra", "memo"],
    },
    source: "stock `@x402/svm` 2.30.0, copying `extra.memo`",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)", "the payment-channels program (devnet only)"],
      lapse: lapse("opening", ""),
      life: LIFE,
    },
    destination: "the channel's token account, counting where the distribution its opening names holds the option's payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    proves:
      "The payer signed a Solana transaction whose seller Memo instruction (`extra.memo`) carries this ATR's " +
      "hash in LCP string form, and which opened an x402 batch-settlement payment channel; it executed without " +
      "error. The memo is in the transaction's instruction data on chain. This does not show that amount, " +
      "recipient, mint or timing match the ATR's content.",
  },
  "mpp/charge/solana": {
    coverage: "full",
    carrier: { signed: "one Memo instruction, H's LCP string", member: ["externalId"] },
    source: "stock `@solana/mpp`, copying `externalId`",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)"],
      lapse: lapse("message", ", or the signed message landed naming no account of the payee"),
      life: LIFE,
    },
    destination:
      "the account a transfer from the buyer's token account reaches (top-level or inner), counting where its owner per " +
      "`meta.postTokenBalances` is the option's payee; for `sol`, the destination of a System transfer from the buyer's " +
      "account",
    asset: "the transfer's mint, or lamports for `sol`; compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the seller's settler, under `feePayer: true`, named in every challenge of this id",
      succeeded: SUCCEEDED,
    },
    proves:
      "The payer signed a Solana transaction whose one LCP-form Memo instruction carries this ATR's hash in " +
      "LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo " +
      "is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or " +
      "timing match the ATR's content.",
  },
  "mpp/charge/usdc/solana": {
    coverage: "full",
    carrier: { signed: "one Memo instruction, H's LCP string", member: ["externalId"] },
    source: "lcp's client; no stock client implements `usdc`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)"],
      lapse: lapse("message", ", or the signed message landed naming no account of the payee"),
      life: LIFE,
    },
    destination:
      "the account a transfer from the buyer's token account reaches (top-level or inner), counting where its owner per " +
      "`meta.postTokenBalances` is the option's payee",
    asset: "the transfer's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the settler where the challenge names it fee payer, else the buyer",
      succeeded: SUCCEEDED,
    },
    proves:
      "The payer signed a Solana transaction whose one LCP-form Memo instruction carries this ATR's hash in " +
      "LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo " +
      "is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or " +
      "timing match the ATR's content.",
  },
});
