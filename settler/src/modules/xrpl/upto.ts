/**
 * The XRPL module's own facilitator for `x402/upto/xrpl` on one network, x402's `upto` scheme on the XRP Ledger, which
 * no published class implements. The payer opens a payment channel to `payTo` and signs one claim off the ledger over
 * the channel and the maximum; `/verify` reads the channel at the validated ledger and makes the scheme's checks of it
 * and of that claim, and refuses a payload carrying `settlementTransaction`. At `/settle` the resource server adds
 * `settlementTransaction`, a `PaymentChannelClaim` its `payTo` key signed for the actual charge with `tfClose`; the
 * module's checks before it submits (`phaseOf` the context: `settle`) and its settle check it against the payment and
 * the channel, and the settle submits it unchanged and waits for it in a validated ledger. The module holds no key and
 * pays no fee (`extra.key` `none`).
 *
 * The record names the payment by its channel, which one claim closes: one row per channel, as the scheme's
 * duplicate-settlement rule keys it. Nothing the payer signs carries H, and lcp reads the channel's create, the
 * payer's act, not the claim, so the module's read is of the claim the record holds: the transaction the settle
 * submitted, by its hash.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import { uptoXrpl } from "@integraledger/lcp/x402-upto-xrpl";
import type { XrplNetwork } from "@integraledger/lcp/xrpl";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { decode, deriveAddress, encodeForSigning, encodeForSigningClaim, verifyKeypairSignature, type Transaction } from "xrpl";
import { isObject } from "../../answers.js";
import { outcomeOf, phaseOf, type Instrumented, type Module, type Refused } from "../../module.js";
import type { XrplNode } from "./node.js";

/** The scheme's landing margin, in seconds: two ledger closes at a pessimistic 10-second rate. */
const MARGIN_S = 20;
/** The offset xrpl.js's autofill gives `LastLedgerSequence`, which the settlement window admits. */
const AUTOFILL_LEDGERS = 20;
/** Unix seconds at the Ripple epoch, 2000-01-01T00:00:00Z. */
const RIPPLE_EPOCH = 946_684_800;
const TF_CLOSE = 0x00020000;
const TF_RENEW = 0x00010000;
/** The largest network id that carries no `NetworkID` field. */
const LEGACY_NETWORK_ID = 1024;

type Failure = { readonly reason: string; readonly code?: string };

/** The x402 reason for one of lcp's refusals: the version, the option, or else the payload. */
function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option") || r.code === "xrpl/currency-not-xrp") return "invalid_payment_requirements";
  return "invalid_payload";
}

/** The payload's members, as the scheme names them. */
interface Presented {
  readonly channelId: string;
  readonly maxAmount: string;
  readonly signature: string;
  readonly publicKey: string;
  readonly payer: string;
  readonly settlementTransaction?: string;
}

/**
 * The requirements the payment's `accepted` must equal: at `/verify` the requirements as given; with a settlement
 * transaction, the settle-time requirements with `payload.maxAmount` for `amount`, as the scheme's re-verification
 * makes them.
 */
function termsOf(payload: PaymentPayload, r: PaymentRequirements): PaymentRequirements {
  const settling = typeof payload.payload["settlementTransaction"] === "string";
  const max = payload.payload["maxAmount"];
  return settling && typeof max === "string" ? { ...r, amount: max } : r;
}

/** The checks that read neither the chain nor the clock: the network, then lcp's checks of the payment and its option. */
async function pure(network: XrplNetwork, payload: PaymentPayload, r: PaymentRequirements): Promise<Presented | Failure> {
  if (r.network !== network || payload.accepted?.network !== network) return { reason: "invalid_network" };
  const ref = await uptoXrpl.reference(payload, termsOf(payload, r) as LcpOption);
  if (isRefusal(ref)) return { reason: reasonOf(ref), code: ref.code };
  const p = payload.payload as Record<string, unknown>;
  for (const k of ["maxAmount", "signature", "publicKey"]) if (typeof p[k] !== "string") return { reason: "invalid_payload" };
  if (!/^[1-9][0-9]{0,16}$/.test(p["maxAmount"] as string)) return { reason: "invalid_payload" };
  const settlement = p["settlementTransaction"];
  if (settlement !== undefined && typeof settlement !== "string") return { reason: "invalid_payload" };
  return {
    channelId: ref.channel,
    maxAmount: p["maxAmount"] as string,
    signature: p["signature"] as string,
    publicKey: p["publicKey"] as string,
    payer: ref.payer,
    ...(typeof settlement === "string" ? { settlementTransaction: settlement } : {}),
  };
}

const isPresented = (v: Presented | Failure): v is Presented => !("reason" in v);
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toUpperCase() === b.toUpperCase();
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);

/**
 * The scheme's checks of the channel and the claim (its rules 2 to 7 at `/verify`; at `/settle`, rules 3 to 5 in full
 * against the maximum, and 6 and 7 as the settle-time table relaxes them). The channel and the ledger, or the refusal.
 */
