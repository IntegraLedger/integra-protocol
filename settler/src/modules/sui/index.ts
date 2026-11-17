/**
 * Sui: the settler's own facilitator for the pairing `x402/exact/sui`, written to x402's Sui scheme
 * (`scheme_exact_sui.md`), which x402 specifies and publishes no code for, and to lcp's profile `x402-exact-sui.md`. The
 * payer signs one programmable transaction carrying H as its one unused `Pure` input; the module checks it (the network,
 * the signature, the gas path the option fixes, a simulation showing the payee's credit) and executes it unchanged.
 * It serves the paths where the buyer pays gas and where none is paid (`extra.gasless`), and holds no key: x402's
 * sponsored path needs a gas station, whose wire x402's scheme does not state and whose caller is the buyer's client,
 * so an option naming one is refused. A transaction the buyer already executed is judged at `/verify` by its effects and not refused for having executed; its `/settle`
 * answers a failure naming it. lcp decodes the payment (`bound`, `reference`, `decodeSuiTx`) and reads it (`status`).
 */
import { canonicalJson, isRefusal, type Refusal } from "@integraledger/lcp";
import { decodeSuiTx, exactSui, type SuiNetwork, type SuiTx } from "@integraledger/lcp/sui";
import { bcs } from "@mysten/sui/bcs";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { normalizeStructTag, normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { isObject, type InvalidReason, type OperatorEntry } from "../../answers.js";
import { NodeError, sleep } from "../../http.js";
import { outcomeOf, type Core, type Module, type ModuleStarter } from "../../module.js";
import { settleReason as settleReasonOf, unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import { GraphqlFault, suiNode, type Effects, type Latest, type SuiNode } from "./node.js";

/** The configuration's member `sui`: one entry per network the settler serves. */
export interface SuiConfig {
  readonly networks: readonly SuiNetworkConfig[];
}

/** One Sui network. */
export interface SuiNetworkConfig {
  network: SuiNetwork;
  /** The seller's GraphQL endpoint. */
  graphql: string;
}

const ID = exactSui.id;
const NETWORKS: readonly string[] = ["sui:mainnet", "sui:testnet", "sui:devnet"];
const POLL_MS = 1_000;

interface No {
  readonly reason: string;
  readonly message?: string;
}
const no = (reason: string, message?: string): No => (message === undefined ? { reason } : { reason, message });
const isNo = (v: unknown): v is No => isObject(v) && typeof v["reason"] === "string" && Object.keys(v).every((k) => k === "reason" || k === "message");

type Parsed = ReturnType<typeof bcs.TransactionData.parse>;
type V1 = Extract<Parsed, { $kind: "V1" }>["V1"];
type Command = ReturnType<typeof bcs.Command.parse>;
type Argument = ReturnType<typeof bcs.Argument.parse>;

/** The gas path the option fixes (the profile, rule 7), of the two served. */
type Path = "gasless" | "buyer";

/** A payment that passed every check that reads neither the chain nor the clock. */
interface Inspected {
  readonly tx: SuiTx;
  readonly v1: V1;
  readonly h: string;
  readonly path: Path;
  readonly sender: string;
  readonly payTo: string;
  readonly asset: string;
  readonly amount: bigint;
  readonly signature: string;
}

/** lcp's refusals of the option's form: the requirements' fault where the payment echoes them unchanged. */
const OPTION_CODES = new Set(["x402/option-not-this-pairing", "x402/option-malformed", "sui/network-malformed"]);

function refusedBy(r: Refusal, payload: PaymentPayload, requirements: PaymentRequirements): No {
  if (OPTION_CODES.has(r.code) && canonicalJson(payload.accepted as never) === canonicalJson(requirements as never)) {
    return no("invalid_payment_requirements", r.code);
  }
  return no("invalid_payload", r.code);
}

const address = (a: string) => normalizeSuiAddress(a);
function sameType(a: string, b: string): boolean {
  try {
    return normalizeStructTag(a) === normalizeStructTag(b);
  } catch {
    return false;
  }
}

/** Starts one module per configured network, each its own registration of `exact`. */
export const starter: ModuleStarter<SuiConfig> = {
  name: "sui",
  async start(config, core) {
    return { registrations: config.networks.map((c) => ({ network: c.network as Network, module: suiModule(c, core), own: [] })) };
  },
};

/** The module for one network. */
export function suiModule(c: SuiNetworkConfig, core: Core): Module {
  if (!NETWORKS.includes(c.network)) throw new TypeError(`not a Sui network: ${c.network}`);
  const network = c.network;
  const { log, settleWaitMs } = core;
  const node: SuiNode = suiNode(network, c.graphql.replace(/\/+$/, ""));
  const about = (i: Inspected) => ({ network, payer: i.sender, transaction: i.tx.digest });

  /** Every check that reads neither the chain nor the clock: lcp's form, the gas path, the zero rule. */
  async function inspect(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Inspected | No> {
    if (!isObject(payload) || !isObject(requirements) || !isObject(payload.payload)) return no("invalid_payload");
    if (requirements.network !== network) return no("invalid_network");
    if (requirements.scheme !== "exact") return no("unsupported_scheme");
    const h = await exactSui.bound(payload as never);
    if (isRefusal(h)) return refusedBy(h, payload, requirements);
    const ref = await exactSui.reference(payload as never, requirements as never);
    if (isRefusal(ref)) return refusedBy(ref, payload, requirements);
    const tx = decodeSuiTx((payload.payload as { transaction: string }).transaction);
    if (isRefusal(tx)) return refusedBy(tx, payload, requirements);
    const parsed = bcs.TransactionData.parse(tx.bytes);
    if (parsed.$kind !== "V1") return no("invalid_payload", "sui/not-programmable");
    const v1 = parsed.V1;
    const extra = isObject(requirements.extra) ? requirements.extra : {};
    // An option naming a gas station asks for a sponsorship the module does not give.
    if (extra["gasStation"] !== undefined) return no("invalid_payment_requirements", "sui/gas-station-not-ours");
    const path: Path = extra["gasless"] === true ? "gasless" : "buyer";
    const sender = address(tx.sender);
    const gas = v1.gasData;
    if (path === "gasless") {
      if ((gas.payment ?? []).length !== 0 || BigInt(gas.price ?? 0) !== 0n || BigInt(gas.budget ?? 0) !== 0n) return no("invalid_payload", "sui/not-gasless");
    } else if (gas.owner === null || address(gas.owner) !== sender) {
      // On the path where the buyer pays, a transaction whose gas another account owns needs that account's signature.
      return no("invalid_payload", "sui/gas-owner-not-sender");
    }
    const payTo = address(requirements.payTo);
    const amount = BigInt(requirements.amount);
    // At "0", the signed transfer must name the option's payee (the profile, rule 8): a payee with no change at all
    // would meet the check of the amount.
    if (amount === 0n && !tx.transfers.some((t) => address(t.recipient) === payTo)) return no("invalid_payload", "sui/zero-names-no-payee");
    const signature = (payload.payload as { signature: string }).signature;
    return { tx, v1, h, path, sender, payTo, asset: requirements.asset, amount, signature };
  }

  /** The payee's net credit in the option's coin type equals the amount (x402's verification, its rule 4). */
  function credited(i: Inspected, e: Effects): boolean {
    const change = e.balanceChanges.find((b) => address(b.owner) === i.payTo && sameType(b.coinType, i.asset));
    return (change?.amount ?? 0n) === i.amount;
  }

  /** The sender's signature over the transaction: locally, or by the node's `verifySignature` for zkLogin. */
  async function signed(i: Inspected, deadline: number): Promise<boolean | No> {
    let scheme: string;
    try {
      scheme = parseSerializedSignature(i.signature).signatureScheme;
    } catch {
      return false;
    }
    try {
      if (scheme === "ZkLogin") return await node.verifySignature(i.tx.bytes, i.signature, i.sender, deadline);
      return await isValidTransactionSignature(i.tx.bytes, i.signature, { address: i.sender });
    } catch (e) {
      return no(unexpectedVerify(log, { event: "node-call-failed", ...about(i), call: "verifySignature" }, e));
    }
  }

  type Checked = { executed: Effects | null; latest: Latest };

  /**
   * The checks that read the chain: the signature, then the transaction by its digest. One already executed is judged by its effects (status success, its bytes, the payee's
   * credit); one not executed is simulated, and must succeed and credit the payee.
   */
  async function chainChecks(i: Inspected, deadline: number): Promise<Checked | No> {
    const sig = await signed(i, deadline);
    if (isNo(sig)) return sig;
    if (!sig) return no("invalid_payload", "sui/signature-invalid");
    let read: Awaited<ReturnType<SuiNode["transaction"]>>;
    try {
      read = await node.transaction(i.tx.digest, deadline);
    } catch (e) {
      return no(unexpectedVerify(log, { event: "node-call-failed", ...about(i), call: "transaction" }, e));
    }
    if (read.executed !== null) {
      const { bytes, effects } = read.executed;
      if (toBase64(bytes) !== toBase64(i.tx.bytes)) return no(unexpectedVerify(log, { event: "node-answer-differs", ...about(i), call: "transaction" }));
      if (effects.status !== "SUCCESS") return no("invalid_transaction_state", "sui/executed-failed");
      if (!credited(i, effects)) return no("invalid_payload", "sui/payee-not-credited");
      return { executed: effects, latest: read.latest };
    }
    let simulated: Effects;
    try {
      simulated = await node.simulate(i.tx.bytes, deadline);
    } catch (e) {
      if (e instanceof GraphqlFault) return no("invalid_transaction", "sui/simulation-refused");
      return no(unexpectedVerify(log, { event: "node-call-failed", ...about(i), call: "simulateTransaction" }, e));
    }
    if (simulated.status !== "SUCCESS") return no("invalid_transaction", "sui/simulation-failed");
    if (!credited(i, simulated)) return no("invalid_payload", "sui/payee-not-credited");
    return { executed: null, latest: read.latest };
  }

  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return refusedVerify(i);
    const checked = await chainChecks(i, deadline);
    if (isNo(checked)) return refusedVerify(checked);
    // A transaction the buyer already executed is judged by its effects, and not refused for having executed.
    return { isValid: true, payer: i.sender };
  }

  async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return failed(settleReason(i.reason), "", i.message);
    const checked = await chainChecks(i, deadline);
    if (isNo(checked)) return failed(settleReason(checked.reason), "", checked.message);
    // A transaction the buyer executed was not submitted here: a failure naming it, never a success.
    if (checked.executed !== null) return failed("invalid_transaction_state", i.tx.digest, "sui/executed-by-payer");
    const signatures = [i.signature];
    try {
      const effects = await node.execute(i.tx.bytes, signatures, deadline);
      if (effects.checkpoint !== null) return landed(i, effects);
    } catch (e) {
      const entry = { event: "node-call-failed", ...about(i), call: "executeTransaction" };
      // A refused execution, or one that cannot have reached the node: nothing executed, and no transaction named.
      if (e instanceof GraphqlFault || (e instanceof NodeError && !e.sent)) return unexpected(entry, e);
      log(entry, e);
    }
    return watch(i, deadline);
  }

  /** The answer once the effects are in a checkpoint: a success only with status success and the payee's credit. */
  async function landed(i: Inspected, effects: Effects): Promise<SettleResponse> {
    if (effects.status === "SUCCESS" && credited(i, effects)) return { success: true, transaction: i.tx.digest, network: network as Network, payer: i.sender };
    log({ event: "settlement-failed", ...about(i), status: effects.status });
    return failed("invalid_transaction_state", i.tx.digest);
  }

  /** Reads the transaction every second until its effects are in a checkpoint or `deadline` passes: `settlement_pending`. */
  async function watch(i: Inspected, deadline: number): Promise<SettleResponse> {
    for (;;) {
      try {
        const { executed } = await node.transaction(i.tx.digest, deadline);
        if (executed !== null && executed.effects.checkpoint !== null) return landed(i, executed.effects);
      } catch (e) {
        if (!(e instanceof NodeError && e.code === "spent")) log({ event: "node-call-failed", ...about(i), call: "transaction" }, e);
      }
      if (performance.now() + POLL_MS > deadline) return failed("settlement_pending", i.tx.digest);
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
    caipFamily: "sui:*",
    getExtra: () => undefined,
    getSigners: () => [],
    verify,
    settle,
  };

  const module: Module = {
    descriptor: {
      name: "sui",
      key: "none",
      pairings: [ID],
      // Zero through this module is not yet established by a run on any gas path.
      acceptsZero: false,
      verifiesLanded: true,
    },
    network: network as Network,
    facilitator,
    record: {
      async instrument(p) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return { refused: i.reason, ...(i.message === undefined ? {} : { message: i.message }) };
        return {
          pairing: ID,
          // The digest is Blake2b-256 over the transaction data the buyer signed, its signatures apart: it executes once.
          instrument: { by: "transaction", network: network as Network, transaction: i.tx.digest },
          nonce: exactSui.data.nonce,
          // The lapse is an epoch, which names no time the payment alone gives: kept for the settler's life.
          keep: { until: "settler" },
        };
      },
      /** The newest checkpoint, read just before the claim: no execution of the payment can be in it or before it. */
      async position(p, at) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return undefined;
        return (await node.transaction(i.tx.digest, at.deadline)).latest.checkpoint;
      },
      async read(p, at) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const ref = await exactSui.reference(p.payload as never, p.requirements as never);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        // The search starts at the checkpoint read just before the claim, where the record holds one.
        const query = {
          act: "payment" as const,
          finality: "final" as const,
          ...(typeof at.from === "bigint" ? { after: at.from } : {}),
          ...(at.search === undefined ? {} : { search: at.search as bigint }),
        };
        return outcomeOf(await exactSui.status({ ...ref, h: i.h as never }, node.reader(at.deadline), query));
      },
    },
    fees: {
      // The buyer pays the gas, or no one does.
      paysFee: () => false,
      payerBroadcast: () => false,
    },
  };
  return module;
}

function refusedVerify(r: No): VerifyResponse {
  return { isValid: false, invalidReason: r.reason, ...(r.message === undefined ? {} : { invalidMessage: r.message }) };
}

/** A verify reason as a settle answer's: a node or store that could not be read before submission is a settle error. */
function settleReason(reason: string): string {
  return settleReasonOf(reason as InvalidReason);
}
