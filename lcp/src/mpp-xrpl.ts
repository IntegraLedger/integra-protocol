/**
 * `mpp/charge/xrpl`: the ATR hash itself, as 64 upper-case hex digits, placed as the request's
 * `methodDetails.invoiceId`, which the payer signs as the Payment's `InvoiceID`, single-signed or multisigned; read by
 * the payer's instrument, its `Account` with the signed `Sequence` or ticket.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { normalHash } from "./fields.js";
import {
  echoesOption,
  decodePresented,
  mppInvoiceId,
  networkIdHeld,
  sameInvoice,
  signedOf,
  xrplInvoiceOf,
  type XrplLanded,
  type XrplReader,
  type XrplRef,
  type XrplTxJson,
  type XrplNetwork,
  type XrplQuery,
  type XrplStatus,
} from "./internal/xrpl.js";
import { xrplChargeStatus } from "./internal/xrpl-read.js";
import {
  byType,
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  FETCHED,
  fetchedOf,
  isObject,
  measured,
  mppBroadcaster,
  placeCarrier,
  pushedField,
  read,
  tie,
  withoutCarrier,
  type Echoed,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { isXrplInvoiceId, xrplCurrencyOf, xrplNetworkOf } from "./mpp-rail-checks.js";
import { hexOf as hexOfBytes } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { XRPL } from "./internal/data/xrpl.js";
import { mppPayee } from "./internal/payee.js";
import type { Entry } from "./internal/registry.js";
import type { Act } from "./internal/read.js";

const ID = "mpp/charge/xrpl" as const;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const HASH = /^[0-9A-Fa-f]{64}$/;
const DROPS = /^(0|[1-9][0-9]{0,18})$/;

/**
 * The `SourceTag` a stock client writes where the challenge names none: `xrpl-mpp-sdk` 0.1.0-beta.4's `MPP_SOURCE_TAG`
 * (`dist/chunk-JQG7ATQA.js:39`), written by its charge client as `methodDetails.sourceTag ?? MPP_SOURCE_TAG`
 * (`dist/client/index.js:344`).
 */
export const MPP_SOURCE_TAG = 593_184_257;

/**
 * The most hex digits of a `transaction` credential's blob the stock server's schema takes: 8,192, 4,096 bytes
 * (`xrpl-mpp-sdk` 0.1.0-beta.4, `dist/chunk-L6LVAN2P.js:16`, `:24`). A longer blob is `xrpl/blob-too-large` before
 * anything moves, under `XRPL_MAX_BLOB_BYTES`.
 */
const CHARGE_BLOB_HEX = 8192;

const UTF8 = new TextEncoder();
/** A memo member's UTF-8 bytes in upper-case hex, as the stock `utf8ToHex` writes them. */
const hexOf = (s: string): string => hexOfBytes(UTF8.encode(s)).slice(2).toUpperCase();

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
  /**
   * The wallet's signed blob, hex, as a credential that names its payer by `source`, `did:pkh:xrpl:{network}:{account}`,
   * the challenge's network name and the account `build` was given, as the stock client writes it and the stock server
   * reads it first (`xrpl-mpp-sdk` 0.1.0-beta.4, `dist/client/index.js:376-385`, `dist/chunk-ZKD7D3D6.js:149-170`). It
   * is read as `bound` reads the credential, in its order: a credential over the credential size bound, 64 KiB, its
   * echoed challenge and `source` included, is `mpp/credential-malformed`; a blob that does not decode gets the refusal
   * `bound` gives it (one over 8,192 hex digits, the stock server's bound, is `xrpl/blob-too-large`, and one that is
   * not hex bytes `xrpl/blob-malformed`); and one whose `NetworkID` the challenge's network does not take is
   * `xrpl/network-mismatch`.
   */
  complete(signedBlob: string): Promise<MppCredential | Refusal>;
}

/**
 * The signed blob a credential presents: its `blob` for `type="transaction"`, of at most 8,192 hex digits, the stock
 * server's bound, else `xrpl/blob-too-large`; or for `type="hash"` the one `fetchPresented` wrote under `FETCHED`, read
 * by that hash, else `xrpl/read-first`. A `hash` credential's own `blob` member is not read.
 */
