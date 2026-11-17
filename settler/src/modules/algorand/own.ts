/**
 * The settler's own path for the two payers of `x402/exact/algorand` that `@x402/avm` 2.31.0's class cannot settle, each
 * told apart by the payment entry's own members: a payer whose account is rekeyed and who signs with the one key it is
 * rekeyed to (`sig` with `sgnr`), whose signature the class checks against the sender's key instead; and a payer who
 * signs with a Falcon key (`pqsig`), a member the class's decoder does not read. It makes lcp's checks, then the class's
 * own checks of the group, the payment and the fee payer's transaction, with the signature checked against the key
 * `sgnr` names; it signs the fee payer's transaction through the signer object the class takes, simulates the group,
 * whose node verifies every signature and the account's authorization, sends it with the payment entry exactly as
 * presented, and waits for it.
 */
import { decodeMsgpack } from "@algorandfoundation/algokit-utils/common";
import { ed25519Verifier } from "@algorandfoundation/algokit-utils/crypto";
import {
  bytesForSigning,
  decodeSignedTransaction,
  decodeTransaction,
  encodeTransactionRaw,
  type SignedTransaction,
} from "@algorandfoundation/algokit-utils/transact";
import type { FacilitatorAvmSigner } from "@x402/avm";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";

/** An atomic group's most transactions (go-algorand's `MaxTxGroupSize`). */
const MAX_GROUP = 16;
/** The class's cap on the fee of the fee payer's transaction: 5 000 µAlgo per transaction of the group. */
const MAX_FEE_PER_TRANSACTION = 5_000n;

/** The authority the payment entry's own members name, where it is one only this path settles. */
export type OwnAuthority = "rekeyed" | "falcon";

/** The payment entry of a payload in the scheme's form, as its bytes, or undefined. */
function entryOf(payload: PaymentPayload): Uint8Array | undefined {
  const { paymentGroup, paymentIndex } = payload.payload as { paymentGroup?: unknown; paymentIndex?: unknown };
  if (!Array.isArray(paymentGroup) || typeof paymentIndex !== "number") return undefined;
  const entry = paymentGroup[paymentIndex];
  return typeof entry === "string" ? new Uint8Array(Buffer.from(entry, "base64")) : undefined;
}

/**
 * Which own authority signs the payment entry, by its members: `pqsig`, a Falcon signature; or `sig` beside `sgnr` with
 * no other signature, the one key a rekeyed account answers to. Any other entry is the class's.
 */
export function ownAuthority(payload: PaymentPayload): OwnAuthority | undefined {
  const entry = entryOf(payload);
  if (entry === undefined) return undefined;
  let members: string[];
  try {
    const decoded = decodeMsgpack(entry) as unknown;
    if (!(decoded instanceof Map)) return undefined;
    members = [...decoded.keys()].map((k) => (typeof k === "string" ? k : Buffer.from(k as Uint8Array).toString("utf8")));
  } catch {
    return undefined;
  }
  if (members.includes("pqsig")) return "falcon";
  const others = members.filter((m) => m === "msig" || m === "lsig").length;
  return members.includes("sgnr") && members.includes("sig") && others === 0 ? "rekeyed" : undefined;
}

type Failure = { readonly reason: string; readonly message: string };
type Prepared = { readonly payer: string; readonly signed: Uint8Array[] };

function fail(reason: string, message: string): Failure {
  return { reason, message };
}

/** Each entry of the group decoded: a signed transaction, or an unsigned one only where a fee payer the key holds sends it. */
function decodeGroup(group: readonly string[], ours: readonly string[]): SignedTransaction[] | Failure {
  const out: SignedTransaction[] = [];
  for (let i = 0; i < group.length; i++) {
    const bytes = new Uint8Array(Buffer.from(group[i]!, "base64"));
    try {
      const signed = decodeSignedTransaction(bytes);
      if (!signed.txn.type || signed.txn.type === "unknown") throw new Error("no type");
      out.push(signed);
    } catch {
      try {
        const txn = decodeTransaction(bytes);
        if (!ours.includes(txn.sender.toString())) {
          return fail("invalid_exact_avm_unsigned_non_facilitator", `the unsigned transaction at ${i} is not the fee payer's`);
        }
        out.push({ txn });
      } catch {
        return fail("invalid_exact_avm_invalid_transaction", `the transaction at ${i} does not decode`);
      }
    }
  }
  const groupOf = (s: SignedTransaction) => (s.txn.group === undefined ? "" : Buffer.from(s.txn.group).toString("base64"));
  if (out.length > 1 && out.some((s) => groupOf(s) !== groupOf(out[0]!))) {
    return fail("invalid_exact_avm_invalid_group_id", "the transactions name different groups");
  }
  return out;
}

