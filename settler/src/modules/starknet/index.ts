/**
 * Starknet: the settler's own facilitator for the pairing `x402/exact/starknet`, written to x402's Starknet scheme
 * (`scheme_exact_starknet.md`), which x402 specifies and publishes no code for, and to lcp's profile
 * `x402-exact-starknet.md`. The payer signs a SNIP-9 v2 outside execution of one `transfer`, its `Caller` the
 * module's executor account and its `Nonce` the low 250 bits of H (or of the agreement value); the module executes it
 * from that account, which pays the fee, one outside execution per transaction. lcp decodes the payment (`bound`,
 * `reference`) and reads it (`status`); the module adds the scheme's checks: the caller binding, the call's form, the
 * window, the account, the signature, the nonce, the balance and a simulation; then the settlement and its effect.
 */
import { canonicalJson, fromLegalContext, isRefusal, type Act, type AtrHash, type Refusal } from "@integraledger/lcp";
import {
  ANY_CALLER,
  EVENT_TRANSFER,
  exactStarknet,
  FELT_P,
  outsideExecution,
  SELECTOR_TRANSFER,
  STARKNET_MAX_SIGNATURE_FELTS,
  type Felt,
  type StarknetNetwork,
  type StarknetRef,
} from "@integraledger/lcp/starknet";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { hash, stark, transaction, typedData, type SignerInterface } from "starknet";
import { isObject, type InvalidReason, type OperatorEntry } from "../../answers.js";
import { NodeError, sleep } from "../../http.js";
import { outcomeOf, type Core, type Module, type ModuleStarter } from "../../module.js";
import { settleReason as settleReasonOf, unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import {
  BALANCE_OF,
  BALANCE_OF_CAMEL,
  felt,
  IS_VALID_NONCE,
  IS_VALID_SIGNATURE,
  RPC,
  RpcFault,
  starknetNode,
  VALID,
  type NodeEvent,
  type Simulated,
  type StarknetNode,
} from "./node.js";

/** The configuration's member `starknet`: one entry per network the settler serves. */
export interface StarknetConfig {
  readonly networks: readonly StarknetNetworkConfig[];
}

/** One Starknet network. */
export interface StarknetNetworkConfig {
  network: StarknetNetwork;
  /** A JSON-RPC node, specification 0.9 or later, that serves `starknet_traceTransaction` and `starknet_simulateTransactions`. */
  rpc: string;
  /**
   * The executor: the account the payer's outside execution names as its `Caller`, stated as `extra.feePayer`, which
   * sends and pays for the transaction that executes it; `signer` signs that transaction (a Cairo 1 account).
   */
  executor: { address: string; signer: SignerInterface };
  /** The most one settlement's resource bounds may pay, in the fee token's smallest unit (fri); none where absent. */
  maxFee?: bigint;
  /** The scheme's `skewMargin`, seconds; default 60. */
  skewMarginSeconds?: number;
  /** The scheme's `minSettleMargin`, seconds; default 30. */
  minSettleMarginSeconds?: number;
}

const ID = exactStarknet.id;
const U128 = 1n << 128n;
const POLL_MS = 1_000;
const NETWORKS: readonly string[] = ["starknet:SN_MAIN", "starknet:SN_SEPOLIA"];
/** The `l2_gas` a simulation may spend, which charges no fee: Starknet's per-transaction execution bound. */
const SIMULATION_L2_GAS = 1_000_000_000n;

/** A refusal: x402's reason, and the code naming the check where there is one. */
interface No {
  readonly reason: string;
  readonly message?: string;
}
const no = (reason: string, message?: string): No => (message === undefined ? { reason } : { reason, message });
const isNo = (v: unknown): v is No => isObject(v) && typeof v["reason"] === "string" && Object.keys(v).every((k) => k === "reason" || k === "message");

/** A payment that passed every check that reads neither the chain nor the clock. */
interface Inspected {
  readonly network: StarknetNetwork;
  readonly act: Act;
  readonly h: AtrHash;
  readonly ref: StarknetRef;
  readonly from: Felt;
  readonly payTo: Felt;
  readonly asset: Felt;
  readonly amount: bigint;
  readonly nonce: Felt;
  readonly executeAfter: bigint;
  readonly executeBefore: bigint;
  readonly signature: readonly Felt[];
  readonly maxTimeoutSeconds: number;
}

/** lcp's refusals of the option's form: the requirements' fault where the payment echoes them unchanged. */
const OPTION_CODES = new Set([
  "x402/option-not-this-pairing",
  "x402/option-malformed",
  "starknet/network-malformed",
  "starknet/option-malformed",
  "starknet/caller-forbidden",
]);

/** The x402 reason for lcp's refusal of the payment, with lcp's code as the message. */
function refusedBy(r: Refusal, payload: PaymentPayload, requirements: PaymentRequirements): No {
  const echoed = canonicalJson(payload.accepted as never) === canonicalJson(requirements as never);
  if (r.code === "starknet/caller-not-fee-payer") return no("invalid_exact_starknet_payload_caller", r.code);
  if (echoed && OPTION_CODES.has(r.code)) return no("invalid_payment_requirements", r.code);
  if (echoed && r.code === "starknet/felt-malformed" && ![requirements.asset, requirements.payTo, requirements.extra?.["feePayer"]].every((v) => felt(v) !== undefined)) {
    return no("invalid_payment_requirements", r.code);
  }
  return no("invalid_payload", r.code);
}

/** The members x402's Starknet scheme admits in the signed typed data's `domain`, `message` and each call. */
const DOMAIN_KEYS = new Set(["name", "version", "chainId", "revision"]);
const MESSAGE_KEYS = ["Caller", "Nonce", "Execute After", "Execute Before", "Calls"];
const CALL_KEYS = ["To", "Selector", "Calldata"];

function onlyKeys(o: unknown, keys: readonly string[], all: boolean): boolean {
  if (!isObject(o)) return false;
  const have = Object.keys(o);
  return have.every((k) => keys.includes(k)) && (!all || keys.every((k) => have.includes(k)));
}

/** A `Transfer` event by its layout: keyed (`[selector, from, to]`, `[low, high]`) or unkeyed (`[selector]`, `[from, to, low, high]`). */
function transferOf(e: NodeEvent): { from: bigint; to: bigint; amount: bigint } | "neither" | undefined {
  if (e.keys.length === 0 || BigInt(e.keys[0]!) !== BigInt(EVENT_TRANSFER)) return undefined;
  const words = e.keys.length === 3 && e.data.length === 2 ? [...e.keys.slice(1), ...e.data] : e.keys.length === 1 && e.data.length === 4 ? e.data : undefined;
  if (words === undefined) return "neither";
  const [from, to, low, high] = words.map((w) => BigInt(w));
  if (low! >= U128 || high! >= U128) return "neither";
  return { from: from!, to: to!, amount: low! + high! * U128 };
}

/**
 * The scheme's effect check (its rule 8, and its check of the settlement's receipt): exactly one `Transfer` emitted by the asset whose sender is
 * the payer, to `payTo` for the amount. An asset event with the `Transfer` key of neither layout fails it.
 */
function oneTransfer(events: readonly NodeEvent[], i: Inspected): boolean {
  const asset = BigInt(i.asset);
  const payer = BigInt(i.from);
  const fromPayer: { to: bigint; amount: bigint }[] = [];
  for (const e of events) {
    if (BigInt(e.from) !== asset) continue;
    const t = transferOf(e);
    if (t === undefined) continue;
    if (t === "neither") return false;
    if (t.from === payer) fromPayer.push(t);
  }
  return fromPayer.length === 1 && fromPayer[0]!.to === BigInt(i.payTo) && fromPayer[0]!.amount === i.amount;
}

/** One module for the configured network, for the scheme `exact`. */
/** Starts one module per configured network, each its own registration of `exact`. */
export const starter: ModuleStarter<StarknetConfig> = {
  name: "starknet",
  async start(config, core) {
    return { registrations: config.networks.map((c) => ({ network: c.network as Network, module: starknetModule(c, core), own: [] })) };
  },
};

/**
 * The module for one network. The settler's wait for the chain is the core's; the fee meter is the network's, which the
 * module tells of each transaction's bound before it sends it and its fee once included.
 */
export function starknetModule(c: StarknetNetworkConfig, core: Core): Module {
  if (!NETWORKS.includes(c.network)) throw new TypeError(`not a Starknet network: ${c.network}`);
  const executor = felt(c.executor.address);
  if (executor === undefined || BigInt(executor) === 0n || BigInt(executor) >= FELT_P || executor === ANY_CALLER) {
    throw new TypeError("the executor's address is not an account address");
  }
  const network = c.network;
  const node: StarknetNode = starknetNode(network, c.rpc.replace(/\/+$/, ""));
  const { log, settleWaitMs } = core;
  const meter = core.meter(network as Network);
  const skew = BigInt(c.skewMarginSeconds ?? 60);
  const minSettle = BigInt(c.minSettleMarginSeconds ?? 30);
  const chainId = `0x${Buffer.from(network.slice("starknet:".length), "ascii").toString("hex")}`;
  /** The executor's transactions are sent one at a time, each with the next nonce. */
  let sending: Promise<unknown> = Promise.resolve();

  const about = (i: Inspected) => ({ network, payer: i.from });

  /** Every check of the payment that reads neither the chain nor the clock (the scheme's rules 1, 2, 4 and 7). */
  async function inspect(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Inspected | No> {
    if (!isObject(payload) || !isObject(requirements) || !isObject(payload.payload)) return no("invalid_payload");
    if (requirements.network !== network) return no("invalid_network");
    if (requirements.scheme !== "exact") return no("unsupported_scheme");
    // H, and the act: a payment's nonce is H's low 250 bits, an agreement's its agreement value's (the profile, rule 4).
    let act: Act = "payment";
    let h = await exactStarknet.bound(payload as never);
    if (isRefusal(h) && h.code === "starknet/nonce-not-bound") {
      const echoed = isObject(payload.extensions) ? payload.extensions["legalContext"] : undefined;
      const lc = fromLegalContext({ legalContext: isObject(echoed) ? echoed["info"] : undefined } as never);
      if (lc !== null) {
        const agreed = await exactStarknet.bound(payload as never, { act: "agreement", h: lc.h });
        if (!isRefusal(agreed)) {
          act = "agreement";
          h = agreed;
        }
      }
    }
    if (isRefusal(h)) return refusedBy(h, payload, requirements);
    const ref = await exactStarknet.reference(payload as never, requirements as never, { act, h });
    if (isRefusal(ref)) return refusedBy(ref, payload, requirements);
    // A feePayer the module cannot settle through would give an authorization only another party could execute.
    if (felt(requirements.extra["feePayer"]) !== executor) return no("invalid_payment_requirements", "starknet/fee-payer-not-executor");
    if (BigInt(requirements.maxTimeoutSeconds) <= minSettle) return no("invalid_payment_requirements", "starknet/timeout-below-settle-margin");
    const oe = (payload.payload as Record<string, unknown>)["outsideExecution"] as Record<string, unknown>;
    const td = oe["typedData"] as Record<string, unknown>;
    if (!onlyKeys(td["domain"], [...DOMAIN_KEYS], true) || !onlyKeys(td["message"], MESSAGE_KEYS, true)) {
      return no("invalid_payload", "starknet/typed-data-keys");
    }
    const calls = (td["message"] as Record<string, unknown>)["Calls"] as unknown[];
    if (!calls.every((k) => onlyKeys(k, CALL_KEYS, true))) return no("invalid_payload", "starknet/typed-data-keys");
    const signature = oe["signature"];
    if (!Array.isArray(signature) || signature.length < 1 || signature.length > STARKNET_MAX_SIGNATURE_FELTS) {
      return no("invalid_payload", "starknet/signature-malformed");
    }
    const sig = signature.map(felt);
    if (sig.some((s) => s === undefined || BigInt(s) >= FELT_P)) return no("invalid_payload", "starknet/signature-malformed");
    const p = ref.presented;
    if (p.calls.length !== 1) return no("invalid_payload", "starknet/not-one-call");
    const call = p.calls[0]!;
    if (BigInt(call.to) !== BigInt(ref.asset)) return no("invalid_exact_starknet_payload_asset_mismatch");
    if (BigInt(call.selector) !== BigInt(SELECTOR_TRANSFER) || call.calldata.length !== 3) return no("invalid_payload", "starknet/call-malformed");
    const [to, low, high] = call.calldata.map((x) => BigInt(x));
    if (low! >= U128 || high! >= U128) return no("invalid_payload", "starknet/call-malformed");
    if (to !== BigInt(requirements.payTo)) return no("invalid_exact_starknet_payload_recipient_mismatch");
    if (low! + high! * U128 !== BigInt(requirements.amount)) return no("invalid_exact_starknet_payload_amount_mismatch");
    if (BigInt(ref.from) === BigInt(executor!)) return no("invalid_payment_requirements", "starknet/payer-is-fee-payer");
    // An outside execution the payee's account signed is no payment and no agreement (the profile, rule 5).
    if (BigInt(ref.from) === BigInt(requirements.payTo)) return no("invalid_payload", "starknet/payee-signed");
    return {
      network,
      act,
      h,
      ref,
      from: ref.from,
      payTo: felt(requirements.payTo)!,
      asset: ref.asset,
      amount: BigInt(requirements.amount),
      nonce: ref.nonce,
      executeAfter: BigInt(p.executeAfter),
      executeBefore: BigInt(p.executeBefore),
      signature: sig as Felt[],
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    };
  }

  /** The scheme's window (its *Timeout Mapping*): at `/verify` the freshness band and the floor; at settlement the floor and the upper bound. */
  function windowRefusal(i: Inspected, phase: "verify" | "settle"): No | undefined {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const timeout = BigInt(i.maxTimeoutSeconds);
    if (phase === "verify" && i.executeAfter >= now - skew) return no("invalid_payload", "starknet/execute-after-not-past");
    if (phase === "verify" && i.executeBefore < now + timeout - skew) return no("outside_execution_expired");
    if (i.executeBefore > now + timeout + skew) return no("outside_execution_window_exceeds_max_timeout");
    if (i.executeBefore <= now + minSettle) return no("outside_execution_expired");
    return undefined;
  }

  /** The SNIP-12 hash of the typed data rebuilt from the signed values (the scheme's rule 2), never of the typed data received. */
  function messageHash(i: Inspected): string {
    const td = outsideExecution({
      network,
      feePayer: i.ref.presented.caller,
      asset: i.asset,
      payTo: i.payTo,
      amount: i.amount,
      executeBefore: Number(i.executeBefore),
      nonce: i.nonce,
    });
    if (isRefusal(td)) throw new Error(`lcp refused the canonical typed data: ${td.code}`);
    const message = { ...td.message, "Execute After": i.executeAfter.toString() };
    return typedData.getMessageHash({ ...td, message } as never, i.from);
  }

  /** The executor's call of `execute_from_outside_v2` on the payer's account, the outside execution as presented. */
  function executeCall(i: Inspected) {
    const p = i.ref.presented;
    const call = p.calls[0]!;
    const calldata: Felt[] = [p.caller, p.nonce, p.executeAfter, p.executeBefore, "0x1", call.to, call.selector, `0x${call.calldata.length.toString(16)}`, ...call.calldata, `0x${i.signature.length.toString(16)}`, ...i.signature];
    return { contractAddress: i.from, entrypoint: "execute_from_outside_v2", calldata };
  }

  type Bounds = { l1_gas: Resource; l2_gas: Resource; l1_data_gas: Resource };
  type Resource = { max_amount: bigint; max_price_per_unit: bigint };
  const hex = (v: bigint): Felt => `0x${v.toString(16)}`;
  const rpcBounds = (b: Bounds) =>
    Object.fromEntries(Object.entries(b).map(([k, r]) => [k, { max_amount: hex(r.max_amount), max_price_per_unit: hex(r.max_price_per_unit) }]));

  /** The transaction the executor sends, unsigned: its calldata, its nonce and its resource bounds. */
  function invokeOf(i: Inspected, nonce: bigint, bounds: Bounds, signature: readonly string[]) {
    return {
      type: "INVOKE",
      version: "0x3",
      sender_address: executor,
      calldata: transaction.getExecuteCalldata([executeCall(i)], "1").map((x) => hex(BigInt(x))),
      signature,
      nonce: hex(nonce),
      resource_bounds: rpcBounds(bounds),
      tip: "0x0",
      paymaster_data: [],
      account_deployment_data: [],
      nonce_data_availability_mode: "L1",
      fee_data_availability_mode: "L1",
    };
  }

  /** The resource bounds a simulated fee gives: half again each amount and each price, as starknet.js's default overhead. */
  function boundsOf(f: Simulated["fee"]): Bounds {
    const up = (v: bigint) => v + v / 2n;
    return {
      l1_gas: { max_amount: up(f.l1Gas), max_price_per_unit: up(f.l1GasPrice) },
      l2_gas: { max_amount: up(f.l2Gas), max_price_per_unit: up(f.l2GasPrice) },
      l1_data_gas: { max_amount: up(f.l1DataGas), max_price_per_unit: up(f.l1DataGasPrice) },
    };
  }
  const feeBound = (b: Bounds) => Object.values(b).reduce((sum, r) => sum + r.max_amount * r.max_price_per_unit, 0n);

  /**
   * The checks that read the chain, in the scheme's order: the account deployed, its signature, the nonce unused, the
   * balance, and a simulation of the settlement showing the one `Transfer`. A node that could not answer is no
   * verdict: `unexpected_verify_error`, once its entry is in the operator log.
   */
  async function chainChecks(i: Inspected, deadline: number): Promise<Simulated | No> {
    const failedRead = (call: string, e: unknown): No => no(unexpectedVerify(log, { event: "node-call-failed", ...about(i), call }, e));
    try {
      await node.classHashAt(i.from, deadline);
    } catch (e) {
      if (e instanceof RpcFault && e.code === RPC.CONTRACT_NOT_FOUND) return no("account_not_deployed");
      return failedRead("starknet_getClassHashAt", e);
    }
    try {
      const out = await node.call(i.from, IS_VALID_SIGNATURE, [felt(messageHash(i))!, hex(BigInt(i.signature.length)), ...i.signature], "latest", deadline);
      if (out.length !== 1 || out[0] !== VALID) return no("invalid_exact_starknet_payload_signature");
    } catch (e) {
      if (e instanceof RpcFault) return no("invalid_exact_starknet_payload_signature", `starknet/rpc-${e.code}`);
      return failedRead("is_valid_signature", e);
    }
    try {
      const out = await node.call(i.from, IS_VALID_NONCE, [i.nonce], "latest", deadline);
      if (out.length !== 1 || out[0] !== "0x1") return no("nonce_already_used");
    } catch (e) {
      if (e instanceof RpcFault) return no("nonce_already_used", `starknet/rpc-${e.code}`);
      return failedRead("is_valid_outside_execution_nonce", e);
    }
    let balance: Felt[] | undefined;
    for (const entry of [BALANCE_OF, BALANCE_OF_CAMEL]) {
      try {
        balance = await node.call(i.asset, entry, [i.from], "latest", deadline);
        break;
      } catch (e) {
        if (!(e instanceof RpcFault)) return failedRead("balance_of", e);
      }
    }
    if (balance === undefined) return no("invalid_payment_requirements", "starknet/no-balance-getter");
    if (balance.length !== 2 || BigInt(balance[0]!) >= U128 || BigInt(balance[1]!) >= U128) return failedRead("balance_of", new NodeError("malformed", true, "balance"));
    if (BigInt(balance[0]!) + BigInt(balance[1]!) * U128 < i.amount) return no("insufficient_funds");
    let simulated: Simulated;
    try {
      const nonce = await node.nonce(executor!, "latest", deadline);
      const free: Bounds = {
        l1_gas: { max_amount: 0n, max_price_per_unit: 0n },
        l2_gas: { max_amount: SIMULATION_L2_GAS, max_price_per_unit: 0n },
        l1_data_gas: { max_amount: 0n, max_price_per_unit: 0n },
      };
      simulated = await node.simulate(invokeOf(i, nonce, free, []), deadline);
    } catch (e) {
      if (e instanceof RpcFault && e.code === RPC.TRANSACTION_EXECUTION_ERROR) return no("simulation_failed");
      return failedRead("starknet_simulateTransactions", e);
    }
    if (simulated.reverted || !oneTransfer(simulated.events, i)) return no("simulation_failed");
    return simulated;
  }

  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return refusedVerify(i);
    const w = windowRefusal(i, "verify");
    if (w !== undefined) return refusedVerify(w);
    const checked = await chainChecks(i, deadline);
    if (isNo(checked)) return refusedVerify(checked);
    return { isValid: true, payer: i.from };
  }

  async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const deadline = performance.now() + settleWaitMs;
    const i = await inspect(payload, requirements);
    if (isNo(i)) return failed(settleReason(i.reason), "", i.message);
    const w = windowRefusal(i, "settle");
    if (w !== undefined) return failed(w.reason, "", w.message);
    const simulated = await chainChecks(i, deadline);
    if (isNo(simulated)) return failed(settleReason(simulated.reason), "", simulated.message);
    const bounds = boundsOf(simulated.fee);
    const bound = feeBound(bounds);
    if (c.maxFee !== undefined && bound > c.maxFee) {
      log({ event: "fee-over-bound", ...about(i), bound: bound.toString() });
      return failed("invalid_transaction", "", "starknet/fee-over-bound");
    }
    const run = sending.then(() => send(i, bounds, bound, deadline));
    sending = run.catch(() => undefined);
    const out = await run;
    if ("answer" in out) return out.answer;
    return watch(i, out.transaction, deadline);
  }

  /**
   * Signs and sends the executor's transaction with the executor's next nonce, after the fee meter allows it. A request
   * that cannot have reached the node sends nothing: `unexpected_settle_error` with no transaction, as does a node that
   * refuses it. One that may have reached it is read for its receipt.
   */
  async function send(i: Inspected, bounds: Bounds, bound: bigint, deadline: number): Promise<{ transaction: Felt } | { answer: SettleResponse }> {
    let nonce: bigint;
    try {
      nonce = await node.nonce(executor!, "pre_confirmed", deadline);
    } catch (e) {
      return { answer: unexpected({ event: "node-call-failed", ...about(i), call: "starknet_getNonce" }, e) };
    }
    const call = executeCall(i);
    const details = {
      walletAddress: executor!,
      cairoVersion: "1" as const,
      chainId: chainId as never,
      nonce,
      version: "0x3" as const,
      resourceBounds: bounds,
      tip: 0n,
      paymasterData: [],
      accountDeploymentData: [],
      nonceDataAvailabilityMode: "L1" as const,
      feeDataAvailabilityMode: "L1" as const,
    };
    const txHash = felt(
      hash.calculateInvokeTransactionHash({
        senderAddress: executor!,
        version: "0x3",
        compiledCalldata: transaction.getExecuteCalldata([call], "1"),
        chainId: chainId as never,
        nonce,
        accountDeploymentData: [],
        nonceDataAvailabilityMode: 0,
        feeDataAvailabilityMode: 0,
        resourceBounds: bounds,
        tip: 0n,
        paymasterData: [],
      }),
    )!;
    if (!(await meter.sending({ network: network as Network, transaction: txHash, bound }))) {
      return { answer: failed("fee_budget_spent", "") };
    }
    let signature: string[];
    try {
      signature = stark.signatureToHexArray(await c.executor.signer.signTransaction([call], details as never));
    } catch (e) {
      return { answer: unexpected({ event: "executor-sign-failed", ...about(i) }, e) };
    }
    try {
      const got = await node.add(invokeOf(i, nonce, bounds, signature), deadline);
      if (BigInt(got) !== BigInt(txHash)) log({ event: "transaction-hash-differs", ...about(i), transaction: got, computed: txHash });
    } catch (e) {
      const entry = { event: "node-call-failed", ...about(i), call: "starknet_addInvokeTransaction", transaction: txHash };
      if (e instanceof RpcFault || (e instanceof NodeError && !e.sent)) return { answer: unexpected(entry, e) };
      log(entry, e);
    }
    return { transaction: txHash };
  }

  /**
   * Reads the transaction's receipt every second until `deadline`: once it is in an accepted block, its fee goes to the
   * meter, and it succeeded only with execution `SUCCEEDED` and exactly the expected `Transfer`; a `REVERTED` one, or
   * one without that transfer, is `invalid_transaction_state` naming it. Not yet shown: `settlement_pending`.
   */
  async function watch(i: Inspected, tx: Felt, deadline: number): Promise<SettleResponse> {
    for (;;) {
      let r: Awaited<ReturnType<StarknetNode["receipt"]>> = null;
      try {
        r = await node.receipt(tx, deadline);
      } catch (e) {
        if (!(e instanceof NodeError && e.code === "spent")) log({ event: "node-call-failed", ...about(i), call: "starknet_getTransactionReceipt", transaction: tx }, e);
      }
      if (r !== null && r.finality !== "PRE_CONFIRMED" && r.blockNumber !== null) {
        meter.included({ network: network as Network, transaction: tx, fee: r.fee });
        const events = r.events.map((e) => ({ from: e.fromAddress, keys: [...e.keys], data: [...e.data] }));
        if (r.execution === "SUCCEEDED" && oneTransfer(events, i)) return { success: true, transaction: tx, network, payer: i.from };
        log({ event: "settlement-failed", ...about(i), transaction: tx, execution: r.execution });
        return failed("invalid_transaction_state", tx);
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
    return { success: false, errorReason, ...(errorMessage === undefined ? {} : { errorMessage }), transaction: tx, network };
  }

  const facilitator: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: "starknet:*",
    // x402's Starknet scheme: the kind states the address the payer names as `Caller`, and `signers` the account that
    // signs the settlement transaction, here the same executor.
    getExtra: () => ({ feePayer: executor }),
    getSigners: () => [executor!],
    verify,
    settle,
  };

  return {
    descriptor: {
      name: "starknet",
      key: "relayer",
      pairings: [ID],
      // lcp's option filter refuses an amount of "0" on every token (the profile's rule 24).
      acceptsZero: false,
    },
    network: network as Network,
    facilitator,
    record: {
      async instrument(p) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return i.message === undefined ? { refused: i.reason } : { refused: i.reason, message: i.message };
        return {
          pairing: ID,
          // The account keys a used nonce by its value alone: the payer and the signed nonce (an agreement's is its own
          // value's low bits, so one payer's agreement and payment under one H are two instruments).
          instrument: { by: "single-use", network: network as Network, signer: i.from, value: i.nonce },
          nonce: exactStarknet.data.nonce,
          keep: { until: "lapse", at: Number(i.executeBefore) * 1000 },
        };
      },
      /** The newest block, read just before the claim: no settlement of the payment can land at or before it. */
      async position(_p, at) {
        return (await node.head("ACCEPTED_ON_L2", at.deadline)).number;
      },
      async read(p, at) {
        const i = await inspect(p.payload, p.requirements);
        if (isNo(i)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        // The transaction the module's settle named is read first; the search starts at the block before the claim.
        const named = felt(at.transaction);
        const ref = { ...i.ref, h: i.h, ...(named === undefined ? {} : { transaction: named }) };
        const query = {
          act: i.act,
          finality: "ACCEPTED_ON_L1" as const,
          ...(typeof at.from === "bigint" ? { after: at.from } : {}),
          ...(at.search === undefined ? {} : { search: at.search as never }),
        };
        return outcomeOf(await exactStarknet.status(ref, node.reader(at.deadline), query));
      },
    },
    fees: {
      // The executor sends and pays for every settlement; the payer never broadcasts it, its `Caller` being the executor.
      paysFee: () => true,
      payerBroadcast: () => false,
    },
  };
}

function refusedVerify(r: No): VerifyResponse {
  return { isValid: false, invalidReason: r.reason, ...(r.message === undefined ? {} : { invalidMessage: r.message }) };
}

/** A verify reason as a settle answer's: a node or store that could not be read before submission is a settle error. */
function settleReason(reason: string): string {
  return settleReasonOf(reason as InvalidReason);
}
