/** The data of the Solana pairings on x402 and MPP. */
import { freeze } from "./freeze.js";

const NOTE = "a Solana node whose `getFirstAvailableBlock` is at or below the issue slot";

const SEARCH =
  "Memo-carrying signatures of the buyer's own account, which every transaction the buyer signs loads, never of the fee " +
  "payer: 10 pages of 1,000 and 50 candidates a pass, from the issue slot to the latest head, `confirmed`, which is no " +
  "mark; one mark, `finalized`, where a transaction met only above it is `pending`, `below-mark`. Until a run shows " +
  "every transaction the buyer signs listed there, a search read whole proves no absence: no `failed` but " +
  "`before-position`, and `pending`, `search-incomplete` in its place.";

const HISTORY = "the node holds history from the issue slot (`getFirstAvailableBlock` at or below it); otherwise `unreadable`, `history-gap`";

const LIFE = {
  value: 150,
  unit: "blocks",
  rule: "the blockhash's validity, which the chain ends 150 blocks after the blockhash's own block; none for a durable-nonce message",
};

const lapse = (what: string, consumed: string): string =>
  `the signed ${what}: unused where its blockhash has lapsed, \`isBlockhashValid\` answering false at \`finalized\` at a ` +
  "`finalized` slot at least 150 past the context slot of the first answer of true at `confirmed`, which bounds the " +
  "blockhash's own slot from above (no such answer, no bound; a slot count alone decides nothing, since a skipped slot " +
  `adds no block); consumed where its durable nonce advanced by another transaction${consumed}; each only once the search for ` +
  "H, read whole, holds no payer act for H; a durable-nonce message never lapses";

const PAID =
  "The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one " +
  "LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error. It paid each transfer it " +
  "made from the buyer's account, recorded with its mint or lamports, amount and recipient, one of zero included, the " +
  "recipient being the owner the transaction's token balances name; as a payment, one of them reached an account the " +
  "option's payee owns. The memo is in the transaction's instruction data on chain. It compares no amount, mint or " +
  "time with the ATR's terms.";

const deposited = (what: string, after: string): string =>
  "The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose " +
  `${what} is the hash's LCP string, final at \`finalized\` with no error, which deposited the amount its \`open\` ` +
  "names into a payment channel whose payee or distribution names the option's payee, recorded with its mint and amount. The " +
  `memo is in the transaction's instruction data on chain.${after} It compares no amount, mint or time with the ATR's ` +
  "terms.";

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
      lapse: lapse("message", ", or the signed message landed naming no account of the payee"),
      life: LIFE,
    },
    destination:
      "the account a `TransferChecked` from the buyer's token account reaches (top-level or inner), counting on a charge " +
      "where its owner per `meta.postTokenBalances` is the option's payee",
    asset: "the transfer's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee: "the seller's settler (`extra.feePayer`)",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded: SUCCEEDED,
    },
    proves: PAID,
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
      chains: { "the payment-channels program (devnet only)": ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"] },
      lapse: lapse("open", ""),
      life: LIFE,
    },
    destination: "the channel's token account, counting where the open's payee is the option's payee or its distribution holds that payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    proves: deposited(
      "one Memo instruction",
      " The deposit is the signed maximum a one-request channel escrows; the amount charged from it, which may be zero, " +
        "is the seller's metering, settled in a later transaction that does not carry the hash, and the rest returns " +
        "to the payer.",
    ),
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
      chains: { "the payment-channels program (devnet only)": ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"] },
      lapse: lapse("opening", ""),
      life: LIFE,
    },
    destination: "the channel's token account, counting where the opening's payee is the option's payee or its distribution holds that payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the buyer's account",
    confirmed: "no",
    proves: deposited("seller Memo instruction (`extra.memo`), beside the scheme's receiver-authorizer memo,", ""),
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
      feePayer: { may: ["settler"], default: "settler" },
      succeeded: SUCCEEDED,
    },
    proves: PAID,
  },
  "mpp/charge/solana/unsponsored": {
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
    proves: PAID,
  },
  "mpp/session/solana/memo": {
    coverage: "full",
    carrier: { signed: "one Memo instruction, H's LCP string, in the open the payer signs" },
    source: "lcp's client; a stock open carries no memo and is refused before the server submits it",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)", "the payment-channels program (devnet only)"],
      chains: { "the payment-channels program (devnet only)": ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"] },
      lapse: lapse("open", ""),
      life: LIFE,
    },
    destination: "the channel's token account, counting where the open's payee is the option's payee or its distribution holds that payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the open's payer (account 0), never its authorizedSigner",
    confirmed: "no",
    proves: deposited(
      "one LCP-form Memo instruction in the `open` the seller's operator co-signed and submitted",
      " Vouchers and the close do not carry the hash.",
    ),
  },
  "mpp/session/solana/stock": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    agreementOn: "same-network",
    source: "none: the stock `@solana/mpp` 0.7.0 open carries no H, its salt a random number, and `bound` answers `mpp/no-signed-place`",
    nonce: "unshown",
    broadcasts: "payer",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: "the opening named by its signature; no search for H, which no stock open carries",
      history: HISTORY,
      contracts: ["the payment-channels program (devnet only)"],
      chains: { "the payment-channels program (devnet only)": ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"] },
      lapse:
        "the named opening, looked up at `finalized` and at the latest head: consumed where it landed, whatever its " +
        "result; a lookup that finds nothing on a node holding the history is `not-found`, since the read makes no search",
      life: LIFE,
    },
    destination: "the channel's token account, counting where the open's payee is the option's payee or its distribution holds that payee",
    asset: "the deposit's mint, recorded and compared with nothing",
    payer: "the open's payer (account 0), whose token account funds the deposit, never its authorizedSigner",
    confirmed: "no",
    proves:
      "Before this opening was taken, an account signed an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The opening, a stock MPP session's payment-channel open that its payer " +
      "broadcast and that carries no hash, came after it and deposited the amount its `open` names into a channel " +
      "whose payee or distribution names the option's payee. This does not show that the account that signed the agreement is " +
      "the opening's payer, nor that amount, recipient, mint or timing match the ATR's content.",
  },
  "mpp/subscription/solana": {
    coverage: "full",
    carrier: { signed: "the Memo instruction of the activation, H's LCP string", member: ["externalId"] },
    source: "stock `@solana/pay-kit` 0.13.1, copying `externalId`",
    nonce: "reusable",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: NOTE,
      search: SEARCH,
      history: HISTORY,
      contracts: ["the Memo Program (version 3 or 4)", "the subscriptions program"],
      lapse: lapse("activation", ", or the signed activation landed naming no account of the payee"),
      life: LIFE,
    },
    destination:
      "the account `transfer_subscription` pays the first period into, counting where its owner per " +
      "`meta.postTokenBalances` is the option's payee",
    asset: "the plan's mint, recorded and compared with nothing",
    payer: "the subscriber's account",
    confirmed: "no",
    proves:
      "The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, a " +
      "subscription's activation, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` " +
      "with no error, which paid the first period to an account the option's payee owns, recorded with its mint and " +
      "amount. The memo is in the transaction's instruction data on chain. Renewals are the seller's later pulls, " +
      "which do not carry the hash. It compares no amount, mint, period or time with the ATR's terms.",
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
      feePayer: { may: ["settler", "buyer"], default: "buyer" },
      succeeded: SUCCEEDED,
    },
    proves: PAID,
  },
});
