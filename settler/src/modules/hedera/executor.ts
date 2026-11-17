/**
 * `x402/exact/hedera/transfer-executor`: the settler's own module for x402's `transferExecutor` method of the `exact`
 * scheme on Hedera (x402's `specs/schemes/exact/scheme_exact_hedera.md`, *Executor interface*, *Executor admission*,
 * Phase 3 and Phase 4). The payer signs no Hedera transaction: it gives an executor contract and an authorization that
 * contract validates. The module admits only the executors it is given, builds
 * `executeTransfer(from = payer, asset, to = payTo, amount, authorization)` from the requirements and the payload alone,
 * simulates it through the Mirror Node from the account it submits from, at the gas limit it submits with, wraps it in
 * a `ContractExecuteTransaction` that its fee payer signs and pays for, and judges the outcome by the transaction's
 * record merged with its child records and by the contract's logs.
 *
 * The settler's configuration names no executor, so no settler started from configuration admits one: this module is
 * built by whoever gives it its executors and is not started by the Hedera module's `starter`. Its key signs and pays
 * for a transaction of its own that carries the payer's authorization (`extra.key` `relayer`).
 */
import { createHash } from "node:crypto";
import { AccountId, ContractExecuteTransaction, ContractId, Hbar, TransactionId } from "@hiero-ledger/sdk";
import { isRefusal } from "@integraledger/lcp";
import { exactHederaExecutor } from "@integraledger/lcp/hedera";
import type { PaymentRequirements as LcpOption } from "@integraledger/lcp/x402";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { isObject } from "../../answers.js";
import { sleep } from "../../http.js";
import { outcomeOf, type FeeMeter, type Instrumented, type Module, type Refused, type X402Payment } from "../../module.js";
import { mirrorOf, reasonOf, type HederaConfig } from "./index.js";
import { mirrorCall, mirrorId, mirrorReader, spelledAsSent, type Mirror } from "./mirror.js";

/** `executeTransfer(address,address,address,uint256,bytes)`, as x402's specification states its selector. */
export const EXECUTE_TRANSFER = "ea8f19fd";
/** The ERC-20 `Transfer(address,address,uint256)` event's topic. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** HIP-406's staking reward account, which pays the rewards a record lists in `staking_reward_transfers`. */
const STAKING_REWARD_ACCOUNT = "0.0.800";
/** How often `settle` asks the Mirror Node for the record while it waits. */
const RECORD_POLL_MS = 1_000;

/** The fee payer's account, and the act of its key: sign the transaction the module built, submit it, await its receipt. */
export interface ExecutorSigner {
  /** The fee-payer account, `shard.realm.num`, which the transaction id names. */
  readonly accountId: string;
  /**
   * Freezes `transaction` for the network's nodes, signs it as the fee payer, submits it and waits for its receipt;
   * answers its transaction id as the SDK writes it, whatever the receipt's status.
   */
  execute(transaction: ContractExecuteTransaction, network: Network): Promise<{ readonly transactionId: string }>;
}

/** What the module is given beside the Hedera module's configuration. */
export interface ExecutorOffering {
  /** The executor contracts the module admits, `shard.realm.num`: every other is refused. */
  readonly executors: readonly string[];
  readonly signer: ExecutorSigner;
  /** The gas limit of the call, the same in the simulation and in the transaction. */
  readonly gas: number;
  /** The transaction's maximum fee, in tinybars: what the fee count holds until the record shows the fee. */
  readonly maxFee: bigint;
  /** The fee meter of the network, which the module asks before it submits. */
  readonly meter: FeeMeter;
  /** How long `settle` waits for the record, in milliseconds. */
  readonly settleWaitMs: number;
}

interface Call {
  readonly payer: string;
  readonly executor: string;
  readonly authorization: string;
}

const ENTITY = /^(0|[1-9]\d{0,18})\.(0|[1-9]\d{0,18})\.(0|[1-9]\d{0,18})$/;

