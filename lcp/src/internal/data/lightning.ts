/** The data of the Lightning pairings. */
import { freeze } from "./freeze.js";

/** What every Lightning pairing's record shows of the agreement: an account signed it before the payment. */
const AGREEMENT =
  "An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, " +
  "before this payment was taken or reported. This shows neither that the account is this payment's payer nor when " +
  "this payment was taken, which nothing here reads. ";

/** What a preimage shows, and that the seller reports the payment. */
const PREIMAGE =
  "The preimage, which every node on the payment's route learns, shows that the secret behind the hash left the " +
  "seller's custody, never who paid, and to anyone but the seller's node not that the invoice was paid; no public " +
  "ledger shows the payment. Settlement is the seller's report. This does not show that amount, payee or timing " +
  "match the ATR's content.";

/** The MPP pairings' invoice: its description hash is H, which the seller's node signs. */
const MPP_INVOICE =
  "The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. " +
  "The invoice is decoded strictly and its signer is recovered; no payee key is compared with that signer, and the " +
  "payer signed nothing that carries the hash. ";

export const LIGHTNING = /* @__PURE__ */ freeze({
  "x402/exact/lnbtc/payment-hash": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: no client writes H; the ATR commits the option's extra.paymentHash, the invoice's payment hash",
    nonce: "single-use",
    broadcasts: "payer",
    destination: "the invoice's signer, held to the option's payTo by the scheme's validation before the payment is taken",
    asset: "BTC",
    payer: "none named",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      AGREEMENT +
      "The ATR commits the payment hash of the BOLT11 invoice paid, whose signer is held to the option's payTo; the " +
      "payer signed nothing that carries the hash. " +
      PREIMAGE,
  },
  "mpp/charge/lightning": {
    coverage: "none",
    carrier: { signed: null, member: ["methodDetails", "invoice"] },
    link: "h",
    source: "none on the buyer's side: the invoice's description hash is H, which the seller's node signs",
    nonce: "single-use",
    broadcasts: "payer",
    destination: "the invoice's signer, held by the server's byte-equality with the invoice its node issued",
    asset: "the request's currency",
    payer: "none named",
    agreementOn: "any",
    confirmed: "no",
    proves: AGREEMENT + MPP_INVOICE + PREIMAGE,
  },
  "mpp/session/lightning": {
    coverage: "none",
    carrier: { signed: null, member: ["depositInvoice"] },
    link: "h",
    source: "none on the buyer's side: the deposit invoice's description hash is H, which the seller's node signs",
    nonce: "single-use",
    broadcasts: "either",
    destination: "the invoice's signer, held by the server's byte-equality with the invoice its node issued",
    asset: "the request's currency",
    payer: "none named",
    agreementOn: "any",
    confirmed: "no",
    proves: AGREEMENT + MPP_INVOICE + PREIMAGE + " The close is the seller's report.",
  },
});
