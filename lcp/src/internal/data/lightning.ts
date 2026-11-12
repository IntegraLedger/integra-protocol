/** The data of the MPP Lightning pairings. */
import { freeze } from "./freeze.js";

export const LIGHTNING = /* @__PURE__ */ freeze({
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
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's node's BOLT11 invoice's description hash is this " +
      "ATR's hash, and the ATR commits its payment hash. Its signature is not verified here, and the payer " +
      "signed nothing that carries the hash. Settlement is the seller's report; the invoice and its preimage, " +
      "which the parties hold, show that the invoice was paid; they do not show who paid it, and no public " +
      "ledger shows the payment. This does not show that amount, payee or timing match the ATR's content.",
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
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's node's BOLT11 invoice's description hash is this " +
      "ATR's hash, and the ATR commits its payment hash. Its signature is not verified here, and the payer " +
      "signed nothing that carries the hash. Settlement is the seller's report; the invoice and its preimage, " +
      "which the parties hold, show that the invoice was paid; they do not show who paid it, and no public " +
      "ledger shows the payment. This does not show that amount, payee or timing match the ATR's content. The " +
      "close is the seller's report.",
  },
});
