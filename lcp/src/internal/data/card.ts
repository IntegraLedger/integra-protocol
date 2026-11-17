/**
 * The data of the card, ACK, ACP, AP2 and UCP pairings, and of the MPP card and Stripe pairings. None of these payments
 * is read here, so none has a read, except the AP2 x402 route's, which is read as the x402 EIP-3009 payment it carries.
 */
import { EIP155_X402 } from "./eip155-x402.js";
import { freeze } from "./freeze.js";

/**
 * What every pairing here whose payment is not read shows of the agreement that comes first (lcp's codec rule 5, at
 * coverage `none`): an account signed it, and nothing compares that account with this payment's payer, nor shows when
 * the payment was taken.
 */
export const AGREEMENT_FIRST =
  "An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, " +
  "before this payment was taken or reported. This shows neither that the account is this payment's payer nor " +
  "when this payment was taken, which nothing here reads. ";

/**
 * The same for a pairing whose payment is read (rule 5: the time clause only where the charge is not read): the
 * agreement came first, and nothing compares its signer with the payer.
 */
export const AGREEMENT_FIRST_READ =
  "An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, " +
  "before this payment was taken. This does not show that the account is this payment's payer. ";

/** The carried pairing of `ap2/checkout-mandate/x402`, whose read the route takes. */
const EIP3009 = EIP155_X402["x402/exact/eip155/eip3009"];
const EIP3009_READ = EIP3009.read!;

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
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The Verifiable Intent L2 mandate presented lists a checkout mandate whose checkout_hash is the SHA-256 " +
      "of a checkout_jwt carrying this ATR's hash, and the payment mandate's transaction_id, where disclosed, " +
      "equals it. The seller checked those values and did not verify the L2 mandate's signature, which " +
      "Verifiable Intent has the payment network validate before authorization, and nothing compares the L2 " +
      "mandate's signer with the account that signed the agreement. The card authorization itself does not " +
      "carry the hash. This does not show that amount, payee or timing match the ATR's content.",
  },
  "card/mastercard-vi/autonomous": {
    coverage: "none",
    carrier: { signed: "`legalContext` in the merchant's `checkout_jwt`, whose hash the agent's mandate signs" },
    link: "h",
    source: "the merchant's `checkout_jwt`, into which the seller writes `legalContext`; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "An agent signed a Verifiable Intent L3b checkout mandate whose checkout_hash is the SHA-256 of a " +
      "checkout_jwt carrying this ATR's hash, with the key the presented L2 mandate delegates to it. The seller " +
      "verified both ES256 signatures and the sd_hash links, but not the L1 issuer's signature, and nothing " +
      "compares the L2 or L3b signer with the account that signed the agreement. The L2 signature does not " +
      "cover the hash, and the seller did not see the L3a payment mandate the network received, whose " +
      "transaction_id Verifiable Intent requires to equal this checkout_hash. This does not show that amount, " +
      "payee or timing match the ATR's content.",
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
      AGREEMENT_FIRST +
      "Every TAP agent-payer-auth message signature in the agent's checkout request covers this ATR's hash: " +
      "its nonce, whose first 32 bytes are the hash, or the request's path, whose last segment is the hash. " +
      "The seller checked where the hash rides and did not verify a signature here, which belongs to its TAP " +
      "recognition step, and nothing compares the agent's key with the account that signed the agreement. The " +
      "card authorization itself does not carry the hash. This does not show that amount, payee or timing " +
      "match the ATR's content.",
  },
  "card/mastercard-agent-pay": {
    coverage: "none",
    carrier: {
      signed:
        "H followed by 32 random bytes in the nonce of an Agent Pay message signature, which the agent signs; H also in " +
        "the checkout path for an agent whose nonce does not carry it",
    },
    link: "h",
    source: "lcp's client writes the nonce; the agent signs it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "Every Mastercard Agent Pay message signature in the agent's checkout request, tagged Agent-pay-auth or " +
      "agent-pay-auth, covers this ATR's hash: its nonce, whose first 32 bytes are the hash, or the request's " +
      "path, whose last segment is the hash. The seller checked where the hash rides and did not verify a " +
      "signature here, and nothing compares the agent's key with the account that signed the agreement. The " +
      "card authorization itself does not carry the hash. This does not show that amount, payee or timing " +
      "match the ATR's content.",
  },
  "card/visa-vic": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source:
      "lcp's client writes H as unpadded base64url in the `transactionReferenceId` of the agent's API request to Visa for " +
      "the sale's credential; Visa signs the credential payload that returns it, and nothing the payer signs carries it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The agent's Visa Intelligent Commerce credential request carried this ATR's hash as its " +
      "transactionReferenceId, which the seller read from the credential payload Visa signs for the sale. " +
      "Verifying that payload is the seller's and was not done here, and nothing compares the agent or the " +
      "cardholder with the account that signed the agreement. The card authorization itself does not carry the " +
      "hash. This does not show that amount, payee or timing match the ATR's content.",
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
      AGREEMENT_FIRST +
      "This ATR's hash and link are for the seller to show the buyer before payment and to put in its " +
      "processor's metadata under legal_context, beside the seller's own reference for the charge. Nothing the " +
      "payer signed for this payment carries the hash, and the payment is known from the seller's report alone, " +
      "which names it by that reference. This does not show that the payer's approval carried the hash.",
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
      AGREEMENT_FIRST +
      "The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the " +
      "challenge by the seller's own server, and the credential presented echoed that challenge. The seller " +
      "also placed the hash in the request's externalId. Nothing the payer or its card signed carries the hash, " +
      "and the payment is known from the seller's report alone. This does not show that the payer's approval " +
      "carried the hash.",
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
      AGREEMENT_FIRST +
      "The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the " +
      "challenge by the seller's own server, and the credential presented echoed that challenge. The seller " +
      "also placed the hash in the PaymentIntent's metadata under legal_context. Nothing the payer or its " +
      "Stripe token signed carries the hash, and the payment is known from the seller's report alone. This does " +
      "not show that the payer's approval carried the hash.",
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
      AGREEMENT_FIRST +
      "The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the " +
      "challenge by the seller's own server, and the credential presented echoed that challenge. The seller " +
      "also placed the hash in the metadata under legal_context of the payment that activates the subscription. " +
      "Nothing the payer or its Stripe token signed carries the hash, and the activation is known from the " +
      "seller's report alone. This does not show that the payer's approval carried the hash.",
  },
  "ap2/checkout-mandate": {
    coverage: "none",
    carrier: { signed: "the mandate's `checkout_hash`, over a merchant-signed checkout carrying H" },
    link: "h",
    source: "the merchant-signed checkout carries H; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "either",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The closed AP2 Checkout Mandate presented carries checkout_hash, the SHA-256 of the checkout JWT " +
      "presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member. AP2 has " +
      "the mandate signed by the user's trusted surface, or by the agent under the user's open mandate " +
      "presented before it in a chain. That signature, the open mandate's signature, its delegation to the " +
      "agent's key (cnf) and the chain's link were not verified here, and nothing compares the mandate's signer " +
      "with the account that signed the agreement: AP2 has the Credential Provider verify the Payment Mandate, " +
      "whose transaction_id is the same hash, before a payment credential issues. The payment, whether the " +
      "merchant initiated it or the payer's side sent it, is known from the seller's report alone. This does " +
      "not show that amount, payee or timing match the ATR's content.",
  },
  "ucp/checkout/ap2-mandate": {
    coverage: "none",
    carrier: { signed: "the mandate's `checkout_hash`, over the checkout whose `links[]` carries H" },
    link: "h",
    source: "the merchant-signed checkout's `links[]` carries H; the buyer's side signs over it",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The checkout carried this ATR's hash and link as its legal_context link. The checkout mandate presented " +
      "under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the checkout JWT presented " +
      "beside it, and the hash was read from that JWT's checkout. The mandate's signature, and, where an open " +
      "mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, " +
      "were not verified here, and nothing compares the mandate's signer with the account that signed the " +
      "agreement; the PSP verifies the payment mandate over the same checkout hash. The payment is known " +
      "from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.",
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
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The checkout session this payment completed has this ATR's hash as its id, and its responses carried the " +
      "ATR's link in metadata. The payment handler required delegate_payment, so ACP has the agent obtain a " +
      "vault token whose allowance names this session as checkout_session_id, in a request the agent signs (a " +
      "MUST in one section of ACP and RECOMMENDED in another) and the PSP SHOULD verify. No signature was " +
      "verified here, nothing compares the agent's signer with the account that signed the agreement, and ACP " +
      "does not require the PSP to hold the token to that session. The payment is known from the seller's " +
      "report alone. This does not show that amount, payee or timing match the ATR's content.",
  },
  "acp/checkout/undelegated": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the session id and its `metadata.legal_context`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The checkout session this payment completed has this ATR's hash as its id, and its responses carried the " +
      "ATR's link in metadata. The payment handler did not require delegate_payment, so nothing the payer " +
      "signed for the payment names the hash. The payment is known from the seller's report alone, which names " +
      "it by the seller's own reference for the charge.",
  },
  "ucp/checkout/unsigned": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the checkout's `links[]`",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The checkout response carried this ATR's hash and link as its legal_context link. UCP without the AP2 " +
      "Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The " +
      "payment is known from the seller's report alone, which names it by the seller's own reference for the " +
      "charge.",
  },
  "ack/payment-request": {
    coverage: "none",
    carrier: { signed: null },
    link: "h",
    source: "the seller writes it: the seller-signed token's id",
    nonce: "unshown",
    broadcasts: "payer",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "This ATR's hash is the id of the seller's ACK Payment Request token, with the link beside it; a receipt " +
      "for that request embeds the token. The token's signature is not verified here. ACK defines no payer " +
      "signature, so nothing the payer signed carries the hash, and the payment, which the payer's side sends " +
      "before it presents the receipt, is known from the seller's report alone. This does not show that the " +
      "payer's approval carried the hash.",
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
      AGREEMENT_FIRST +
      "The booking carried this ATR's hash and link as its legal_context link. The checkout mandate presented " +
      "under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the booking JWT presented " +
      "beside it, and the hash was read from that JWT's booking. The mandate's signature, and, where an open " +
      "mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, " +
      "were not verified here, and nothing compares the mandate's signer with the account that signed the " +
      "agreement; the PSP verifies the payment mandate over the same booking hash. The payment is known " +
      "from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.",
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
      AGREEMENT_FIRST +
      "The booking response carried this ATR's hash and link as its legal_context link. UCP without the AP2 " +
      "Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The " +
      "payment is known from the seller's report alone.",
  },
  "ap2/checkout-mandate/x402": {
    coverage: "none",
    carrier: {
      signed:
        "the mandate's `checkout_hash`, over a merchant-signed checkout carrying H; the x402 authorization's nonce is " +
        "keccak-256 of the payment mandate chain, and carries no H",
    },
    link: "h",
    source:
      "the merchant-signed checkout carries H; the buyer's side signs over it; AP2's x402 credential provider writes the " +
      "authorization's nonce from the payment mandate chain",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      ...EIP3009_READ,
      search:
        "As `x402/exact/eip155/eip3009`'s, the authorization's own nonce, keccak-256 of the payment mandate chain, " +
        "standing where that pairing has H: " +
        EIP3009_READ.search,
    },
    destination:
      "the `Transfer` from the signed `from` that the token consuming the authorization emitted in that transaction; its " +
      "`to` compared on a charge with the x402 method's `address`, the reference's payee",
    asset: "that `Transfer`'s token, recorded as observed and compared with nothing",
    payer: "the authorization's `from` (the `authorizer`), the signer of its nonce",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST_READ +
      "The payment paid <amount> of the token <asset> to <recipient> in <payment transaction> on <payment network>: an " +
      "EIP-3009 transfer authorization whose nonce is keccak-256 of the payment mandate chain it was presented with, as " +
      "AP2's payment processor requires, and whose chain's closed Payment Mandate names, as its transaction_id, the " +
      "checkout_hash of the closed AP2 Checkout Mandate presented. That checkout_hash is the SHA-256 of the checkout " +
      "JWT presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member; the payment " +
      "itself carries no hash of this ATR. No mandate signature was verified here: AP2 has the Credential Provider " +
      "verify the mandates. This does not show that amount, payee or timing match the ATR's content.",
  },
  "ucp/checkout/agent-signed": {
    coverage: "none",
    carrier: {
      signed:
        "the `legal_context` member of the platform's request that completes the checkout, which the platform's RFC 9421 " +
        "signature covers through `content-digest`",
    },
    link: "h",
    source: "lcp's client writes the member from the checkout's `legal_context` link; the platform signs the request",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      AGREEMENT_FIRST +
      "The checkout response carried this ATR's hash and link as its legal_context link, and the platform's request " +
      "that completed the checkout carried the hash in its legal_context member, with a Content-Digest that is the " +
      "SHA-256 of that request's body. The platform's RFC 9421 signature over the request, which UCP has the business " +
      "verify with the key in the platform's profile, was not verified here, and nothing ties that key to the account " +
      "that signed the agreement. The seller reported the payment. This does not show that amount, payee or timing " +
      "match the ATR's content.",
  },
});
