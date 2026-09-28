/**
 * `mpp/charge/xrpl`: the ATR hash itself, as 64 upper-case hex digits, placed as the request's
 * `methodDetails.invoiceId`, which the payer signs with a single key as the Payment's `InvoiceID`.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import {
  decodePresented,
  mppInvoiceId,
  sameInvoice,
  xrplInvoiceOf,
  xrplStatus,
  type XrplReader,
  type XrplRef,
  type XrplTxJson,
} from "./internal/xrpl.js";
import {
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  isObject,
  placeCarrier,
  pushedField,
  read,
  tie,
  type Checked,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { xrplNetworkOf } from "./mpp-rail-checks.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const ID = "mpp/charge/xrpl" as const;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const HASH = /^[0-9A-Fa-f]{64}$/;
const DROPS = /^(0|[1-9][0-9]{0,18})$/;

/** The buyer's inputs to `build`: the paying account and the buyer's own reads of fee, sequence and ledger. */
export interface XrplChargeChoice {
  challenge: MppChallenge & { id: string };
  account: string;
  fee: string;
  sequence: number;
  lastLedgerSequence: number;
}

export interface XrplChargeUnsigned {
  request: { kind: "xrpl-tx"; txJson: XrplTxJson };
  /** The wallet's signed blob, hex. */
  complete(signedBlob: string): MppCredential | Refusal;
}

/** The signed blob a credential presents: its `blob`, or for `type="hash"` the one fetched by that hash. */
function presentedBlob(payload: { [k: string]: Json }): string | Refusal {
  const type = payload["type"];
  if (type !== "transaction" && type !== "hash") return refusal("mpp/credential-type");
  const blob = payload["blob"];
  if (blob === undefined) return type === "hash" ? refusal("xrpl/read-first") : refusal("xrpl/blob-malformed");
  return typeof blob === "string" ? blob : refusal("xrpl/blob-malformed");
}

async function bindingOf(
  credential: MppCredential,
): Promise<{ h: AtrHash; checked: Checked; tx: XrplTxJson; hash: string } | Refusal> {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const blob = presentedBlob(e.payload);
  if (isRefusal(blob)) return blob;
  const decoded = await decodePresented(e.payload, blob);
  if (isRefusal(decoded)) return decoded;
  const { tx } = decoded;
  if (tx.TransactionType !== "Payment") return refusal("xrpl/not-payment");
  if (typeof tx.InvoiceID !== "string") return refusal("xrpl/no-invoice-id");
  const md = e.checked.details;
  if (!sameInvoice(tx.InvoiceID, md["invoiceId"])) return refusal("xrpl/carrier-mismatch");
  if (!hashEquals(`0x${tx.InvoiceID.toLowerCase()}`, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx, hash: decoded.hash };
}

/**
 * H from the echoed challenge, once the signed Payment's `InvoiceID` is the request's `invoiceId` and equals that H. A
 * multi-signed blob is refused `xrpl/multisigned`: the payer signs with a single key. The blob is decoded once per
 * payload object, so `bound` and `reference` on one credential share one decode.
 */
async function bound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if ("refused" in credential) return credential;
  const b = await bindingOf(credential);
  return isRefusal(b) ? b : b.h;
}

/** The read keys from the single-signed blob: its hash, its `InvoiceID`, and its `LastLedgerSequence` or null. */
async function reference(input: unknown): Promise<Omit<XrplRef, "fromLedger"> | Refusal> {
  const credential = credentialOf(input);
  if ("refused" in credential) return credential;
  const b = await bindingOf(credential);
  if (isRefusal(b)) return b;
  const network = xrplNetworkOf(b.checked.details);
  if (typeof network !== "string") return network;
  const last = b.tx.LastLedgerSequence;
  return {
    network,
    transaction: b.hash,
    expect: (b.tx.InvoiceID as string).toUpperCase(),
    lastLedgerSequence: typeof last === "number" ? last : null,
  };
}

/**
 * A push credential (`type="hash"`) with the signed blob added as `blob`, read by that hash once the transaction is in a
 * validated ledger. Other credentials are returned unchanged. A read that fails, finds nothing, or finds the transaction
 * not yet validated is a refusal the seller retries; a validated result other than `tesSUCCESS` is refused
 * `xrpl/not-success`. At most two calls.
 */
