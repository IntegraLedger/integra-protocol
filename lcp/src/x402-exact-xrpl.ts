/**
 * The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the
 * payer signs with a single key as the Payment's `InvoiceID`, read back from the signed blob, and settlement read by
 * the blob's hash.
 */
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import {
  acceptedBy,
  advertiseFor,
  chosen,
  filterOf,
  isAmount,
  isTimeoutSeconds,
  offeredAt,
  paymentWith,
  readFor,
  withExtra,
  withOption,
  withoutExtra,
  type X402Read,
} from "./internal/x402.js";
import {
  decodePresented,
  isXrplNetwork,
  networkId,
  networkIdHeld,
  sameInvoice,
  x402InvoiceId,
  xrplStatus,
  type XrplNetwork,
  type XrplPaymentPayload,
  type XrplRef,
  type XrplTxJson,
  type XrplUnsigned,
} from "./internal/xrpl.js";
import { accountIdOf } from "./internal/xrpl-session.js";
import { isObject, normalHash } from "./fields.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";

const ID = "x402/exact/xrpl" as const;
/** A decimal with no sign, exponent or leading zero, whose fraction, if any, ends in a digit other than 0. */
const ISSUED = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const DROPS = /^[1-9][0-9]{0,16}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const I64_LIMIT = 2n ** 63n;
/** AccountID 1, rippled's `noAccount()` (XRPLF/rippled `00e64075`, `src/libxrpl/protocol/AccountID.cpp:165-170`). */
const NO_ACCOUNT = 1n;

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

/**
 * The pairing's option filter, which `advertise`, `read`, `build`, `bound` and `reference` apply: an option of this
 * pairing whose `Destination` and `Amount` `build` can write and whose timeout is a positive safe integer (`payable`),
 * else `x402/option-malformed`.
 */
const filter = filterOf(isThis, payable);

/**
 * True when `build` can write the Payment's `Destination` and `Amount`, and the timeout is a positive safe integer.
 * `payTo` is a classic address whose checksum holds (`accountOf`), and its AccountID is not 0, which rippled 3.4.1
 * (XRPLF/rippled `00e64075`) refuses as any Payment's `Destination`
 * (`src/libxrpl/tx/transactors/payment/Payment.cpp:178-184`). XRP is a positive amount of drops (`isAmount`) below
 * 10^17. An issued currency's `amount` is the canonical decimal of a positive STAmount value, which rippled reads
 * exactly (`isIssuedValue`), the form the XRPL `exact` scheme gives that `amount`, and its `extra.issuer` is a classic
 * address whose checksum holds. On an issued currency neither `payTo` nor the issuer is AccountID 0 or 1: rippled does
 * not read an issued amount whose issuer is 0 (`src/libxrpl/protocol/STAmount.cpp:155-158`), and the payment engine
 * that every issued-currency Payment runs through (`Payment.cpp:611-613`, `:638`) refuses 1, `noAccount()`, as the
 * destination or the issuer (`src/libxrpl/tx/paths/PaySteps.cpp:188-190`). The XRP Payment `build` writes, with no
 * `SendMax` or paths, does not run through that engine (`Payment.cpp:611`, `:756-758`), so an XRP `payTo` may be 1.
 */
function payable(o: PaymentRequirements): boolean {
  if (typeof o.amount !== "string" || typeof o.asset !== "string") return false;
  if (!isTimeoutSeconds(o.maxTimeoutSeconds)) return false;
  if (o.asset === "XRP") return accountOf(o.payTo) > 0n && isAmount(o.amount) && DROPS.test(o.amount);
  return accountOf(o.payTo) > NO_ACCOUNT && accountOf(o.extra?.["issuer"]) > NO_ACCOUNT && isIssuedValue(o.amount);
}

/**
 * The AccountID of a classic address whose checksum holds, as a number, else -1: base58 with the XRPL alphabet of
 * version 0, a 20-byte AccountID and a 4-byte checksum, the first 4 bytes of the double SHA-256 of the two
 * (`accountIdOf`), the form the XRPL `exact` scheme gives `payTo` and `extra.issuer`.
 */
