/**
 * Stellar: the settler's own facilitator for the pairing `x402/exact/stellar/precondition`, the agreement on x402's
 * `exact` scheme, told from every other Stellar option by `extra.assetTransferMethod` `"lcp-precondition"`. The buyer
 * signs a Soroban authorization of `transfer(buyer, payTo, amount)` and the 40-byte payload of H and that
 * authorization's nonce, which the transaction carries as its one signed-payload signer (CAP-40); the payload's
 * signature rides as a decorated signature of the envelope the buyer presents. The module is the transaction's source:
 * it builds the transaction it submits around the buyer's operation and preconditions, unchanged, with its own source
 * account, sequence number, fee and resource data, signs it, and carries the buyer's payload signature beside its own
 * (lcp's profile `x402-exact-stellar-precondition.md`, rule 11). x402's published Stellar facilitator keeps a
 * transaction's preconditions when it rebuilds it but signs it alone, so the payload's signature never reaches the
 * chain and the network refuses the transaction (`txBAD_AUTH`).
 *
 * lcp decodes the payment (`bound`, `reference`, `decodeStellarTx`) and reads it (`status`); the module adds x402's
 * Stellar scheme's checks (`scheme_exact_stellar.md`: the transfer against the requirements, the facilitator's safety,
 * the authorization entries, the simulation and its events, the fee ceiling), with the reasons of x402's own Stellar
 * facilitator (`@x402/stellar` 2.31.0), and the payload signature's.
 */
import { canonicalJson, isRefusal, type Refusal } from "@integraledger/lcp";
import { decodeStellarTx, PASSPHRASE, transferEventOf, type StellarNetwork, type StellarRef } from "@integraledger/lcp/stellar";
import { exactStellarPrecondition } from "@integraledger/lcp/x402-exact-stellar";
import { Keypair, StrKey, Transaction, xdr } from "@stellar/stellar-sdk/base";
import type { DecoratedSignatureWire, MuxedAccountWire, ScValWire, TransactionWire } from "@stellar/stellar-sdk/xdr";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { isObject, type InvalidReason, type OperatorEntry } from "../../answers.js";
import { NodeError, sleep } from "../../http.js";
import { outcomeOf, type Core, type Module, type ModuleStarter } from "../../module.js";
import { settleReason, unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import { RpcFault, stellarNode, type Simulated, type StellarNode } from "./node.js";

/**
 * The source account's signer: the account's `G…` address, and SEP-43's `signTransaction`, which returns the envelope
 * it is given with the account's signature added. x402's `FacilitatorStellarSigner` (`createEd25519Signer` of
 * `@x402/stellar`) is one; so is any SEP-43 wallet or signing service.
 */
export interface StellarSigner {
  readonly address: string;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string; error?: unknown }>;
}

/** The configuration's member `stellar`: one entry per network the settler serves. */
export interface StellarConfig {
  readonly networks: readonly StellarNetworkConfig[];
}

/** One Stellar network. */
export interface StellarNetworkConfig {
  network: StellarNetwork;
  /** A Stellar RPC endpoint that holds the history the read searches, a few ledgers back from the entry's expiration. */
  rpc: string;
  /** The seller's funded account, the transaction's source, which pays its fee and spends its sequence number. */
  source: StellarSigner;
  /**
   * The most one settlement's fee may be, in stroops: x402's `maxTransactionFeeStroops`, whose default, 50,000, is its
   * Stellar scheme's. A simulation that needs more is refused.
   */
  maxTransactionFeeStroops?: number;
  /** The inclusion fee bid above the simulated resource fee, in stroops: x402's `inclusionFeeStroops`, at least 100, default 100. */
  inclusionFeeStroops?: number;
}

const ID = exactStellarPrecondition.id;
const NETWORKS: readonly string[] = ["stellar:pubnet", "stellar:testnet"];
/** The seconds per ledger by which an option's `maxTimeoutSeconds` becomes a ledger count: the profile's (rule 5), and x402's fallback. */
const LEDGER_SECONDS = 5;
/** The ledgers past that count that x402's Stellar facilitator admits an entry's expiration (2.31.0, `SIGNATURE_EXPIRATION_LEDGER_TOLERANCE`). */
const EXPIRATION_TOLERANCE = 2;
const DEFAULT_MAX_FEE = 50_000;
const DEFAULT_INCLUSION_FEE = 100;
const POLL_MS = 1_000;
/** `txBAD_SEQ` (`Stellar-transaction.x`, `TransactionResultCode`). */
const TX_BAD_SEQ = -5;