function presentedBlob(credential: MppCredential, payload: { [k: string]: Json }): string | Refusal {
  const type = payload["type"];
  if (type !== "transaction" && type !== "hash") return refusal("mpp/credential-type");
  if (type === "hash") {
    const read = fetchedOf(credential);
    const landed = isObject(read) ? read["blob"] : undefined;
    return typeof landed === "string" ? landed : refusal("xrpl/read-first");
  }
  const blob = payload["blob"];
  if (typeof blob !== "string") return refusal("xrpl/blob-malformed");
  return blob.length > CHARGE_BLOB_HEX ? refusal("xrpl/blob-too-large") : blob;
}

/**
 * The echoed challenge's binding: its `methodDetails.invoiceId`, read as `advertise` reads it (absent, or 64 hex digits,
 * else `mpp/request-malformed`), and the signed Payment's `InvoiceID`, which must equal it and the challenge's H. The
 * blob's `NetworkID` is read first, as rippled reads it (`networkIdHeld`), else `xrpl/network-mismatch`.
 */
async function bindingOf(
  credential: MppCredential,
): Promise<{ h: AtrHash; checked: Echoed; tx: XrplTxJson; hash: string } | Refusal> {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  if (!isXrplInvoiceId(e.checked.details["invoiceId"])) return refusal("mpp/request-malformed");
  const blob = presentedBlob(credential, e.payload);
  if (isRefusal(blob)) return blob;
  const decoded = await decodePresented(e.payload, blob);
  if (isRefusal(decoded)) return decoded;
  const { tx } = decoded;
  const network = xrplNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  if (!networkIdHeld(tx, network)) return refusal("xrpl/network-mismatch");
  if (tx.TransactionType !== "Payment") return refusal("xrpl/not-payment");
  if (typeof tx.InvoiceID !== "string") return refusal("xrpl/no-invoice-id");
  const md = e.checked.details;
  if (!sameInvoice(tx.InvoiceID, md["invoiceId"])) return refusal("xrpl/carrier-mismatch");
  if (!hashEquals(`0x${tx.InvoiceID.toLowerCase()}`, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx, hash: decoded.hash };
}

/**
 * H from the echoed challenge, once the signed Payment's `InvoiceID` is the request's `invoiceId` and equals that H. A
 * multisigned blob is admitted: the read finds the payment by its instrument. The blob is decoded once per payload
 * object, so `bound` and `reference` on one credential share one decode. The act changes nothing: the single-use
 * value is the payer's sequence or ticket, never H.
 */
async function bound(input: unknown, _given?: { act: Act; h: AtrHash }): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = await bindingOf(credential);
  return isRefusal(b) ? b : b.h;
}

/**
 * The read keys of a credential, and the payee of `option`, the challenge the payment answers (`mppPayee`). A
 * `transaction` credential: from its signed blob, as `bound` reads it, the hash, H, and the payer's instrument and
 * signed body (`signedOf`; a blob whose sequence, ticket or body does not read is `xrpl/blob-malformed`). A `hash`
 * credential, which presents the transaction its payer broadcast and nothing beside it: the echoed challenge held to
 * the pairing's filter, its H, and the transaction it names, 64 hex digits in upper case, else
 * `mpp/credential-malformed`; the read finds the instrument from that transaction, and no `FETCHED` blob is read. A
 * credential whose echoed challenge is not `option` (`echoesOption`) is `mpp/challenge-not-option`.
 */
