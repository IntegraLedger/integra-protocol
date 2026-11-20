/**
 * The XRPL module for `x402/exact/xrpl` on one network: `@x402/xrpl` 2.31.0's facilitator class, registered unchanged
 * behind lcp's checks of the pairing, for a payment signed with one key; and the settler's own path for a multisigned
 * payment, which that class refuses (`invalid_exact_xrpl_payload_multisig_not_supported`), claimed by the transaction's
 * own `Signers`. The buyer signs and pays the fee and the settler submits what the buyer signed, so the module holds no
 * key (`extra.key` `none`).
 *
 * `x402/upto/xrpl`, which no class implements, is the module's own facilitator (`./upto.ts`).
 *
 * Both paths refuse, before anything moves, a payment that names a `Delegate` or carries `Memos`, as x402's scheme
 * requires of every facilitator. Both name the record's instrument by the payer's account and the `Sequence` or
 * `TicketSequence` it signed, never by the transaction's hash, which another quorum's copy of one payment changes.
 */
import { isRefusal, type Refusal } from "@integraledger/lcp";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import { exactXrpl } from "@integraledger/lcp/x402-exact-xrpl";
import type { XrplNetwork, XrplRef } from "@integraledger/lcp/xrpl";
import { ExactXrplScheme } from "@x402/xrpl/exact/facilitator";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { decode, deriveAddress, encodeForMultiSigning, verifyKeypairSignature, type Transaction } from "xrpl";
import { isObject } from "../../answers.js";
import {
  outcomeOf,
  type Handoff,
  type Instrumented,
  type Module,
  type ModuleStarter,
  type Refused,
  type Registration,
} from "../../module.js";
import { validatedLedger, xrplNode, xrplReader, type XrplNode } from "./node.js";
import { uptoModule } from "./upto.js";

export interface XrplConfig {
  /** The network, exactly one. */
  readonly network: XrplNetwork;
  /**
   * The seller's rippled or Clio server's JSON-RPC endpoint, holding the ledgers from each payment's issue to the
   * validated ledger, which the class, the own path and lcp's read call.
   */
  readonly node: string;
  /** How long a settle waits for its transaction in a validated ledger; default 30 000. */
  readonly waitMs?: number;
  /** The most fee, in drops, a payment may sign; the class's default, 10 000, where absent. */
  readonly maxFeeDrops?: string;
}

/** The class's default fee bound, `DEFAULT_MAX_FEE_DROPS` of `@x402/xrpl` 2.31.0. */
const DEFAULT_MAX_FEE_DROPS = "10000";
/** `tfPartialPayment`. */
const PARTIAL_PAYMENT = 0x00020000;

/** The x402 reason for an lcp refusal: the version, the option, or else the payload. */
function reasonOf(r: Refusal): string {
  if (r.code === "x402/not-v2") return "invalid_x402_version";
  if (r.code.startsWith("x402/option")) return "invalid_payment_requirements";
  return "invalid_payload";
}

type Failure = { reason: string; code?: string };

/** The signed transaction the payload carries, decoded, or undefined where it does not decode. */
function txOf(payload: PaymentPayload): Record<string, unknown> | undefined {
  const blob = isObject(payload.payload) ? payload.payload["signedTxBlob"] : undefined;
  if (typeof blob !== "string") return undefined;
  try {
    return decode(blob);
  } catch {
    return undefined;
  }
}

/**
 * The module's checks that read neither the chain nor the clock: its network; no `Delegate` and no `Memos`; lcp's bound
 * and reference of the pairing. The reference, or the refusal.
 */
async function pure(network: XrplNetwork, payload: PaymentPayload, requirements: PaymentRequirements): Promise<Signed | Failure> {
  if (requirements.network !== network || payload.accepted?.network !== network) return { reason: "invalid_network" };
  const tx = txOf(payload);
  if (tx !== undefined && tx["Delegate"] !== undefined) return { reason: "invalid_exact_xrpl_payload_delegate_not_allowed" };
  if (tx !== undefined && tx["Memos"] !== undefined) return { reason: "invalid_exact_xrpl_payload_memos_not_allowed" };
  const bound = await exactXrpl.bound(payload);
  if (isRefusal(bound)) return { reason: reasonOf(bound), code: bound.code };
  // The requirements arrive as JSON, which lcp's option type names.
  const ref = await exactXrpl.reference(payload, requirements as LcpOption);
  if (isRefusal(ref)) return { reason: reasonOf(ref), code: ref.code };
  return ref;
}

