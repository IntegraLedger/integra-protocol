/**
 * The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the
 * payer signs with a single key as the Payment's `InvoiceID`, read back from the signed blob, and settlement read by
 * the blob's hash.
 */
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import {
  decodePresented,
  isXrplNetwork,
  networkId,
  sameInvoice,
  x402InvoiceId,
  xrplStatus,
  type XrplRef,
  type XrplTxJson,
  type XrplUnsigned,
} from "./internal/xrpl.js";
import { isObject } from "./fields.js";
import { refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  offeredAt,
  paymentWith,
  readFor,
  tie,
  withExtra,
  withOption,
  withoutExtra,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

const ID = "x402/exact/xrpl" as const;
const AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const DROPS = /^[1-9][0-9]{0,16}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;

/** A payment on this pairing: the wallet's signed blob, hex. */
export interface XrplPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { signedTxBlob: string };
  extensions?: PaymentRequired["extensions"];
}

export interface XrplChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  account: string;
  fee: string;
  sequence: number;
  ticketSequence?: number;
  lastLedgerSequence: number;
}

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  if (!isObject(option) || option.scheme !== "exact" || !isXrplNetwork(option.network)) return undefined;
  if (!isObject(option.extra) || option.extra["areFeesSponsored"] !== false) return undefined;
  const method = option.extra["assetTransferMethod"];
  if (method !== undefined && method !== "sequence" && method !== "ticketSequence") return undefined;
  const invoiceId = option.extra["invoiceId"];
  if (invoiceId !== undefined && typeof invoiceId !== "string") return undefined;
  return ID;
}

const isThis = (o: PaymentRequirements): boolean => pairingOf(o) !== undefined;

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
  if ("refused" in placed) return placed;
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
  const ok = chosen(c.required, c.accepted, filterOf(isThis));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
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
  if ("refused" in blob) return blob;
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
  return "refused" in p ? p : p.h;
}

/** The read keys for finding this payment later, all from the single-signed blob. */
async function reference(presented: unknown): Promise<Omit<XrplRef, "fromLedger"> | Refusal> {
  const p = await presentedOf(presented);
  if ("refused" in p) return p;
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