/** An entity's long-zero EVM address: shard in 4 bytes, realm and number in 8 each, as Hedera addresses a contract. */
export function longZero(entity: string): string {
  const m = ENTITY.exec(entity);
  if (m === null) throw new TypeError(`not an entity id: ${entity}`);
  const hex = (v: string, bytes: number) => BigInt(v).toString(16).padStart(bytes * 2, "0");
  return `0x${hex(m[1]!, 4)}${hex(m[2]!, 8)}${hex(m[3]!, 8)}`;
}

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

/** The call data of `executeTransfer(from, asset, to, amount, authorization)`, ABI-encoded. */
export function executeTransferData(a: { from: string; asset: string; to: string; amount: bigint; authorization: string }): string {
  const bytes = a.authorization.replace(/^0x/, "");
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return (
    EXECUTE_TRANSFER +
    word(a.from) +
    word(a.asset) +
    word(a.to) +
    word(a.amount.toString(16)) +
    word((5 * 32).toString(16)) +
    word((bytes.length / 2).toString(16)) +
    padded
  );
}

function callOf(payload: PaymentPayload): Call | undefined {
  const p = payload.payload;
  if (!isObject(p)) return undefined;
  const { payer, executor, authorization } = p;
  if (typeof payer !== "string" || typeof executor !== "string" || typeof authorization !== "string") return undefined;
  return { payer, executor, authorization };
}

const fail = (requirements: PaymentRequirements, reason: string, payer = "", transaction = ""): SettleResponse => ({
  success: false,
  errorReason: reason,
  network: requirements.network,
  transaction,
  payer,
});

/** A net change per account in one asset, `0.0.0` being HBAR. */
type Nets = Map<string, Map<string, bigint>>;

function add(nets: Nets, asset: string, account: string, amount: bigint): void {
  const m = nets.get(asset) ?? new Map<string, bigint>();
  m.set(account, (m.get(account) ?? 0n) + amount);
  nets.set(asset, m);
}

function int(v: unknown): bigint | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) ? BigInt(v) : typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : undefined;
}

/**
 * Phase 4, rule 3, over the record merged with its child records: the payee credited exactly `amount` in the asset; the
 * payer debited `amount`, the fee payer the fee, and no other account; nothing else moved but the fee's distribution
 * in HBAR; no NFT changed owner; and no log records an ERC-20 transfer out of the fee payer's address. A staking reward
 * the record lists (HIP-406) is taken out of the account it credits and out of the reward account's debit. The reason
 * of the first rule that fails, or the fee the record charged.
 */