async function reference(
  input: unknown,
  option: MppChallenge,
  _given?: { act: Act; h: AtrHash },
): Promise<Omit<XrplRef, "fromLedger"> | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  if (isObject(credential.payload) && credential.payload["type"] === "hash") {
    const e = echoedFor(credential, ID);
    if (isRefusal(e)) return e;
    if (!echoesOption(credential.challenge, option)) return refusal("mpp/challenge-not-option");
    const network = xrplNetworkOf(e.checked.details);
    if (isRefusal(network)) return network;
    const payee = mppPayee(option);
    if (isRefusal(payee)) return payee;
    const hash = e.payload["hash"];
    if (typeof hash !== "string" || !HASH.test(hash)) return refusal("mpp/credential-malformed");
    return { network, transaction: hash.toUpperCase(), h: e.h, payee };
  }
  const b = await bindingOf(credential);
  if (isRefusal(b)) return b;
  if (!echoesOption(credential.challenge, option)) return refusal("mpp/challenge-not-option");
  const network = xrplNetworkOf(b.checked.details);
  if (typeof network !== "string") return network;
  const payee = mppPayee(option);
  if (isRefusal(payee)) return payee;
  const signed = await signedOf(b.tx);
  if (signed === undefined) return refusal("xrpl/blob-malformed");
  return { network, transaction: b.hash, h: b.h, payee, signed };
}

/**
 * A push credential (`type="hash"`) with the signed blob, read by that hash once the transaction is in a validated
 * ledger, written under `FETCHED` as `blob`. Every other member of the credential is copied unchanged and not read; a
 * `FETCHED` member it carries is replaced by this read. Other credentials are returned unchanged. A read that fails,
 * finds nothing, or finds the transaction not yet validated is a refusal the seller retries; a validated result other
 * than `tesSUCCESS` is refused `xrpl/not-success`. One call.
 */
