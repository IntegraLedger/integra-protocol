/**
 * The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the
 * payer signs with a single key as the Payment's `InvoiceID`, read back from the signed blob, and settlement read by
 * the blob's hash.
 */
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  offeredAt,
  readFor,
  withExtra,
  withOption,
  type X402Read,
} from "./internal/x402.js";
import {
  decodePresented,
  isXrplNetwork,
  networkId,
  sameInvoice,
  x402InvoiceId,
  xrplStatus,
  type XrplPaymentPayload,
  type XrplRef,
  type XrplTxJson,
  type XrplUnsigned,
} from "./internal/xrpl.js";
import { isObject, normalHash } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  paymentWith,
  tie,
  withoutExtra,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";

const ID = "x402/exact/xrpl" as const;
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const DROPS = /^[1-9][0-9]{0,16}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;

interface XrplChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  account: string;
  fee: string;
  sequence: number;
  ticketSequence?: number;
  lastLedgerSequence: number;
}

/**
 * The pairing's filter: an `exact` option on an `xrpl:` network with `extra.areFeesSponsored` false, an
 * `extra.assetTransferMethod` absent, `sequence` or `ticketSequence`, and an `extra.invoiceId` absent or a string.
 */
function isThis(option: PaymentRequirements): boolean {
  if (!isObject(option) || option.scheme !== "exact" || !isXrplNetwork(option.network)) return false;
  if (!isObject(option.extra) || option.extra["areFeesSponsored"] !== false) return false;
  const method = option.extra["assetTransferMethod"];
  if (method !== undefined && method !== "sequence" && method !== "ticketSequence") return false;
  const invoiceId = option.extra["invoiceId"];
  return invoiceId === undefined || typeof invoiceId === "string";
}

/** True when `build` can write the Payment's `Amount`: XRP drops, or an issued amount with `extra.issuer`. */
function payable(o: PaymentRequirements): boolean {
  if (typeof o.amount !== "string" || typeof o.asset !== "string" || typeof o.payTo !== "string") return false;
  if (o.asset === "XRP") return DROPS.test(o.amount);
  return AMOUNT.test(o.amount) && typeof o.extra?.["issuer"] === "string";
}

/** The option without `extra.invoiceId`: the option as the seller issued it. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return withoutExtra(option, "invoiceId");
}

/** The challenge's `extensions.legalContext` set, and the chosen option's `extra.invoiceId` set to the hash's LCP string. */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filterOf(isThis, payable))(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const invoiceId = toLcpString(h);
  const current = offer.extra?.["invoiceId"];
  if (current !== undefined && current !== invoiceId) return refusal("xrpl/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "invoiceId", invoiceId));
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filterOf(isThis))(doc);
}

/** The Payment for the wallet to sign, with `InvoiceID` = SHA-256 of the option's `extra.invoiceId`. */
async function build(c: XrplChoice, h: AtrHash): Promise<XrplUnsigned<XrplPaymentPayload> | Refusal> {
  if (!isObject(c)) return refusal("x402/not-v2");
  const ok = chosen(c.required, c.accepted, filterOf(isThis));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  if (accepted.extra!["invoiceId"] !== toLcpString(h)) return refusal("xrpl/carrier-mismatch");
  const u32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
  const ticket = accepted.extra!["assetTransferMethod"] === "ticketSequence";
  if (typeof c.account !== "string" || typeof c.fee !== "string" || !DROPS.test(c.fee) || !u32(c.lastLedgerSequence)) {
    return refusal("x402/option-malformed");
  }
  if (ticket ? !u32(c.ticketSequence) : !u32(c.sequence)) return refusal("x402/option-malformed");
  const extra = accepted.extra!;
  const amount =
    accepted.asset === "XRP"
      ? accepted.amount
      : { currency: accepted.asset, issuer: extra["issuer"] as string, value: accepted.amount };
  const txJson: XrplTxJson = {
    TransactionType: "Payment",
    Flags: 0,
    Account: c.account,
    Destination: accepted.payTo,
    Amount: amount,
    ...(accepted.asset === "XRP" ? {} : { SendMax: amount }),
    ...(extra["destinationTag"] !== undefined ? { DestinationTag: extra["destinationTag"] } : {}),
    InvoiceID: await x402InvoiceId(h),
    Fee: c.fee,
    Sequence: ticket ? 0 : c.sequence,
    ...(ticket ? { TicketSequence: c.ticketSequence } : {}),
    LastLedgerSequence: c.lastLedgerSequence,
    ...(networkId(accepted.network as `xrpl:${number}`) > 1024 ? { NetworkID: networkId(accepted.network as `xrpl:${number}`) } : {}),
  };
  return {
    request: { kind: "xrpl-tx", txJson },
    complete(signedBlob: string): XrplPaymentPayload | Refusal {
      if (typeof signedBlob !== "string" || !HEX.test(signedBlob)) return refusal("xrpl/blob-malformed");
      return paymentWith(required, accepted, { signedTxBlob: signedBlob });
    },
  };
}

/**
 * The option, the hash and the decoded blob of a payment, or the refusal that names what is wrong. The blob is decoded
 * once per payload object, so `bound` and `reference` on one payment share one decode.
 */
async function presentedOf(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"] as PaymentRequirements;
  if (!isObject(accepted) || !isThis(accepted)) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const blob = await decodePresented(payload, payload["signedTxBlob"]);
  if (isRefusal(blob)) return blob;
  if (blob.tx.TransactionType !== "Payment") return refusal("xrpl/not-payment");
  if (typeof blob.tx.InvoiceID !== "string") return refusal("xrpl/no-invoice-id");
  const h = fromLcpString(accepted.extra?.["invoiceId"] as string);
  if (h === null) return refusal("xrpl/carrier-not-lcp");
  if (!sameInvoice(blob.tx.InvoiceID, await x402InvoiceId(h))) return refusal("xrpl/carrier-mismatch");
  return { accepted, blob, h };
}

/**
 * The hash whose LCP string's SHA-256 is the signed `InvoiceID`. A multi-signed blob is refused `xrpl/multisigned`:
 * the payer signs with a single key. The signature is not verified here; the facilitator validates it, and any change
 * to a single-signed blob invalidates it.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = await presentedOf(presented);
  return isRefusal(p) ? p : p.h;
}

/** The read keys for finding this payment later, all from the single-signed blob. */
async function reference(presented: unknown): Promise<Omit<XrplRef, "fromLedger"> | Refusal> {
  const p = await presentedOf(presented);
  if (isRefusal(p)) return p;
  const lls = p.blob.tx.LastLedgerSequence;
  return {
    network: p.accepted.network as XrplRef["network"],
    transaction: p.blob.hash,
    expect: p.blob.tx.InvoiceID!.toUpperCase(),
    lastLedgerSequence: Number.isInteger(lls) ? lls! : null,
  };
}

const pattern: LcpPattern = Object.freeze({
  pattern: "id-reuse",
  canonical: true,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed, with a single key, an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash in LCP " +
    "string form, and the Payment is in a validated ledger with tesSUCCESS. The hash can be confirmed from the ATR's bytes but not " +
    "recovered from the ledger alone. This does not show that amount, destination, asset or timing match the ATR's " +
    "content.",
});

export const exactXrpl = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "extra.invoiceId" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: xrplStatus,
});