/** The class's checks of the fee payer's transaction: a zero payment to itself, closing nothing, rekeying nothing, its fee capped. */
function feePayerRefusal(s: SignedTransaction, size: number): Failure | undefined {
  const t = s.txn;
  if (t.type !== "pay") return fail("invalid_exact_avm_invalid_fee_payer", "the fee payer's transaction is not a payment");
  if ((t.payment?.amount ?? 0n) > 0n) return fail("invalid_exact_avm_invalid_fee_payer", "the fee payer pays an amount");
  const receiver = t.payment?.receiver?.toString();
  if (receiver !== undefined && receiver !== t.sender.toString()) return fail("invalid_exact_avm_invalid_fee_payer", "the fee payer pays another account");
  if (t.payment?.closeRemainderTo !== undefined) return fail("invalid_exact_avm_invalid_fee_payer", "the fee payer closes its account");
  if (t.rekeyTo !== undefined) return fail("invalid_exact_avm_invalid_fee_payer", "the fee payer rekeys its account");
  if ((t.fee ?? 0n) > MAX_FEE_PER_TRANSACTION * BigInt(size)) return fail("invalid_exact_avm_fee_too_high", "the fee payer's fee exceeds its cap");
  return undefined;
}

/**
 * The checks of an own payer, after lcp's (`admitted`): the group, the payment against the requirements, the
 * authority, the fee payer's transaction, which the key then signs, and the node's simulation. The payer and the
 * group to send, or the refusal.
 */
async function prepared(signer: FacilitatorAvmSigner, payload: PaymentPayload, r: PaymentRequirements): Promise<Prepared | Failure> {
  const { paymentGroup: group, paymentIndex: index } = payload.payload as { paymentGroup: string[]; paymentIndex: number };
  if (group.length > MAX_GROUP) return fail("invalid_exact_avm_group_size_exceeded", `the group holds ${group.length} transactions`);
  if (!Number.isSafeInteger(index) || index < 0 || index >= group.length) return fail("invalid_exact_avm_payment_index", "the payment index is outside the group");
  const ours = signer.getAddresses();
  const decoded = decodeGroup(group, ours);
  if (!Array.isArray(decoded)) return decoded;
  const payment = decoded[index]!;
  const t = payment.txn;
  const payer = t.sender.toString();
  if (ours.includes(payer)) return fail("invalid_exact_avm_facilitator_transferring", "the fee payer is the payment's sender");
  if (t.type !== "axfer" || t.assetTransfer === undefined) return fail("invalid_exact_avm_not_asset_transfer", "the payment is not an asset transfer");
  if ((t.assetTransfer.amount ?? 0n) !== BigInt(r.amount)) return fail("invalid_exact_avm_amount_mismatch", "the amount differs");
  if (t.assetTransfer.receiver?.toString() !== r.payTo) return fail("invalid_exact_avm_receiver_mismatch", "the receiver differs");
  if (t.assetTransfer.assetId?.toString() !== r.asset) return fail("invalid_exact_avm_asset_mismatch", "the asset differs");
  if (ownAuthority(payload) === "rekeyed") {
    const by = payment.authAddress!;
    // The key that authorises the payment is the payer's: never the payee's and never the fee payer's own.
    if (by.toString() === r.payTo || ours.includes(by.toString())) {
      return fail("invalid_exact_avm_invalid_signature", "the payment is signed by the payee's or the fee payer's key");
    }
    if (!(await ed25519Verifier(payment.sig!, bytesForSigning.transaction(t), by.publicKey))) {
      return fail("invalid_exact_avm_invalid_signature", "the signature is not by the key sgnr names");
    }
  }
  const signed: Uint8Array[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const s = decoded[i]!;
    const sender = s.txn.sender.toString();
    if (!ours.includes(sender)) {
      // Every entry the payer gave is sent as presented, a Falcon signature among it.
      signed.push(new Uint8Array(Buffer.from(group[i]!, "base64")));
      continue;
    }
    const refused = feePayerRefusal(s, decoded.length);
    if (refused !== undefined) return refused;
    signed.push(await signer.signTransaction(encodeTransactionRaw(s.txn), sender));
  }
  try {
    const simulated = await signer.simulateTransactions(signed, r.network);
    const failure = simulated.txnGroups?.[0]?.failureMessage;
    if (failure) return fail("invalid_exact_avm_simulation_failed", failure);
  } catch (e) {
    return fail("invalid_exact_avm_simulation_failed", e instanceof Error ? e.message : String(e));
  }
  return { payer, signed };
}

