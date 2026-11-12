/**
 * The data of the card, ACK, ACP, AP2 and UCP pairings, and of the MPP card and Stripe pairings. No public ledger
 * records these payments, so none has a read.
 */
import { freeze } from "./freeze.js";

export const CARD = /* @__PURE__ */ freeze({
  "card/mastercard-vi/immediate": {
    coverage: "none",
    carrier: {
      signed: "`legalContext` in the `checkout_jwt` (the merchant's, or one the agent created), whose hash the user's mandate signs",
    },
    link: "h",
    source:
      "the merchant's `checkout_jwt`, or one the agent created, into which lcp's `build` writes `legalContext` for the " +
      "agent to sign; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The user's Verifiable Intent L2 mandate lists a checkout mandate " +
      "whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, and the payment " +
      "mandate's transaction_id, where disclosed, equals it. The seller checked those values and did not " +
      "verify the user's signature, which Verifiable Intent has the payment network validate before " +
      "authorization. The card authorization itself does not carry the hash. This does not show that amount, " +
      "payee or timing match the ATR's content.",
  },
  "card/mastercard-vi/autonomous": {
    coverage: "none",
    carrier: { signed: "`legalContext` in the merchant's `checkout_jwt`, whose hash the agent's mandate signs" },
    link: "h",
    source: "the merchant's `checkout_jwt`, into which the seller writes `legalContext`; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The buyer's agent signed a Verifiable Intent L3b checkout mandate " +
      "whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, with the key the user's " +
      "L2 mandate delegates to it. The seller verified both ES256 signatures and the sd_hash links, but not " +
      "the L1 issuer's signature. The user's own signature does not cover the hash, and the seller did not see " +
      "the L3a payment mandate the network received, whose transaction_id Verifiable Intent requires to equal " +
      "this checkout_hash. This does not show that amount, payee or timing match the ATR's content.",
  },
  "card/visa-tap": {
    coverage: "none",
    carrier: {
      signed: "H followed by 32 random bytes in the signature's nonce, which the agent signs; H also in the checkout path for stock agents",
    },
    link: "h",
    source: "lcp's client writes TAP's nonce; the agent signs it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The buyer's agent sent this ATR's hash in the lcp-hash field and " +
      "listed that field among the covered components of every TAP agent-payer-auth message signature in the " +
      "request. The seller checked that listing and did not verify a signature here, which belongs to its TAP " +
      "recognition step. The card authorization itself does not carry the hash. This does not show that " +
      "amount, payee or timing match the ATR's content.",
  },
  "card/seller-reference": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source:
      "the seller writes it in the processor's metadata under `legal_context` (Stripe's `metadata`, Adyen's `metadata`, a " +
      "Braintree custom field, Cybersource's `merchantDefinedInformation`)",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. This ATR's hash and link are for the seller to show the buyer and " +
      "to put in its processor reference. Nothing the buyer signed carries the hash, nothing the buyer signed " +
      "was checked, and settlement is the seller's report. This record does not show that the buyer's approval " +
      "carried the hash.",
  },
  "mpp/charge/card": {
    coverage: "none",
    carrier: { signed: null, member: ["externalId"] },
    link: "h",
    source: "the seller's challenge writes it, in the request's `externalId`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its id and " +
      "its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential " +
      "echoed that challenge. The seller also placed the hash in the method's reference field (externalId for " +
      "card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed " +
      "carries the hash, and nothing the buyer signed was checked. Settlement is the seller's report. This " +
      "record does not show that the buyer's approval carried the hash.",
  },
  "mpp/charge/stripe": {
    coverage: "none",
    carrier: { signed: null, member: ["methodDetails", "metadata", "legal_context"] },
    link: "h",
    source: "the seller's challenge writes it, in the PaymentIntent's `metadata.legal_context`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its id and " +
      "its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential " +
      "echoed that challenge. The seller also placed the hash in the method's reference field (externalId for " +
      "card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed " +
      "carries the hash, and nothing the buyer signed was checked. Settlement is the seller's report. This " +
      "record does not show that the buyer's approval carried the hash.",
  },
  "mpp/subscription/stripe": {
    coverage: "none",
    carrier: { signed: null, member: ["methodDetails", "metadata", "legal_context"] },
    link: "h",
    source: "the seller's challenge writes it, in the PaymentIntent's `metadata.legal_context`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its id and " +
      "its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential " +
      "echoed that challenge. The seller also placed the hash in the method's reference field (externalId for " +
      "card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed " +
      "carries the hash, and nothing the buyer signed was checked. Settlement is the seller's report. This " +
      "record does not show that the buyer's approval carried the hash. The close is the seller's report.",
  },
  "ap2/checkout-mandate": {
    coverage: "none",
    carrier: { signed: "the mandate's `checkout_hash`, over a merchant-signed checkout carrying H" },
    link: "h",
    source: "the merchant-signed checkout carries H; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The buyer's closed AP2 Checkout Mandate carries checkout_hash, " +
      "the SHA-256 of the checkout JWT presented beside it, and that JWT's payload carries this ATR's hash as " +
      "its legalContext member. The mandate's signer is the user's trusted surface, or the agent under the " +
      "user's open mandate, presented before it in a chain. The seller did not verify that signature, the open " +
      "mandate's signature or delegation to the agent's key (cnf), or the chain's link between them: AP2 has " +
      "the Credential Provider verify the Payment Mandate, whose transaction_id is the same hash, before a " +
      "payment credential issues. The seller reported the payment. This does not show that amount, payee or " +
      "timing match the ATR's content.",
  },
  "ucp/checkout/ap2-mandate": {
    coverage: "none",
    carrier: { signed: "the mandate's `checkout_hash`, over the checkout whose `links[]` carries H" },
    link: "h",
    source: "the merchant-signed checkout's `links[]` carries H; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The checkout carried this ATR's hash and link as its " +
      "legal_context link. The buyer's checkout mandate under UCP's AP2 Mandates extension carries " +
      "checkout_hash, the SHA-256 of the checkout presented beside it, and the hash was read from that " +
      "checkout. The seller did not verify the mandate's signature, or, where an open mandate precedes it in a " +
      "chain, that mandate's signature, its delegation (cnf) or the chain's link; the PSP verifies the payment " +
      "mandate over the same checkout hash. Settlement is the seller's report. This does not show that amount, " +
      "payee or timing match the ATR's content.",
  },
  "acp/checkout/delegated": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source:
      "the seller writes the session id and its `metadata.legal_context`; lcp's client writes the allowance's " +
      "`checkout_session_id`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The checkout session this payment completed has this ATR's hash " +
      "as its id, and its responses carried the ATR's link in metadata. The payment handler required " +
      "delegate_payment, so ACP has the buyer's agent obtain a vault token whose allowance names this session " +
      "as checkout_session_id, in a request the agent signs (a MUST in one section of ACP and RECOMMENDED in " +
      "another) and the PSP SHOULD verify. No signature was verified here, and ACP does not require the PSP to " +
      "hold the token to that session. The seller tied the payment to the hash in its report. This does not " +
      "show that amount, payee or timing match the ATR's content.",
  },
  "acp/checkout/undelegated": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the session id and its `metadata.legal_context`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The checkout session this payment completed has this ATR's hash " +
      "as its id, and its responses carried the ATR's link in metadata. The payment handler did not require " +
      "delegate_payment, so nothing the buyer signed for the payment names the hash. The seller tied the " +
      "payment to the hash in its report.",
  },
  "ucp/checkout/unsigned": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the checkout's `links[]`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The checkout response carried this ATR's hash and link as its " +
      "legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the buyer's " +
      "approval did not sign the hash. The seller tied the payment to the hash in its report.",
  },
  "ack/payment-request": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the seller-signed token's id",
    nonce: "unshown",
    broadcasts: "payer",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. This ATR's hash is the id of the seller's ACK Payment Request " +
      "token, with the link beside it; a receipt for that request embeds the token. The token's signature is " +
      "not verified here. ACK defines no payer signature, so nothing the buyer signed carries the hash, and " +
      "settlement is the seller's report. This does not show that the buyer's approval carried the hash.",
  },
  "ucp/booking/ap2-mandate": {
    coverage: "none",
    carrier: { signed: "the mandate's `checkout_hash`, over the booking whose `links[]` carries H" },
    link: "h",
    source: "the booking's `links[]` carries H; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The booking carried this ATR's hash and link as its legal_context " +
      "link. The buyer's checkout mandate under UCP's AP2 Mandates extension carries checkout_hash, the " +
      "SHA-256 of the booking presented beside it, and the hash was read from that booking. The seller did not " +
      "verify the mandate's signature, or, where an open mandate precedes it in a chain, that mandate's " +
      "signature, its delegation (cnf) or the chain's link; the PSP verifies the payment mandate over the same " +
      "booking hash. Settlement is the seller's report. This does not show that amount, payee or timing match " +
      "the ATR's content.",
  },
  "ucp/booking/unsigned": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the booking's `links[]`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The booking response carried this ATR's hash and link as its " +
      "legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the buyer's " +
      "approval did not sign the hash. The seller tied the payment to the hash in its report.",
  },
});