export function judgeRecord(
  entries: readonly Record<string, unknown>[],
  logs: readonly Record<string, unknown>[],
  t: { asset: string; payTo: string; amount: bigint; payer: string; feePayer: string; feePayerEvm: string },
): { fee: bigint } | { reason: string } {
  const parent = entries.find((e) => e["nonce"] === 0 && e["scheduled"] === false);
  if (parent === undefined) return { reason: "settlement_check_failed" };
  if (parent["result"] !== "SUCCESS") return { reason: "settlement_status_not_success" };
  const fee = int(parent["charged_tx_fee"]);
  if (fee === undefined) return { reason: "settlement_check_failed" };
  const nets: Nets = new Map();
  for (const e of entries) {
    if (e !== parent && (e["scheduled"] !== false || typeof e["nonce"] !== "number" || e["nonce"] === 0)) continue;
    if (e !== parent && e["result"] !== "SUCCESS") continue;
    for (const r of Array.isArray(e["transfers"]) ? e["transfers"] : []) {
      const amount = isObject(r) ? int(r["amount"]) : undefined;
      if (amount === undefined || typeof r["account"] !== "string") return { reason: "settlement_check_failed" };
      add(nets, "0.0.0", r["account"], amount);
    }
    for (const r of Array.isArray(e["staking_reward_transfers"]) ? e["staking_reward_transfers"] : []) {
      const amount = isObject(r) ? int(r["amount"]) : undefined;
      if (amount === undefined || typeof r["account"] !== "string") return { reason: "settlement_check_failed" };
      add(nets, "0.0.0", r["account"], -amount);
      add(nets, "0.0.0", STAKING_REWARD_ACCOUNT, amount);
    }
    for (const r of Array.isArray(e["token_transfers"]) ? e["token_transfers"] : []) {
      const amount = isObject(r) ? int(r["amount"]) : undefined;
      if (amount === undefined || typeof r["account"] !== "string" || typeof r["token_id"] !== "string") {
        return { reason: "settlement_check_failed" };
      }
      add(nets, r["token_id"], r["account"], amount);
    }
    if (Array.isArray(e["nft_transfers"]) && e["nft_transfers"].length > 0) return { reason: "settlement_unexpected_transfer" };
  }
  for (const [asset, m] of nets) {
    if (asset !== "0.0.0" && asset !== t.asset && [...m.values()].some((v) => v !== 0n)) {
      return { reason: "settlement_unexpected_transfer" };
    }
  }
  const of = (asset: string, account: string) => nets.get(asset)?.get(account) ?? 0n;
  const hbar = t.asset === "0.0.0";
  if (of(t.asset, t.payTo) !== t.amount) return { reason: "settlement_payee_credit_mismatch" };
  // Debits: in HBAR the payer's amount (where HBAR is the asset) and the fee payer's fee; in a token the payer's amount.
  if (t.payer === t.feePayer && hbar) {
    if (of("0.0.0", t.payer) !== -(t.amount + fee)) return { reason: "settlement_payer_debit_mismatch" };
  } else {
    if (of(t.asset, t.payer) !== -t.amount) return { reason: "settlement_payer_debit_mismatch" };
    if (of("0.0.0", t.feePayer) !== -fee) return { reason: "settlement_fee_payer_debit_mismatch" };
  }
  for (const [asset, m] of nets) {
    for (const [account, v] of m) {
      if (v < 0n && !(account === t.payer && asset === t.asset) && !(account === t.feePayer && asset === "0.0.0")) {
        return { reason: "settlement_unexpected_debit" };
      }
    }
  }
  // Credits beside the payee's: in HBAR, the fee's distribution, which sums to the fee; in a token, none.
  const others = (asset: string) => [...(nets.get(asset) ?? new Map<string, bigint>())].filter(([a, v]) => v > 0n && !(asset === t.asset && a === t.payTo));
  if (others("0.0.0").reduce((s, [, v]) => s + v, 0n) !== fee) return { reason: "settlement_check_failed" };
  if (!hbar && others(t.asset).length > 0) return { reason: "settlement_check_failed" };
  const feePayerTopic = `0x${word(t.feePayerEvm)}`.toLowerCase();
  for (const l of logs) {
    const topics = Array.isArray(l["topics"]) ? l["topics"].map((x) => String(x).toLowerCase()) : [];
    if (topics[0] === TRANSFER_TOPIC && topics[1] === feePayerTopic) return { reason: "settlement_unexpected_transfer" };
  }
  return { fee };
}