/** lcp's reference of a presented payment, which names no position: the resource server recorded the one at issue. */
type Signed = Omit<XrplRef, "fromLedger">;

const isRef = (v: Signed | Failure): v is Signed => !("reason" in v);

/**
 * The ledger from which lcp's read searches where the record holds no position for the payment, a read made before
 * any claim: the first ledger, which reads more and misses nothing; a server that does not hold that range answers a
 * gap, which leaves the payment live.
 */
const FROM_LEDGER = 1;

/** The position the core keeps at a claim: the validated ledger then, before any ledger a later submission lands in. */
interface Position {
  readonly ledger: number;
}

function verifyFailure(f: Failure, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason: f.reason, ...(f.code ? { invalidMessage: f.code } : {}), ...(payer ? { payer } : {}) };
}

function settleFailure(f: Failure, network: Network, payer?: string): SettleResponse {
  return {
    success: false,
    errorReason: f.reason,
    ...(f.code ? { errorMessage: f.code } : {}),
    transaction: "",
    network,
    ...(payer ? { payer } : {}),
  };
}

/** The record's members, the same on both paths. */
function recordOf(c: XrplConfig): Module["record"] {
  return {
    async instrument(p): Promise<Instrumented | Refused> {
      const r = await pure(c.network, p.payload, p.requirements);
      if (!isRef(r)) return { refused: r.reason };
      const signed = r.signed;
      if (signed === undefined) return { refused: "invalid_payload" };
      return {
        pairing: exactXrpl.id,
        // The account's Sequence, or the ticket it consumes, as signed: every quorum's copy of one payment names it.
        instrument:
          signed.ticket === undefined
            ? { by: "single-use", network: c.network as Network, signer: signed.account, value: String(signed.sequence), scope: "Sequence" }
            : { by: "single-use", network: c.network as Network, signer: signed.account, value: String(signed.ticket), scope: "TicketSequence" },
        nonce: exactXrpl.data.nonce,
        // The lapse is a ledger index, LastLedgerSequence, which no clock bounds from above.
        keep: { until: "settler" },
      };
    },
    async read(p, at) {
      const r = await pure(c.network, p.payload, p.requirements);
      if (!isRef(r)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
      const reader = xrplReader(c.network, c.node, at.deadline);
      const search = at.search as Parameters<typeof exactXrpl.status>[2]["search"];
      const fromLedger = (at.from as Position | undefined)?.ledger ?? FROM_LEDGER;
      return outcomeOf(await exactXrpl.status({ ...r, fromLedger }, reader, { act: "payment", finality: "validated", ...(search ? { search } : {}) }));
    },
    async position(_p, at): Promise<Position> {
      return { ledger: await validatedLedger(c.node, at.deadline) };
    },
  };
}

const NO_FEES: Module["fees"] = { paysFee: () => false, payerBroadcast: () => false };

/** The payer variant the published class refuses: a transaction that carries `Signers`. */
export function isMultisigned(payload: PaymentPayload): boolean {
  const tx = txOf(payload);
  return tx !== undefined && Array.isArray(tx["Signers"]) && tx["Signers"].length > 0;
}

/** The amount the Payment signs equals the requirements' (drops for XRP, else the issued currency with its issuer). */
function amountMatches(tx: Record<string, unknown>, r: PaymentRequirements): boolean {
  const amount = tx["Amount"];
  if (r.asset === "XRP") return typeof amount === "string" && amount === r.amount;
  return (
    isObject(amount) &&
    amount["currency"] === r.asset &&
    amount["issuer"] === r.extra?.["issuer"] &&
    amount["value"] === r.amount
  );
}

/**
 * The checks of a multisigned payment that read the chain: the Payment's form against the requirements, as the class
 * makes them for a payment signed with one key; each signer's signature over the transaction's multisigning data with
 * its own key, a key that is its master key or its regular key; the payer's signer list met by those signers' weights;
 * its Sequence or ticket unconsumed; and the server's simulation. The payer, or the refusal.
 */
async function multisigChecks(c: XrplConfig, node: XrplNode, payload: PaymentPayload, r: PaymentRequirements): Promise<string | Failure> {
  const ref = await pure(c.network, payload, r);
  if (!isRef(ref)) return ref;
  const tx = txOf(payload)!;
  const account = String(tx["Account"]);
  if (tx["TransactionType"] !== "Payment") return { reason: "invalid_exact_xrpl_payload_transaction_type" };
  if (tx["SigningPubKey"] !== "") return { reason: "invalid_exact_xrpl_payload_signing_pub_key" };
  if (tx["Destination"] !== r.payTo) return { reason: "invalid_exact_xrpl_payload_destination_mismatch" };
  if (!amountMatches(tx, r)) return { reason: "invalid_exact_xrpl_payload_amount_mismatch" };
  if (((Number(tx["Flags"] ?? 0) >>> 0) & PARTIAL_PAYMENT) !== 0) return { reason: "invalid_exact_xrpl_payload_partial_payment_not_allowed" };
  if (tx["SendMax"] !== undefined || tx["Paths"] !== undefined || tx["DeliverMin"] !== undefined) {
    return { reason: "invalid_exact_xrpl_payload_paths_not_allowed" };
  }
  if (typeof tx["Fee"] !== "string" || BigInt(tx["Fee"]) > BigInt(c.maxFeeDrops ?? DEFAULT_MAX_FEE_DROPS)) {
    return { reason: "invalid_exact_xrpl_payload_fee_too_high" };
  }
  const last = tx["LastLedgerSequence"];
  if (typeof last !== "number") return { reason: "invalid_exact_xrpl_payload_lastledgersequence_missing" };
  const signers = tx["Signers"] as unknown[];
  const list = await node.signerList(account);
  if (list === null) return { reason: "invalid_exact_xrpl_payload_signer_not_authorized" };
  let weight = 0;
  const seen = new Set<string>();
  for (const s of signers) {
    const signer = isObject(s) && isObject(s["Signer"]) ? s["Signer"] : undefined;
    const who = signer?.["Account"];
    const key = signer?.["SigningPubKey"];
    const sig = signer?.["TxnSignature"];
    if (typeof who !== "string" || typeof key !== "string" || typeof sig !== "string" || seen.has(who)) {
      return { reason: "invalid_exact_xrpl_payload_signature" };
    }
    seen.add(who);
    const data = encodeForMultiSigning(tx as unknown as Transaction, who);
    if (!verifyKeypairSignature(data, sig, key)) return { reason: "invalid_exact_xrpl_payload_signature" };
    const derived = deriveAddress(key);
    if (derived !== who) {
      const auth = await node.authorization(who);
      if (auth.regularKey !== derived) return { reason: "invalid_exact_xrpl_payload_signer_not_authorized" };
    } else if ((await node.authorization(who)).isMasterKeyDisabled) {
      return { reason: "invalid_exact_xrpl_payload_signer_not_authorized" };
    }
    weight += list.weights.get(who) ?? 0;
  }
  if (weight < list.quorum) return { reason: "invalid_exact_xrpl_payload_signer_not_authorized" };
  if ((await node.validatedLedger()) >= last) return { reason: "invalid_exact_xrpl_payload_expired" };
  const ticket = tx["TicketSequence"];
  if (typeof ticket === "number") {
    if (!(await node.ticket(account, ticket))) return { reason: "invalid_exact_xrpl_payload_ticket_unavailable" };
  } else if ((await node.sequence(account)) !== tx["Sequence"]) {
    return { reason: "invalid_exact_xrpl_payload_sequence_mismatch" };
  }
  const simulated = await node.simulate(String(payload.payload["signedTxBlob"]));
  if (simulated.engineResult !== "tesSUCCESS") return { reason: "invalid_exact_xrpl_payload_simulation_failed", code: simulated.engineResult };
  return account;
}

/** The own path for a multisigned payer: the checks above, then the signed blob submitted unchanged. */
function multisignedModule(c: XrplConfig, node: XrplNode): Module {
  const network = c.network as Network;
  const facilitator: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: "xrpl:*",
    getExtra: () => undefined,
    getSigners: () => [],
    async verify(payload, requirements) {
      const r = await multisigChecks(c, node, payload, requirements);
      return typeof r === "string" ? { isValid: true, payer: r } : verifyFailure(r);
    },
    async settle(payload, requirements) {
      const r = await multisigChecks(c, node, payload, requirements);
      if (typeof r !== "string") return settleFailure(r, network);
      const sent = await node.submit(String(payload.payload["signedTxBlob"]));
      if (sent.validated && sent.resultCode === "tesSUCCESS") return { success: true, transaction: sent.hash, network, payer: r };
      if (!sent.validated) return { success: false, errorReason: "settlement_pending", transaction: sent.hash, network, payer: r };
      return { success: false, errorReason: `transaction_failed: ${sent.resultCode}`, transaction: sent.hash, network, payer: r };
    },
  };
  return { descriptor: descriptor(), network, facilitator, record: recordOf(c), fees: NO_FEES };
}