async function fetchPresented(
  credential: MppCredential,
  reader: XrplReader,
): Promise<(MppCredential & { [FETCHED]?: { blob: string } }) | Refusal> {
  if (!isObject(credential) || carriesRefused(credential) || !isObject(credential.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (credential.payload["type"] !== "hash") return credential;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const network = xrplNetworkOf(e.checked.details);
  if (typeof network !== "string") return network;
  if (!isObject(reader) || reader.network !== network) return refusal("xrpl/wrong-reader");
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
  const l = landed as XrplLanded;
  if (l.validated !== true) return refusal("xrpl/not-validated");
  if (l.result !== "tesSUCCESS") return refusal("xrpl/not-success");
  const blob = l.blob;
  if (typeof blob !== "string") return refusal("xrpl/unreadable");
  return { ...credential, [FETCHED]: { blob } };
}

/**
 * The Payment for the wallet to sign, as the stock client writes it (`xrpl-mpp-sdk` 0.1.0-beta.4,
 * `dist/client/index.js:333-346`): `Destination` the request's `recipient`; `Amount` from its `currency` string
 * (`xrplCurrencyOf`) as the stock `buildAmount` writes it (`dist/chunk-JQG7ATQA.js:188-201`), drops, an issued amount,
 * or an MPT amount; an issued amount's `SendMax` equal to it, where the stock client computes `SendMax` from the
 * issuer's transfer rate and its slippage and finds paths (`dist/client/index.js:42-104`), so that this build fails
 * with a `tec` result where the issuer charges a transfer fee; `InvoiceID` the request's
 * `invoiceId`, which must be this H; the request's `destinationTag`; `SourceTag` the request's `sourceTag`, or
 * `MPP_SOURCE_TAG`; and `Memos` from the request's `memos` where it holds any, each member's UTF-8 in hex, as the stock
 * `encodeMemos` writes them (`dist/client/index.js:391-399`). No `NetworkID`: each network the challenge can name has
 * an id of at most 1024. `complete` writes the credential's `source` and decodes the signed blob as `bound` does.
 */
async function build(choice: XrplChargeChoice, h: AtrHash): Promise<XrplChargeUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const checked = chosenFor(choice.challenge, h, ID);
  if (isRefusal(checked)) return checked;
  const r = checked.request;
  const d = checked.details;
  if (!sameInvoice(d["invoiceId"], mppInvoiceId(h))) return refusal("xrpl/carrier-mismatch");
  const network = xrplNetworkOf(d);
  if (isRefusal(network)) return network;
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
  const currency = xrplCurrencyOf(r["currency"]);
  if (currency === undefined) return refusal("mpp/request-malformed");
  const value = r["amount"] as string;
  let amount: Json;
  let sendMax = false;
  if (currency === "XRP") amount = value;
  else if ("mpt_issuance_id" in currency) amount = { mpt_issuance_id: currency.mpt_issuance_id, value };
  else {
    amount = { currency: currency.currency, issuer: currency.issuer, value };
    sendMax = true;
  }
  const memos = Array.isArray(d["memos"]) ? (d["memos"] as { type?: string; format?: string; data?: string }[]) : [];
  const txJson: XrplTxJson = {
    TransactionType: "Payment",
    Flags: 0,
    Account: choice.account,
    Destination: r["recipient"] as string,
    Amount: amount,
    ...(sendMax ? { SendMax: amount } : {}),
    ...(d["destinationTag"] !== undefined ? { DestinationTag: d["destinationTag"] } : {}),
    SourceTag: (d["sourceTag"] as number | undefined) ?? MPP_SOURCE_TAG,
    ...(memos.length > 0
      ? {
          Memos: memos.map((m) => ({
            Memo: {
              ...(m.type ? { MemoType: hexOf(m.type) } : {}),
              ...(m.format ? { MemoFormat: hexOf(m.format) } : {}),
              ...(m.data ? { MemoData: hexOf(m.data) } : {}),
            },
          })),
        }
      : {}),
    InvoiceID: mppInvoiceId(h),
    Fee: choice.fee,
    Sequence: choice.sequence,
    LastLedgerSequence: choice.lastLedgerSequence,
  };
  const challenge = checked.challenge;
  const source = `did:pkh:xrpl:${d["network"] as string}:${choice.account}`;
  return {
    request: { kind: "xrpl-tx", txJson },
    async complete(signedBlob: string): Promise<MppCredential | Refusal> {
      const payload = { type: "transaction", blob: signedBlob };
      const credential = measured({ challenge, payload, source });
      if (isRefusal(credential)) return credential;
      if (typeof signedBlob === "string" && signedBlob.length > CHARGE_BLOB_HEX) return refusal("xrpl/blob-too-large");
      if (typeof signedBlob !== "string" || !HEX.test(signedBlob)) return refusal("xrpl/blob-malformed");
      const decoded = await decodePresented(payload, signedBlob);
      if (isRefusal(decoded)) return decoded;
      if (!networkIdHeld(decoded.tx, network)) return refusal("xrpl/network-mismatch");
      return credential;
    },
  };
}

/** The placement: MPP's `place`, then `methodDetails.invoiceId` set to H's digits in upper case. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  if (normalHash(h) === null) return refusal("mpp/challenge-malformed");
  const invoice = mppInvoiceId(h);
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    position,
    (issued) => (issued === undefined || sameInvoice(issued, invoice) ? invoice : refusal("xrpl/carrier-occupied")),
    agreementUrl,
  );
}

/**
 * The challenge as issued: its request without `methodDetails.invoiceId`, where H rides. A challenge that carries a
 * `refused` member is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return withoutCarrier(option);
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `mpp/charge/xrpl`. `broadcaster` answers by the credential's `type`. `transaction`, `"payee"`: the seller's server
 * submits the signed blob, and `status` reads it. `hash`, `"payer"`: the payer broadcast the transaction, which
 * `fetchPresented` reads, then `status`. A credential of any other type gets `mpp/credential-type`, as `bound` refuses
 * it.
 */
export const chargeXrpl = Object.freeze({
  id: ID,
  data: XRPL[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: mppBroadcaster(byType({ transaction: "payee", hash: "payer" })),
  reference,
  status: xrplChargeStatus,
  recover: xrplInvoiceOf,
  fetchPresented,
  landedTx: (presented: unknown): string | undefined => {
    const hash = pushedField(presented, "hash", "hash");
    return hash !== undefined && HASH.test(hash) ? hash.toUpperCase() : undefined;
  },
}) satisfies Entry<
  typeof ID,
  MppCredential,
  Omit<XrplRef, "fromLedger">,
  XrplReader,
  MppForms & {
    choice: XrplChargeChoice;
    unsigned: XrplChargeUnsigned;
    landed: Pick<XrplRef, "fromLedger">;
    network: XrplNetwork;
    query: XrplQuery<XrplRef>;
    answer: XrplStatus;
  }
>;