/** The transfer-executor module on the Hedera module's network, admitting `offering.executors` alone. */
export function transferExecutorModule(c: HederaConfig, offering: ExecutorOffering): Module {
  const network = c.network as Network;
  const mirror: Mirror = mirrorOf(c);
  const feePayer = offering.signer.accountId;

  /** An account's EVM address as the Mirror Node gives it (its alias, or its long-zero form); undefined if unknown. */
  async function evmOf(account: string, deadline: number): Promise<string | undefined> {
    const a = await mirrorCall(`${mirror.base.replace(/\/+$/, "")}/api/v1/accounts/${encodeURIComponent(account)}`, deadline);
    const evm = isObject(a) ? a["evm_address"] : undefined;
    return typeof evm === "string" && /^0x[0-9a-fA-F]{40}$/.test(evm) ? evm.toLowerCase() : undefined;
  }

  /** Whether the HTS token holds a custom fee schedule, under which `exact` cannot hold. */
  async function customFees(token: string, deadline: number): Promise<boolean> {
    const a = await mirrorCall(`${mirror.base.replace(/\/+$/, "")}/api/v1/tokens/${encodeURIComponent(token)}`, deadline);
    const fees = isObject(a) ? a["custom_fees"] : undefined;
    if (!isObject(fees)) return false;
    return ["fixed_fees", "fractional_fees", "royalty_fees"].some((k) => Array.isArray(fees[k]) && fees[k].length > 0);
  }

  /** Phase 3: admission, the asset, the addresses, then the call built and simulated; the call's data where it passes. */
  async function phase3(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    deadline: number,
  ): Promise<{ invalid: string; payer: string } | { call: Call; data: string; feePayerEvm: string }> {
    const call = callOf(payload);
    if (call === undefined || requirements.extra?.["assetTransferMethod"] !== "transferExecutor") {
      return { invalid: "invalid_payload", payer: "" };
    }
    if (!offering.executors.includes(call.executor)) return { invalid: "invalid_exact_hedera_executor_not_admitted", payer: call.payer };
    if (requirements.asset !== "0.0.0" && (await customFees(requirements.asset, deadline))) {
      return { invalid: "invalid_exact_hedera_custom_fee_asset", payer: call.payer };
    }
    const [from, to, feePayerEvm] = await Promise.all([
      evmOf(call.payer, deadline),
      evmOf(requirements.payTo, deadline),
      evmOf(feePayer, deadline),
    ]);
    if (from === undefined || to === undefined || feePayerEvm === undefined) return { invalid: "address_resolution_failed", payer: call.payer };
    const asset = requirements.asset === "0.0.0" ? `0x${"0".repeat(40)}` : longZero(requirements.asset);
    const data = executeTransferData({ from, asset, to, amount: BigInt(requirements.amount), authorization: call.authorization });
    const simulated = await mirrorCall(`${mirror.base.replace(/\/+$/, "")}/api/v1/contracts/call`, deadline, {
      block: "latest",
      data: `0x${data}`,
      estimate: false,
      from: feePayerEvm,
      gas: offering.gas,
      to: longZero(call.executor),
    });
    if (!isObject(simulated) || "reverted" in simulated) return { invalid: "simulation_reverted", payer: call.payer };
    return { call, data, feePayerEvm };
  }

  const facilitator: SchemeNetworkFacilitator = {
    scheme: "exact",
    caipFamily: "hedera:*",
    getExtra: () => ({ assetTransferMethod: "transferExecutor", executors: [...offering.executors] }),
    getSigners: () => [feePayer],
    async verify(payload, requirements): Promise<VerifyResponse> {
      const v = await phase3(payload, requirements, performance.now() + offering.settleWaitMs);
      if ("invalid" in v) return { isValid: false, invalidReason: v.invalid, payer: v.payer };
      return { isValid: true, payer: v.call.payer };
    },
    async settle(payload, requirements): Promise<SettleResponse> {
      const deadline = performance.now() + offering.settleWaitMs;
      // Phase 3 again, admission among it, before anything is submitted.
      const v = await phase3(payload, requirements, deadline);
      if ("invalid" in v) return fail(requirements, v.invalid, v.payer);
      const id = TransactionId.generate(AccountId.fromString(feePayer));
      const tx = new ContractExecuteTransaction()
        .setTransactionId(id)
        .setContractId(ContractId.fromString(v.call.executor))
        .setGas(offering.gas)
        .setFunctionParameters(Buffer.from(v.data, "hex"))
        .setMaxTransactionFee(Hbar.fromTinybars(offering.maxFee.toString()));
      const named = id.toString();
      const mirrored = mirrorId(named)!;
      if (!(await offering.meter.sending({ network, transaction: mirrored, bound: offering.maxFee }))) {
        return fail(requirements, "fee_budget_spent", v.call.payer);
      }
      try {
        await offering.signer.execute(tx, network);
      } catch {
        // Whether it reached a node is not known: the transaction it would be is named, and the read decides.
        return fail(requirements, "settlement_pending", v.call.payer, named);
      }
      // Phase 4: the record with its child records, merged, and the contract's logs, nested calls' included.
      const reader = mirrorReader(mirror, deadline);
      for (;;) {
        let entries: readonly Record<string, unknown>[] | null = null;
        let logs: unknown = null;
        try {
          entries = (await reader.transactions(mirrored)) as readonly Record<string, unknown>[] | null;
          if (entries !== null) logs = await mirrorCall(`${mirror.base.replace(/\/+$/, "")}/api/v1/contracts/results/${encodeURIComponent(mirrored)}`, deadline);
        } catch {
          entries = null;
        }
        if (entries !== null && isObject(logs) && Array.isArray(logs["logs"])) {
          const judged = judgeRecord(entries, logs["logs"].filter(isObject), {
            asset: requirements.asset,
            payTo: requirements.payTo,
            amount: BigInt(requirements.amount),
            payer: v.call.payer,
            feePayer,
            feePayerEvm: v.feePayerEvm,
          });
          const fee = (entries.find((e) => e["nonce"] === 0 && e["scheduled"] === false) ?? {})["charged_tx_fee"];
          if (typeof fee === "number") offering.meter.included({ network, transaction: mirrored, fee: BigInt(fee) });
          if ("reason" in judged) return fail(requirements, judged.reason, v.call.payer, named);
          return { success: true, transaction: named, network: requirements.network, payer: v.call.payer };
        }
        if (performance.now() + RECORD_POLL_MS > deadline) return fail(requirements, "settlement_pending", v.call.payer, named);
        await sleep(RECORD_POLL_MS);
      }
    },
  };

  return {
    descriptor: { name: "hedera", key: "relayer", pairings: [exactHederaExecutor.id], acceptsZero: false },
    network,
    facilitator,
    record: {
      async instrument(p): Promise<Instrumented | Refused> {
        const ref = await exactHederaExecutor.reference(p.payload, p.requirements as LcpOption);
        if (isRefusal(ref)) return { refused: reasonOf(ref), message: ref.code };
        const call = callOf(p.payload)!;
        // x402's specification keys a payment in flight by the hash of (network, executor, payer, authorization); the
        // executor, not the transaction id, holds the authorization single-use.
        const digest = createHash("sha256")
          .update(JSON.stringify([network, call.executor, call.payer, call.authorization.toLowerCase()]))
          .digest("hex");
        return { pairing: exactHederaExecutor.id, instrument: { by: "digest", network, digest: `0x${digest}` }, nonce: exactHederaExecutor.data.nonce, keep: { until: "settler" } };
      },
      async read(p, at) {
        // The act is the transaction the module named; with none named there is nothing to read.
        if (at.transaction === undefined) return outcomeOf({ state: "pending", reason: "not-found", foreign: [] });
        const ref = await exactHederaExecutor.reference(p.payload, p.requirements as LcpOption);
        if (isRefusal(ref)) return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
        const transaction = mirrorId(at.transaction) ?? at.transaction;
        const reader = mirrorReader(mirror, at.deadline);
        const answer = spelledAsSent(await exactHederaExecutor.status({ ...ref, transaction }, reader, { act: "payment", finality: "consensus" }));
        if (answer.state !== "settled") return outcomeOf(answer);
        // lcp's read judges no amount; x402's Phase 4 does. A record that fails it consumed the authorization and paid
        // otherwise than the option: final, and failed.
        const call = callOf(p.payload)!;
        const [entries, logs, feePayerEvm] = await Promise.all([
          reader.transactions(transaction),
          mirrorCall(`${mirror.base.replace(/\/+$/, "")}/api/v1/contracts/results/${encodeURIComponent(transaction)}`, at.deadline),
          evmOf(feePayer, at.deadline),
        ]);
        const judged = judgeRecord((entries ?? []) as unknown as readonly Record<string, unknown>[], isObject(logs) && Array.isArray(logs["logs"]) ? logs["logs"].filter(isObject) : [], {
          asset: p.requirements.asset,
          payTo: p.requirements.payTo,
          amount: BigInt(p.requirements.amount),
          payer: call.payer,
          feePayer,
          feePayerEvm: feePayerEvm ?? "",
        });
        if ("reason" in judged) return outcomeOf({ state: "failed", reason: "transaction-failed", transaction: answer.transaction, foreign: [] });
        return outcomeOf(answer);
      },
    },
    fees: {
      // An own module: it asks the meter before it submits, and tells it the fee the record shows.
      paysFee: () => true,
      payerBroadcast: () => false,
    },
  };
}