async function channelChecks(
  node: XrplNode,
  p: Presented,
  r: PaymentRequirements,
  settling: boolean,
): Promise<{ channel: Record<string, unknown>; ledger: number } | Failure> {
  const channel = await node.payChannel(p.channelId);
  if (channel === null) return { reason: "invalid_upto_xrpl_payload_channel_not_found" };
  if (channel["Destination"] !== r.payTo || channel["Account"] !== p.payer) return { reason: "invalid_upto_xrpl_payload_recipient_mismatch" };
  const amount = BigInt(String(channel["Amount"] ?? "0"));
  const balance = BigInt(String(channel["Balance"] ?? "0"));
  if (!settling && p.maxAmount !== r.amount) return { reason: "invalid_upto_xrpl_payload_amount_mismatch" };
  if (BigInt(p.maxAmount) > amount) return { reason: "invalid_upto_xrpl_payload_amount_exceeds_channel" };
  if (!same(p.publicKey, channel["PublicKey"])) return { reason: "invalid_upto_xrpl_payload_public_key_mismatch" };
  // xrpl's declaration names a PaymentChannelClaim; it passes ripple-binary-codec's claim, the channel and the drops.
  const claim = encodeForSigningClaim({ channel: p.channelId, amount: p.maxAmount } as never);
  if (!verifyKeypairSignature(claim, p.signature, p.publicKey)) return { reason: "invalid_upto_xrpl_payload_signature" };
  const { index, closeTime } = await node.validatedClose();
  const cancelAfter = int(channel["CancelAfter"]);
  const expiration = int(channel["Expiration"]);
  const settleDelay = int(channel["SettleDelay"]) ?? 0;
  if (!settling) {
    if (balance !== 0n) return { reason: "invalid_upto_xrpl_payload_channel_claimed" };
    const headroom = r.maxTimeoutSeconds + MARGIN_S;
    const minDelay = int(r.extra?.["minSettleDelay"]) ?? 0;
    if (cancelAfter === undefined || cancelAfter < closeTime + headroom) return { reason: "invalid_upto_xrpl_payload_channel_expiring" };
    if (expiration !== undefined) return { reason: "invalid_upto_xrpl_payload_channel_expiring" };
    if (settleDelay < headroom || settleDelay < minDelay) return { reason: "invalid_upto_xrpl_payload_settle_delay_too_short" };
    const validAfter = int(r.extra?.["validAfter"]);
    if (validAfter !== undefined && closeTime < validAfter - RIPPLE_EPOCH) return { reason: "invalid_upto_xrpl_payload_not_yet_valid" };
  } else {
    if (cancelAfter !== undefined && cancelAfter < closeTime + MARGIN_S) return { reason: "invalid_upto_xrpl_payload_channel_expiring" };
    if (expiration !== undefined && expiration < closeTime + MARGIN_S) return { reason: "invalid_upto_xrpl_payload_channel_expiring" };
  }
  return { channel, ledger: index };
}

/** The checks of the resource server's settlement transaction (the scheme's *Settlement Authorization*); the blob's hash-free form, or the refusal. */
async function settlementChecks(
  node: XrplNode,
  network: XrplNetwork,
  p: Presented,
  r: PaymentRequirements,
  channel: Record<string, unknown>,
  ledger: number,
): Promise<Failure | undefined> {
  const mismatch = { reason: "invalid_upto_xrpl_settlement_transaction_mismatch" };
  if (p.settlementTransaction === undefined) return { reason: "invalid_upto_xrpl_missing_settlement_transaction" };
  let tx: Record<string, unknown>;
  try {
    tx = decode(p.settlementTransaction);
  } catch {
    return mismatch;
  }
  if (tx["TransactionType"] !== "PaymentChannelClaim" || tx["Account"] !== r.payTo) return mismatch;
  if (tx["Delegate"] !== undefined || tx["Signers"] !== undefined) return mismatch;
  const key = tx["SigningPubKey"];
  const signature = tx["TxnSignature"];
  if (typeof key !== "string" || key === "" || typeof signature !== "string") return mismatch;
  if (!verifyKeypairSignature(encodeForSigning(tx as unknown as Transaction), signature, key)) return mismatch;
  const signer = deriveAddress(key);
  const auth = await node.authorization(r.payTo);
  if (!(signer === r.payTo ? !auth.isMasterKeyDisabled : signer === auth.regularKey)) {
    return { reason: "invalid_upto_xrpl_settlement_signer_not_authorized" };
  }
  if (!same(tx["Channel"], p.channelId)) return mismatch;
  const flags = Number(tx["Flags"] ?? 0) >>> 0;
  if ((flags & TF_CLOSE) === 0 || (flags & TF_RENEW) !== 0) return mismatch;
  const last = int(tx["LastLedgerSequence"]);
  if (last === undefined || last <= ledger || last > ledger + AUTOFILL_LEDGERS + r.maxTimeoutSeconds) return mismatch;
  const id = Number(network.slice("xrpl:".length));
  if (id <= LEGACY_NETWORK_ID ? tx["NetworkID"] !== undefined : tx["NetworkID"] !== id) return mismatch;
  if (BigInt(r.amount) > BigInt(p.maxAmount)) return { reason: "invalid_upto_xrpl_payload_settlement_exceeds_amount" };
  const delivered = BigInt(String(channel["Balance"] ?? "0"));
  const claims = ["Balance", "Amount", "Signature", "PublicKey"] as const;
  if (BigInt(r.amount) === 0n || delivered >= BigInt(r.amount)) {
    // A zero charge, or one the channel already delivered: a bare close, carrying no claim.
    if (claims.some((k) => tx[k] !== undefined)) return mismatch;
  } else if (
    tx["Balance"] !== r.amount ||
    tx["Amount"] !== p.maxAmount ||
    !same(tx["Signature"], p.signature) ||
    !same(tx["PublicKey"], p.publicKey)
  ) {
    return mismatch;
  }
  return undefined;
}