const isFailure = (v: Prepared | Failure): v is Failure => "reason" in v;

/**
 * The own path's facilitator: `admitted` gives lcp's checks and the payment's id (lcp's, under the transaction's own
 * fields), or the refusal with lcp's code.
 */
export function ownFacilitator(
  signer: FacilitatorAvmSigner,
  admitted: (payload: PaymentPayload, r: PaymentRequirements) => Promise<{ txid: string } | { reason: string; code?: string }>,
): SchemeNetworkFacilitator {
  const checked = async (payload: PaymentPayload, r: PaymentRequirements): Promise<(Prepared & { txid: string }) | Failure> => {
    const lcp = await admitted(payload, r);
    if ("reason" in lcp) return fail(lcp.reason, lcp.code ?? lcp.reason);
    const p = await prepared(signer, payload, r);
    return isFailure(p) ? p : { ...p, txid: lcp.txid };
  };
  return {
    scheme: "exact",
    caipFamily: "algorand:*",
    getExtra: () => undefined,
    getSigners: () => [...signer.getAddresses()],
    async verify(payload, r): Promise<VerifyResponse> {
      const p = await checked(payload, r);
      return isFailure(p) ? { isValid: false, invalidReason: p.reason, invalidMessage: p.message } : { isValid: true, payer: p.payer };
    },
    async settle(payload, r): Promise<SettleResponse> {
      const network = r.network as Network;
      const p = await checked(payload, r);
      if (isFailure(p)) return { success: false, errorReason: p.reason, errorMessage: p.message, transaction: "", network };
      try {
        await signer.sendTransactions(p.signed, network);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, errorReason: "invalid_exact_avm_settlement_failed", errorMessage: message, transaction: p.txid, network, payer: p.payer };
      }
      try {
        await signer.waitForConfirmation(p.txid, network, 10);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, errorReason: "invalid_exact_avm_confirmation_failed", errorMessage: message, transaction: p.txid, network, payer: p.payer };
      }
      return { success: true, transaction: p.txid, network, payer: p.payer };
    },
  };
}

/**
 * The senders of the group's entries that one of `ours` sends, each of which x402's class and the own path sign as the
 * fee payer, whatever the option names; undefined where the group does not decode, which both refuse.
 */
export function keyEntries(payload: PaymentPayload, ours: readonly string[]): string[] | undefined {
  const { paymentGroup } = payload.payload as { paymentGroup?: unknown };
  if (!Array.isArray(paymentGroup) || !paymentGroup.every((e) => typeof e === "string")) return undefined;
  const decoded = decodeGroup(paymentGroup, ours);
  if (!Array.isArray(decoded)) return undefined;
  return decoded.map((s) => s.txn.sender.toString()).filter((s) => ours.includes(s));
}

/** The fee the key's transactions in the payment's group pay: each one's own `fee`, which is what it pays once it lands. */
export function feePayerFee(signer: FacilitatorAvmSigner, payload: PaymentPayload): bigint {
  const { paymentGroup } = payload.payload as { paymentGroup?: unknown };
  if (!Array.isArray(paymentGroup)) return 0n;
  const decoded = decodeGroup(paymentGroup as string[], signer.getAddresses());
  if (!Array.isArray(decoded)) return 0n;
  const ours = signer.getAddresses();
  return decoded.filter((s) => ours.includes(s.txn.sender.toString())).reduce((sum, s) => sum + (s.txn.fee ?? 0n), 0n);
}