async function fetchPresented(credential: MppCredential, reader: XrplReader): Promise<MppCredential | Refusal> {
  if (!isObject(credential) || !isObject(credential.payload)) return refusal("mpp/credential-malformed");
  if (credential.payload["type"] !== "hash") return credential;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const network = xrplNetworkOf(e.checked.details);
  if (typeof network !== "string") return network;
  if (reader.network !== network) return refusal("xrpl/wrong-reader");
  const hash = credential.payload["hash"];
  if (typeof hash !== "string" || !HASH.test(hash)) return refusal("mpp/credential-malformed");
  let landed: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    landed = await reader.tx(hash.toUpperCase(), null);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (typeof landed !== "object" || landed === null) return refusal("xrpl/unreadable");
  if ("notFound" in landed) return refusal("xrpl/not-found");
  if (landed.validated !== true) return refusal("xrpl/not-validated");
  if (landed.result !== "tesSUCCESS") return refusal("xrpl/not-success");
  let blob: string | null;
  try {
    blob = await reader.txBlob(hash.toUpperCase());
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (blob === null) return refusal("xrpl/not-found");
  if (typeof blob !== "string") return refusal("xrpl/unreadable");
  return { ...credential, payload: { ...credential.payload, blob } };
}

/**
 * The Payment for the wallet to sign: `Destination` the request's `recipient`, `Amount` from its `currency` (drops,
 * an issued amount with `SendMax` equal to it, or an MPT amount), `InvoiceID` the request's `invoiceId`, which must be
 * this H, and the request's tags. A request with `memos` is refused.
 */
async function build(choice: XrplChargeChoice, h: AtrHash): Promise<XrplChargeUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const checked = chosenFor(choice.challenge, h, ID);
  if (isRefusal(checked)) return checked;
  const r = checked.request;
  const d = checked.details;
  if (!sameInvoice(d["invoiceId"], mppInvoiceId(h))) return refusal("xrpl/carrier-mismatch");
  if (d["memos"] !== undefined) return refusal("xrpl/memos-not-carried");
  const u32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
  if (
    typeof choice.account !== "string" ||
    typeof choice.fee !== "string" ||
    !DROPS.test(choice.fee) ||
    !u32(choice.sequence) ||
    !u32(choice.lastLedgerSequence)
  ) {
    return refusal("mpp/input-malformed");
  }
  const currency = r["currency"];
  const value = r["amount"] as string;
  let amount: Json;
  let sendMax = false;
  if (currency === "XRP") amount = value;
  else if (isObject(currency) && typeof currency["mpt_issuance_id"] === "string") {
    amount = { mpt_issuance_id: currency["mpt_issuance_id"], value };
  } else {
    const c = currency as { currency: string; issuer: string };
    amount = { currency: c.currency, issuer: c.issuer, value };
    sendMax = true;
  }
  const txJson: XrplTxJson = {
    TransactionType: "Payment",
    Flags: 0,
    Account: choice.account,
    Destination: r["recipient"] as string,
    Amount: amount,
    ...(sendMax ? { SendMax: amount } : {}),
    ...(d["destinationTag"] !== undefined ? { DestinationTag: d["destinationTag"] } : {}),
    ...(d["sourceTag"] !== undefined ? { SourceTag: d["sourceTag"] } : {}),
    InvoiceID: mppInvoiceId(h),
    Fee: choice.fee,
    Sequence: choice.sequence,
    LastLedgerSequence: choice.lastLedgerSequence,
  };
  const challenge = choice.challenge;
  return {
    request: { kind: "xrpl-tx", txJson },
    complete(signedBlob: string): MppCredential | Refusal {
      if (typeof signedBlob !== "string" || !HEX.test(signedBlob)) return refusal("xrpl/blob-malformed");
      return { challenge, payload: { type: "transaction", blob: signedBlob } };
    },
  };
}

/** The placement: MPP's `place`, then `methodDetails.invoiceId` set to H's digits in upper case. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const invoice = mppInvoiceId(h);
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    (issued) => (issued === undefined || sameInvoice(issued, invoice) ? invoice : refusal("xrpl/carrier-occupied")),
    agreementUrl,
  );
}

/** The challenge as issued: `methodDetails.invoiceId` is left out of the digest of what was issued. */
function unplaced(option: MppChallenge): MppChallenge {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: true,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed, with a single key, an XRPL Payment whose InvoiceID is this ATR's hash, and the Payment is in a " +
    "validated ledger with tesSUCCESS. This does not show that amount, destination, asset or timing match the ATR's content.",
});

export const chargeXrpl = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "request.methodDetails.invoiceId" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: xrplStatus,
  recover: xrplInvoiceOf,
  fetchPresented,
  landedTx: (presented: unknown): string | undefined => {
    const hash = pushedField(presented, "hash", "hash");
    return hash !== undefined && HASH.test(hash) ? hash.toUpperCase() : undefined;
  },
});