/** A refusal: x402's reason, and lcp's code or what the check found where there is one. */
interface No {
  readonly reason: string;
  readonly message?: string;
}
const no = (reason: string, message?: string): No => (message === undefined ? { reason } : { reason, message });
const isNo = (v: unknown): v is No => isObject(v) && typeof v["reason"] === "string" && Object.keys(v).every((k) => k === "reason" || k === "message");

/** A payment that passed every check that reads neither the chain nor the clock. */
interface Inspected {
  readonly ref: StellarRef;
  /** The presented envelope, base64, which the simulation reads. */
  readonly presented: string;
  /** The transaction the buyer's operation and preconditions ride in, as presented (a fee bump's inner one). */
  readonly tx: TransactionWire;
  /** The buyer's signature of the signed payload, as the presented envelope carries it. */
  readonly payloadSignature: DecoratedSignatureWire;
  readonly amount: bigint;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
}

/** lcp's refusals of the option's form: the requirements' fault where the payment echoes them unchanged. */
const OPTION_CODES = new Set(["x402/option-malformed", "x402/option-not-this-pairing", "stellar/option-malformed", "stellar/network-malformed"]);

/** The x402 reason for lcp's refusal of the payment, with lcp's code as the message. */
function refusedBy(r: Refusal, payload: PaymentPayload, requirements: PaymentRequirements): No {
  if (r.code === "x402/not-v2") return no("invalid_x402_version", r.code);
  const echoed = canonicalJson(payload.accepted as never) === canonicalJson(requirements as never);
  return no(echoed && OPTION_CODES.has(r.code) ? "invalid_payment_requirements" : "invalid_payload", r.code);
}

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

/** A muxed account's base account, as a `G…` strkey. */
function accountOf(m: MuxedAccountWire): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(m.type === 0 ? m.ed25519 : m.med25519.ed25519));
}

/** An `ScAddress`'s strkey, or "" where it is neither an account nor a contract. */
function addressOf(a: Extract<ScValWire, { type: 18 }>["address"]): string {
  if (a.type === 0 && a.accountId.type === 0) return StrKey.encodeEd25519PublicKey(Buffer.from(a.accountId.ed25519));
  if (a.type === 1) return StrKey.encodeContract(Buffer.from(a.contractId));
  return "";
}

/** Starts one module per configured network, each its own registration of `exact`. */
export const starter: ModuleStarter<StellarConfig> = {
  name: "stellar",
  async start(config, core) {
    return { registrations: config.networks.map((c) => ({ network: c.network as Network, module: stellarModule(c, core), own: [] })) };
  },
};

/**
 * The module for one network. The settler's wait for the chain is the core's; the fee meter is the network's, which
 * the module tells of each transaction's fee before it sends it and of the fee charged once it is included.
 */