function verifyFailure(f: Failure, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason: f.reason, ...(f.code ? { invalidMessage: f.code } : {}), ...(payer ? { payer } : {}) };
}

/** The settler's own `upto` facilitator over the seller's server. */
function uptoFacilitator(network: XrplNetwork, node: XrplNode): SchemeNetworkFacilitator {
  /** The scheme's checks at `/verify`, or at `/settle` (`settling`), where the settlement transaction is the server's. */
  const checked = async (payload: PaymentPayload, r: PaymentRequirements, settling: boolean) => {
    const p = await pure(network, payload, r);
    if (!isPresented(p)) return p;
    if (!settling && p.settlementTransaction !== undefined) {
      return { reason: "invalid_upto_xrpl_payload_unexpected_settlement_transaction", payer: p.payer };
    }
    if (settling && p.settlementTransaction === undefined) {
      return { reason: "invalid_upto_xrpl_missing_settlement_transaction", payer: p.payer };
    }
    const c = await channelChecks(node, p, r, settling);
    if ("reason" in c) return { ...c, payer: p.payer };
    if (settling) {
      const s = await settlementChecks(node, network, p, r, c.channel, c.ledger);
      if (s !== undefined) return { ...s, payer: p.payer };
    }
    return p;
  };
  return {
    scheme: "upto",
    caipFamily: "xrpl:*",
    getExtra: () => undefined,
    getSigners: () => [],
    async verify(payload, r, context) {
      const p = await checked(payload, r, phaseOf(context) === "settle");
      return isPresented(p) ? { isValid: true, payer: p.payer } : verifyFailure(p, (p as { payer?: string }).payer);
    },
    async settle(payload, r): Promise<SettleResponse> {
      const n = r.network as Network;
      const p = await checked(payload, r, true);
      if (!isPresented(p)) {
        const payer = (p as { payer?: string }).payer;
        return { success: false, errorReason: p.reason, ...(p.code ? { errorMessage: p.code } : {}), transaction: "", network: n, ...(payer ? { payer } : {}) };
      }
      const sent = await node.submit(p.settlementTransaction!);
      if (sent.validated && sent.resultCode === "tesSUCCESS") return { success: true, transaction: sent.hash, network: n, payer: p.payer, amount: r.amount };
      if (!sent.validated) return { success: false, errorReason: "settlement_pending", transaction: sent.hash, network: n, payer: p.payer };
      return { success: false, errorReason: `transaction_failed: ${sent.resultCode}`, transaction: sent.hash, network: n, payer: p.payer };
    },
  };
}

/** The module of `x402/upto/xrpl` on the configured network. */
export function uptoModule(network: XrplNetwork, node: XrplNode): Module {
  const n = network as Network;
  return {
    // The maximum a payment authorises is a positive number of drops (lcp's option filter); zero is not established.
    descriptor: { name: "xrpl", key: "none", pairings: [uptoXrpl.id], acceptsZero: false },
    network: n,
    facilitator: uptoFacilitator(network, node),
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const r = await pure(network, p.payload, p.requirements);
        if (!isPresented(r)) return { refused: r.reason };
        return {
          pairing: uptoXrpl.id,
          // The channel, which one destination claim with tfClose closes: the scheme's settlement identity.
          instrument: { by: "single-use", network: n, signer: r.payer, value: r.channelId, scope: "PayChannel" },
          nonce: uptoXrpl.data.nonce,
          keep: { until: "settler" },
        };
      },
      async read(_p, at) {
        // lcp reads the channel's create, the payer's act, and no claim; the claim the record holds is read by its hash.
        if (at.transaction === undefined) return outcomeOf({ state: "pending", reason: "not-found", foreign: [] });
        const t = await node.transaction(at.transaction);
        if (t === null || !t.validated) return outcomeOf({ state: "pending", reason: "not-found", foreign: [] });
        if (t.resultCode === "tesSUCCESS") {
          return outcomeOf({ state: "settled", transaction: at.transaction, finality: "validated", presented: "yes", foreign: [] });
        }
        // A claim that failed in a validated ledger consumed nothing: the channel stays open to another claim.
        return outcomeOf({ state: "pending", reason: "instrument-live", transaction: at.transaction, foreign: [] });
      },
    },
    fees: { paysFee: () => false, payerBroadcast: () => false },
  };
}