function accountOf(v: unknown): bigint {
  const id = typeof v === "string" ? accountIdOf(v) : null;
  return id === null ? -1n : id.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
}

/**
 * True when `s` is the canonical decimal of a positive STAmount value, which rippled 3.4.1 (XRPLF/rippled `00e64075`)
 * reads exactly. An STAmount value is a mantissa of 10^15 to 10^16 - 1 at an offset of -96 to 80
 * (`include/xrpl/protocol/STAmount.h:35-40,61-68`): IOUAmount rounds a value of more than 16 significant digits and
 * reads one below 10^-81 as zero (`src/libxrpl/protocol/IOUAmount.cpp:29-36,58-68`). `partsFromString`
 * (`src/libxrpl/protocol/STNumber.cpp:159-216`) refuses a leading zero, and reads the digits with the point removed as a
 * `uint64` (`:192`, `:198`) that `STAmount::iou` casts to `int64` (`src/libxrpl/protocol/STAmount.cpp:291`), so they are
 * below 2^63; that also holds the value below the largest offset. So: no sign, exponent or leading zero, a fraction that
 * ends in a digit other than 0, at most 16 significant digits, at least 10^-81, and digits below 2^63. More than 19
 * digits, leading zeros aside, the width of 2^63, are refused before any further step reads them, so each step takes
 * time linear in the length of `s`.
 */
function isIssuedValue(s: string): boolean {
  const m = ISSUED.exec(s);
  if (m === null) return false;
  const fraction = m[2]?.slice(1) ?? "";
  const digits = (m[1]! + fraction).replace(/^0+/, "");
  if (digits === "" || digits.length > 19) return false;
  let significant = digits.length;
  while (digits[significant - 1] === "0") significant--;
  return significant <= 16 && BigInt(digits) < I64_LIMIT && digits.length - 1 - fraction.length - 15 >= -96;
}

/**
 * The option without `extra.invoiceId`: the option as the seller issued it. An option that carries a `refused` member
 * is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
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
  const placed = advertiseFor(filter)(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const invoiceId = toLcpString(h);
  const current = offer.extra?.["invoiceId"];
  if (current !== undefined && current !== invoiceId) return refusal("xrpl/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "invoiceId", invoiceId));
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filter)(doc);
}

/**
 * The Payment for the wallet to sign, with `InvoiceID` = SHA-256 of the option's `extra.invoiceId`, and `NetworkID` the
 * network's id where it is above 1024. `complete` reads the signed blob's `NetworkID` as `bound` does.
 */
async function build(c: XrplChoice, h: AtrHash): Promise<XrplUnsigned<XrplPaymentPayload> | Refusal> {
  if (!isObject(c)) return refusal("x402/not-v2");
  const ok = chosen(c.required, c.accepted, filter);
  if (ok !== true) return ok;
  const { accepted, required } = c;
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
    async complete(signedBlob: string): Promise<XrplPaymentPayload | Refusal> {
      if (typeof signedBlob !== "string" || !HEX.test(signedBlob)) return refusal("xrpl/blob-malformed");
      const payment = paymentWith(required, accepted, { signedTxBlob: signedBlob });
      const blob = await decodePresented(payment.payload, signedBlob);
      if (isRefusal(blob)) return blob;
      return networkIdHeld(blob.tx, accepted.network as XrplNetwork) ? payment : refusal("xrpl/network-mismatch");
    },
  };
}

/**
 * The option, the hash and the decoded blob of a payment, or the refusal that names what is wrong. The blob is decoded
 * once per payload object, so `bound` and `reference` on one payment share one decode. Its `NetworkID` is read first, as
 * rippled 3.4.1 reads it (`networkIdHeld`): none on a network whose id is at most 1024, the network's own id above that,
 * else `xrpl/network-mismatch`.
 */
async function presentedOf(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const blob = await decodePresented(payload, payload["signedTxBlob"]);
  if (isRefusal(blob)) return blob;
  if (!networkIdHeld(blob.tx, accepted.network as XrplNetwork)) return refusal("xrpl/network-mismatch");
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