export function stellarModule(c: StellarNetworkConfig, core: Core): Module {
  if (!NETWORKS.includes(c.network)) throw new TypeError(`not a Stellar network: ${c.network}`);
  const source = c.source.address;
  if (!StrKey.isValidEd25519PublicKey(source)) throw new TypeError("the source account's address is not an account strkey");
  const maxFee = BigInt(c.maxTransactionFeeStroops ?? DEFAULT_MAX_FEE);
  const inclusion = BigInt(c.inclusionFeeStroops ?? DEFAULT_INCLUSION_FEE);
  if (maxFee <= 0n || inclusion < 100n) throw new TypeError("the fee ceiling must be positive, and the inclusion fee at least 100 stroops");
  const network = c.network;
  const passphrase = PASSPHRASE[network];
  const sourceKey = Keypair.fromPublicKey(source).rawPublicKey();
  const node: StellarNode = stellarNode(c.rpc.replace(/\/+$/, ""));
  const { log, settleWaitMs } = core;
  const meter = core.meter(network as Network);
  /** The source account's transactions are sent one at a time; `last` is the sequence number of the last one sent. */
  let sending: Promise<unknown> = Promise.resolve();
  let last: bigint | undefined;

  const about = (i: Inspected) => ({ network, payer: i.ref.buyer });

  /**
   * Every check of the payment that reads neither the chain nor the clock: lcp's (the option, the envelope, the carrier,
   * the reference), x402's of the transfer against the requirements, of the facilitator's safety and of the
   * authorization entries, and that the envelope carries the buyer's signature of the signed payload.
   */
  async function inspect(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Inspected | No> {
    if (!isObject(payload) || !isObject(requirements) || !isObject(payload.payload)) return no("invalid_payload");
    if (requirements.network !== network) return no("invalid_network");
    if (requirements.scheme !== "exact") return no("unsupported_scheme");
    const h = await exactStellarPrecondition.bound(payload as never);
    if (isRefusal(h)) return refusedBy(h, payload, requirements);
    const ref = await exactStellarPrecondition.reference(payload as never, requirements as never);
    if (isRefusal(ref)) return refusedBy(ref, payload, requirements);
    const presented = (payload.payload as { transaction: string }).transaction;
    const p = decodeStellarTx(presented, network);
    if (isRefusal(p)) return refusedBy(p, payload, requirements);
    // x402's checks of the transfer against the requirements, in its order.
    if (p.asset !== requirements.asset) return no("invalid_exact_stellar_payload_wrong_asset");
    if (p.from === source) return no("invalid_exact_stellar_payload_facilitator_is_payer");
    if (p.to !== requirements.payTo) return no("invalid_exact_stellar_payload_wrong_recipient");
    if (p.amount !== BigInt(requirements.amount)) return no("invalid_exact_stellar_payload_wrong_amount");
    const env = xdr.TransactionEnvelope.fromXdr(presented, "base64").toXdrObject();
    const v1 = env.type === 2 ? env.v1 : env.type === 5 && env.feeBump.tx.innerTx.type === 2 ? env.feeBump.tx.innerTx.v1 : undefined;
    if (v1 === undefined) return no("invalid_payload", "stellar/tx-malformed");
    const op = v1.tx.operations[0]!;
    if (accountOf(v1.tx.sourceAccount) === source || (op.sourceAccount !== null && accountOf(op.sourceAccount) === source)) {
      return no("invalid_exact_stellar_payload_unsafe_tx_or_op_source");
    }
    if (op.body.type !== 24) return no("invalid_payload", "stellar/not-one-transfer");
    // Every entry must be an address's: one with source-account credentials is authorised by the transaction's
    // source, the module's account, whose signature covers the whole transaction.
    const auth = op.body.invokeHostFunctionOp.auth;
    if (auth.length === 0) return no("invalid_exact_stellar_payload_no_auth_entries");
    const unsigned: string[] = [];
    for (const e of auth) {
      const k = e.credentials;
      if (k.type !== 1 && k.type !== 2) return no("invalid_exact_stellar_payload_unsupported_credential_type");
      const a = k.type === 1 ? k.address : k.addressV2;
      const who = addressOf(a.address);
      if (who === source) return no("invalid_exact_stellar_payload_facilitator_in_auth");
      if (e.rootInvocation.subInvocations.length > 0) return no("invalid_exact_stellar_payload_has_subinvocations");
      if (a.signature.type === 1) unsigned.push(who);
    }
    if (unsigned.includes(p.from)) return no("invalid_exact_stellar_payload_missing_payer_signature");
    if (unsigned.length > 0) return no("invalid_exact_stellar_payload_unexpected_pending_signatures");
    // The buyer's signature of the signed payload: a decorated signature whose hint is the key's last 4 bytes XOR the
    // payload's last 4 (CAP-40), which verifies over the payload. Without it the network refuses the transaction.
    const cond = v1.tx.cond;
    const signer = cond.type === 2 ? cond.v2.extraSigners.find((s) => s.type === 3) : undefined;
    if (signer === undefined || signer.type !== 3) return no("invalid_payload", "stellar/no-carrier");
    const { ed25519: key, payload: signedPayload } = signer.ed25519SignedPayload;
    const hint = Uint8Array.from(key.subarray(28), (b, j) => b ^ signedPayload[signedPayload.length - 4 + j]!);
    const buyerKey = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(key)));
    const payloadSignature = v1.signatures.find(
      (s) => sameBytes(s.hint, hint) && buyerKey.verify(Buffer.from(signedPayload), Buffer.from(s.signature)),
    );
    if (payloadSignature === undefined) return no("invalid_payload", "no signature of the signed payload");
    return {
      ref,
      presented,
      tx: v1.tx,
      payloadSignature,
      amount: p.amount,
      asset: p.asset,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    };
  }

  /**
   * x402's check of the simulation's events: only contract events of a `transfer` on the asset, exactly one, from the
   * buyer to the payee's plain account, for the amount. Each event is read by lcp's reader of a Stellar Asset Contract's
   * events.
   */
  function eventsRefusal(events: readonly string[], i: Inspected): No | undefined {
    const transfers: { from: string | null; toBase: string | null; toMuxedId: bigint | null; amount: bigint }[] = [];
    for (const b64 of events) {
      const d = xdr.DiagnosticEvent.fromXdr(b64, "base64").toXdrObject();
      // ContractEventType: SYSTEM 0, CONTRACT 1, DIAGNOSTIC 2.
      if (d.event.type !== 1) continue;
      const v0 = d.event.body.v0;
      const ev = transferEventOf(
        v0.topics.map((t) => xdr.ScVal.fromXdrObject(t).toXdr("base64")),
        xdr.ScVal.fromXdrObject(v0.data).toXdr("base64"),
      );
      if (isRefusal(ev) || ev.kind !== "transfer") return no("invalid_exact_stellar_payload_event_not_transfer");
      if (d.event.contractId === null) return no("invalid_exact_stellar_payload_event_missing_contract_id");
      if (StrKey.encodeContract(Buffer.from(d.event.contractId)) !== i.asset) return no("invalid_exact_stellar_payload_event_wrong_asset");
      transfers.push(ev);
    }
    if (transfers.length === 0) return no("invalid_exact_stellar_payload_no_transfer_events");
    if (transfers.length > 1) return no("invalid_exact_stellar_payload_multiple_transfers");
    const t = transfers[0]!;
    if (t.from !== i.ref.buyer) return no("invalid_exact_stellar_payload_event_wrong_from");
    if (t.toBase !== i.payTo || t.toMuxedId !== null) return no("invalid_exact_stellar_payload_event_wrong_to");
    if (t.amount !== i.amount) return no("invalid_exact_stellar_payload_event_wrong_amount");
    return undefined;
  }

  /**
   * The checks that read the chain, in x402's order: a simulation of the presented transaction that succeeds, a fee
   * within the ceiling, the events, and an entry whose expiration ledger is within the option's timeout of the latest
   * ledger. A node that could not answer is no verdict: `unexpected_verify_error`, once its entry is in the operator
   * log.
   */
  async function chainChecks(i: Inspected, deadline: number): Promise<{ sim: Extract<Simulated, { ok: true }>; fee: bigint } | No> {
    const failedRead = (call: string, e: unknown): No => no(unexpectedVerify(log, { event: "node-call-failed", ...about(i), call }, e));
    let sim: Simulated;
    try {
      sim = await node.simulate(i.presented, deadline);
    } catch (e) {
      if (e instanceof RpcFault) return no("invalid_exact_stellar_payload_simulation_failed", e.message);
      return failedRead("simulateTransaction", e);
    }
    if (!sim.ok) return no("invalid_exact_stellar_payload_simulation_failed", sim.error);
    const fee = sim.minResourceFee + inclusion;
    if (fee > maxFee || fee > 0xffffffffn) {
      return no("invalid_exact_stellar_payload_fee_exceeds_maximum", `simulation-derived fee ${fee} stroops exceeds ceiling ${maxFee} stroops`);
    }
    let events: No | undefined;
    try {
      events = eventsRefusal(sim.events, i);
    } catch (e) {
      return failedRead("simulateTransaction", e);
    }
    if (events !== undefined) return events;
    let latest: number;
    try {
      latest = (await node.latestLedger(deadline)).sequence;
    } catch (e) {
      return failedRead("getLatestLedger", e);
    }
    if (i.ref.expiration > latest + Math.ceil(i.maxTimeoutSeconds / LEDGER_SECONDS) + EXPIRATION_TOLERANCE) {
      return no("invalid_exact_stellar_signature_expiration_too_far");
    }
    return { sim, fee };
  }

  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return refusedVerify(i);
    const checked = await chainChecks(i, deadline);
    if (isNo(checked)) return refusedVerify({ ...checked, payer: i.ref.buyer });
    return { isValid: true, payer: i.ref.buyer };
  }

  async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return failed(i.reason, "", i.message);
    const checked = await chainChecks(i, deadline);
    if (isNo(checked)) return failed(settleReason(checked.reason as InvalidReason), "", checked.message);
    const run = sending.then(() => send(i, checked.sim, checked.fee, deadline));
    sending = run.catch(() => undefined);
    const out = await run;
    if ("answer" in out) return out.answer;
    return watch(i, out.transaction, deadline);
  }

  /**
   * Builds the transaction the module submits: the buyer's, its preconditions, memo and operation (the buyer's entry
   * among it) unchanged, with the source account, the next sequence number, the fee and the simulation's resource data
   * the module's own. The fee meter allows it, the source account's signer signs it, and the buyer's signature of the
   * signed payload goes beside that signature. A request that cannot have reached the node sends nothing: the module's
   * own failure with no transaction, as does a node that refuses it. One that may have reached it is read for its
   * result.
   */
  async function send(i: Inspected, sim: Extract<Simulated, { ok: true }>, fee: bigint, deadline: number): Promise<{ transaction: string } | { answer: SettleResponse }> {
    let seq: bigint | null;
    try {
      seq = await node.sequence(source, deadline);
    } catch (e) {
      return { answer: unexpected({ event: "node-call-failed", ...about(i), call: "getLedgerEntries" }, e) };
    }
    if (seq === null) return { answer: unexpected({ event: "source-account-missing", ...about(i), account: source }) };
    const next = (last !== undefined && last > seq ? last : seq) + 1n;
    const tx: TransactionWire = {
      ...i.tx,
      sourceAccount: { type: 0, ed25519: sourceKey },
      fee: Number(fee),
      seqNum: next,
      ext: { v: 1, sorobanData: xdr.SorobanTransactionData.fromXdr(sim.transactionData, "base64").toXdrObject() },
    };
    const unsigned = xdr.TransactionEnvelope.fromXdrObject({ type: 2, v1: { tx, signatures: [] } }).toXdr("base64");
    const hash = toHex(new Transaction(unsigned, passphrase).hash());
    if (!(await meter.sending({ network: network as Network, transaction: hash, bound: fee }))) {
      return { answer: failed("fee_budget_spent", "") };
    }
    let signed: DecoratedSignatureWire[];
    try {
      const r = await c.source.signTransaction(unsigned, { networkPassphrase: passphrase, address: source });
      if (r.error !== undefined && r.error !== null) throw r.error;
      const back = xdr.TransactionEnvelope.fromXdr(r.signedTxXdr, "base64").toXdrObject();
      // The signer signs the transaction it is given, and nothing else.
      if (back.type !== 2 || xdr.Transaction.fromXdrObject(back.v1.tx).toXdr("base64") !== xdr.Transaction.fromXdrObject(tx).toXdr("base64")) {
        throw new Error("the signer returned another transaction");
      }
      signed = back.v1.signatures;
    } catch (e) {
      log({ event: "source-sign-failed", ...about(i), transaction: hash }, e);
      return { answer: failed("settle_exact_stellar_transaction_signing_failed", "") };
    }
    const envelope = xdr.TransactionEnvelope.fromXdrObject({ type: 2, v1: { tx, signatures: [...signed, i.payloadSignature] } }).toXdr("base64");
    try {
      const sent = await node.send(envelope, deadline);
      if (sent.status === "PENDING" || sent.status === "DUPLICATE") {
        last = next;
        if (sent.hash !== hash) log({ event: "transaction-hash-differs", ...about(i), transaction: sent.hash, computed: hash });
        return { transaction: hash };
      }
      if (sent.status === "TRY_AGAIN_LATER") return { answer: failed("settle_exact_stellar_transaction_submission_retryable", "") };
      const code = resultCode(sent.errorResultXdr);
      if (code === TX_BAD_SEQ) last = undefined;
      log({ event: "submission-refused", ...about(i), transaction: hash, ...(code === undefined ? {} : { result: code }) });
      return {
        answer: failed("settle_exact_stellar_transaction_submission_failed", "", `sendTransaction answered ERROR${code === undefined ? "" : ` (result code ${code})`}`),
      };
    } catch (e) {
      const entry = { event: "node-call-failed", ...about(i), call: "sendTransaction", transaction: hash };
      if (e instanceof RpcFault || (e instanceof NodeError && !e.sent)) return { answer: unexpected(entry, e) };
      log(entry, e);
      return { transaction: hash };
    }
  }

  /**
   * Reads the transaction every second until `deadline`: once the node shows it in a ledger, its fee charged goes to the
   * meter, and it succeeded only where its status is `SUCCESS`; a `FAILED` one is x402's failure naming it. Not yet
   * shown: `settlement_pending`.
   */
  async function watch(i: Inspected, tx: string, deadline: number): Promise<SettleResponse> {
    for (;;) {
      let t: Awaited<ReturnType<StellarNode["transaction"]>> | undefined;
      try {
        t = await node.transaction(tx, deadline);
      } catch (e) {
        if (!(e instanceof NodeError && e.code === "spent")) log({ event: "node-call-failed", ...about(i), call: "getTransaction", transaction: tx }, e);
      }
      if (t !== undefined && (t.status === "SUCCESS" || t.status === "FAILED")) {
        const charged = feeCharged(t.resultXdr);
        if (charged !== undefined) meter.included({ network: network as Network, transaction: tx, fee: charged });
        else log({ event: "fee-unread", ...about(i), transaction: tx });
        if (t.status === "SUCCESS") return { success: true, transaction: tx, network: network as Network, payer: i.ref.buyer };
        log({ event: "settlement-failed", ...about(i), transaction: tx });
        return failed("settle_exact_stellar_transaction_failed", tx);
      }
      if (performance.now() + POLL_MS > deadline) return failed("settlement_pending", tx);
      await sleep(POLL_MS);
    }
  }

  /** `unexpected_settle_error` with no transaction, once its entry is in the operator log. */
  function unexpected(entry: OperatorEntry, cause?: unknown): SettleResponse {
    const a = unexpectedSettle(log, { ...entry, network }, cause);
    return { ...a, network: network as Network };
  }

  function failed(errorReason: string, tx: string, errorMessage?: string): SettleResponse {
    return { success: false, errorReason, ...(errorMessage === undefined ? {} : { errorMessage }), transaction: tx, network: network as Network };
  }

  const facilitator: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: "stellar:*",
    // x402's Stellar facilitator states `areFeesSponsored`; the option of this form must carry it `true`.
    getExtra: () => ({ areFeesSponsored: true }),
    getSigners: () => [source],
    verify,
    settle,
  };

  return {
    descriptor: {
      name: "stellar",
      key: "relayer",
      pairings: [ID],
      // The Stellar Asset Contract refuses only a negative amount and emits its event at zero (the profile, rule 13).
      acceptsZero: true,
    },
    network: network as Network,
    facilitator,
    record: {
      async instrument(p) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return { refused: i.reason };
        return {
          pairing: ID,
          // The single-use value is the buyer's entry's nonce (the profile, rule 12), which the host keeps per
          // authorizing address, whatever contract the entry invokes.
          instrument: { by: "single-use", network: network as Network, signer: i.ref.buyer, value: i.ref.nonce },
          nonce: exactStellarPrecondition.data.nonce,
          // The entry lapses at a ledger, which no clock time bounds: kept for the settler's life.
          keep: { until: "settler" },
        };
      },
      /**
       * lcp's read, its search starting at the earliest ledger the buyer's entry can land in: the ledger it was signed
       * for, its expiration less the option's timeout in ledgers (the profile, rule 5), less x402's tolerance.
       */
      async read(p, at) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const fromLedger = Math.max(0, i.ref.expiration - Math.ceil(i.maxTimeoutSeconds / LEDGER_SECONDS) - EXPIRATION_TOLERANCE);
        const query = { act: "agreement" as const, finality: "finalized" as const, ...(typeof at.search === "string" ? { search: at.search } : {}) };
        return outcomeOf(await exactStellarPrecondition.status({ ...i.ref, fromLedger }, node.reader(at.deadline), query));
      },
    },
    fees: {
      // The source account sends and pays for every settlement; the buyer signs no envelope and never broadcasts it.
      paysFee: () => true,
      payerBroadcast: () => false,
    },
  };
}

/** The `TransactionResult`'s code, or undefined where it does not decode. */
function resultCode(resultXdr: string | undefined): number | undefined {
  if (resultXdr === undefined) return undefined;
  try {
    return xdr.TransactionResult.fromXdr(resultXdr, "base64").toXdrObject().result.code;
  } catch {
    return undefined;
  }
}

/** The fee a `TransactionResult` shows charged, in stroops, or undefined where it does not decode. */
function feeCharged(resultXdr: string | undefined): bigint | undefined {
  if (resultXdr === undefined) return undefined;
  try {
    return xdr.TransactionResult.fromXdr(resultXdr, "base64").toXdrObject().feeCharged;
  } catch {
    return undefined;
  }
}

function refusedVerify(r: No & { payer?: string }): VerifyResponse {
  return {
    isValid: false,
    invalidReason: r.reason,
    ...(r.message === undefined ? {} : { invalidMessage: r.message }),
    ...(r.payer === undefined ? {} : { payer: r.payer }),
  };
}