/** One kind for both paths: x402/exact/xrpl, no key; zero is no Payment (a Payment of zero is malformed). */
function descriptor(): Module["descriptor"] {
  return { name: "xrpl", key: "none", pairings: [exactXrpl.id], acceptsZero: [] };
}

/** The published class with the module's pure checks before it on both calls. */
function behind(cls: SchemeNetworkFacilitator, network: XrplNetwork): SchemeNetworkFacilitator {
  return {
    scheme: cls.scheme,
    caipFamily: cls.caipFamily,
    getExtra: (n) => cls.getExtra(n),
    getSigners: (n) => cls.getSigners(n),
    async verify(payload, requirements, context) {
      const r = await pure(network, payload, requirements);
      return isRef(r) ? cls.verify(payload, requirements, context) : verifyFailure(r);
    },
    async settle(payload, requirements, context) {
      const r = await pure(network, payload, requirements);
      return isRef(r) ? cls.settle(payload, requirements, context) : settleFailure(r, requirements.network);
    },
  };
}

/** The registration of `x402/exact/xrpl` on the configured network, the multisigned payer handed to the own path. */
export function xrplRegistration(c: XrplConfig, node: XrplNode = xrplNode(c.node, c.waitMs ?? 30_000)): Registration {
  const cls = new ExactXrplScheme({
    maxFeeDrops: c.maxFeeDrops ?? DEFAULT_MAX_FEE_DROPS,
    getCurrentLedgerIndex: () => node.validatedLedger(),
    getAccountSequence: (account) => node.sequence(account),
    getAccountAuthorization: (account) => node.authorization(account),
    isTicketAvailable: (account, ticket) => node.ticket(account, ticket),
    simulateSignedTransaction: (blob) => node.simulate(blob),
    submitSignedTransaction: (blob) => node.submit(blob),
  });
  const network = c.network as Network;
  const module: Module = { descriptor: descriptor(), network, facilitator: behind(cls, c.network), record: recordOf(c), fees: NO_FEES };
  const multisigned: Handoff = {
    claim: { by: "payment", claims: (payload: PaymentPayload) => isMultisigned(payload) },
    module: multisignedModule(c, node),
  };
  return { network, module, own: [multisigned] };
}


/** The registration of `x402/upto/xrpl` on the configured network: the module's own facilitator, x402 publishing none. */
export function uptoRegistration(c: XrplConfig, node: XrplNode = xrplNode(c.node, c.waitMs ?? 30_000)): Registration {
  return { network: c.network as Network, module: uptoModule(c.network, node), own: [] };
}

/**
 * How the core starts the module: the configuration's `xrpl` member lists the networks, one entry each, and each is
 * served `exact` and `upto` over its server.
 */
export const starter: ModuleStarter<readonly XrplConfig[]> = {
  name: "xrpl",
  async start(networks) {
    return {
      registrations: networks.flatMap((c) => {
        const node = xrplNode(c.node, c.waitMs ?? 30_000);
        return [xrplRegistration(c, node), uptoRegistration(c, node)];
      }),
    };
  },
};
