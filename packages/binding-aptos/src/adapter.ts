/**
 * The Aptos `lcp_payment` overlay-contract adapter — thin I/O with `@aptos-labs/ts-sdk` isolated here
 * It intentionally does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped
 * (`SettlementRef.txHash` is a `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and Aptos speaks
 * transaction hashes + a fullnode `getTransactionByHash` returning Move events. Rather than lie through
 * those types, this exposes an Aptos-native surface (a hash-keyed `AptosSettlementRef`, an `AptosReader`
 * port) alongside the shared, chain-agnostic `BindingManifest`. Unifying the port shape across EVM and
 * non-EVM rails is future work; forcing it here would misrepresent the rail.
 *
 * `propose` builds the `settle_payment<Coin>` Move-call arguments the buyer signs (the `payment_id` carrying
 * the atrHash); `recover` reads the atrHash back from a settled transaction's `PaymentSettled` event;
 * `observe` reports the settled transition; `enumerate` is the best-effort candidate-set check the manifest
 * declares (`forwardIndexable: false`).
 *
 * ★ THE SUCCESS GATE IS IN THE PURE PATH, NOT THE SDK MAPPER. `AptosReader` is a public, injectable port,
 * so any implementation other than `makeAptosReader` reaches `recover`/`observe`/`enumerate` directly — a
 * gate that only ran inside `parseSettleViews` would not bind them, and a failed transaction (which the
 * fullnode still returns, with its events) would recover a weld. `AptosTxView` therefore carries the RAW
 * `success`/`vmStatus` and `recoverAtrHashFromTxView` is fail-closed on both, matching binding-solana,
 * binding-xrpl and binding-hedera.
 */

import {
  type Aptos,
  AptosApiError,
  type Event,
  type TransactionResponse,
} from "@aptos-labs/ts-sdk";
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import {
  type AptosNetwork,
  getAptosConfig,
  paymentSettledEventType,
  settlePaymentFunction,
} from "./constants.js";
import { encodePaymentIdArg, readPaymentId } from "./payment-id.js";

/** An Aptos settlement reference — a transaction hash. */
export interface AptosSettlementRef {
  hash: string;
}

/** The Move-call arguments a buyer signs to settle a payment binding `atrHash` as `payment_id`. */
export interface SettlePaymentCall {
  /** `<lcpModuleAddress>::payment::settle_payment` — the fully-qualified entry function. */
  function: `${string}::payment::settle_payment`;
  /** The `Coin<T>` type argument (e.g. `0x1::aptos_coin::AptosCoin`). */
  typeArguments: [string];
  /** `[recipient, amount, payment_id]` — `payment_id` is the 32 atrHash bytes as a `number[]`. */
  functionArguments: [string, bigint, number[]];
}

/**
 * The minimal, decoded view of one settlement this binding cares about — the `PaymentSettled` event the
 * `lcp_payment` module emits.
 */
export interface AptosSettleView {
  /** The event type string (`<moduleAddr>::payment::PaymentSettled`). */
  eventType: string;
  /** The `payment_id` field — a 0x-hex string (fullnode form) or the raw 32 bytes. */
  paymentId: Uint8Array | string;
}

/** Normalize an Aptos Move-type string for comparison (strip leading `0x0…` padding, lowercase). */
export function normalizeAptosType(t: string): string {
  return t.toLowerCase().replace(/^0x0+/, "0x");
}

/** Build the `settle_payment<Coin>` Move call binding `atrHash`. Throws on a malformed atrHash (fail-fast). */
export function buildSettlePaymentCall(inputs: {
  atrHash: string;
  lcpModuleAddress: string;
  coinType: string;
  recipient: string;
  amount: bigint;
}): SettlePaymentCall {
  return {
    function: settlePaymentFunction(inputs.lcpModuleAddress),
    typeArguments: [inputs.coinType],
    functionArguments: [
      inputs.recipient,
      inputs.amount,
      encodePaymentIdArg(inputs.atrHash),
    ],
  };
}

/**
 * Recover the atrHash from a set of settlement views (the first `PaymentSettled` event whose `payment_id`
 * decodes wins). Pure — `moduleAddress` pins WHICH module's event we honor (an overlay binding is scoped to
 * a specific deployed module, never any `::payment::PaymentSettled`).
 */
export function recoverAtrHashFromSettleViews(
  views: AptosSettleView[],
  moduleAddress: string,
): `0x${string}` | null {
  const want = normalizeAptosType(paymentSettledEventType(moduleAddress));
  for (const v of views) {
    if (normalizeAptosType(v.eventType) !== want) continue;
    const atr = readPaymentId(v.paymentId);
    if (atr !== null) return atr;
  }
  return null;
}

/**
 * The minimal view of one transaction this binding cares about: its settle-event views plus the RAW
 * outcome fields the fullnode reports. `success` and `vmStatus` mirror `TransactionResponse.success` /
 * `.vm_status`; a failed or pending transaction is not a settlement, and an ABSENT field means the reader
 * saw no outcome at all, which is not evidence of success either. The gate lives in the pure
 * `recoverAtrHashFromTxView` — NOT in the SDK mapper — because `AptosReader` is a public, injectable port
 * (mirrors binding-solana's `SolanaTxView.err` and binding-xrpl's validated/engineResult view).
 */
export interface AptosTxView {
  events: AptosSettleView[];
  /** The fullnode's `success` flag. Only `true` is executed; absent is not evidence of success. */
  success?: boolean;
  /** The fullnode's `vm_status`. Only `"Executed successfully"` is executed; absent is not success. */
  vmStatus?: string;
}

/**
 * Map an SDK `TransactionResponse` into settlement event views (the SDK→pure boundary). Carries data
 * only — it does NOT decide whether the transaction settled; `recoverAtrHashFromTxView` does that.
 */
export function parseSettleViews(tx: TransactionResponse): AptosSettleView[] {
  if (!("events" in tx)) return [];
  const out: AptosSettleView[] = [];
  for (const ev of tx.events as Event[]) {
    const paymentId = (ev.data as { payment_id?: unknown }).payment_id;
    if (typeof paymentId === "string" || paymentId instanceof Uint8Array)
      out.push({ eventType: ev.type, paymentId });
  }
  return out;
}

/** Map an SDK `TransactionResponse` into its tx view — settle events plus the raw outcome fields. */
export function parseTxView(tx: TransactionResponse): AptosTxView {
  return {
    events: parseSettleViews(tx),
    // Spread conditionally: an absent field must stay absent (exactOptionalPropertyTypes), so a pending
    // transaction cannot be read as carrying `success: undefined`-as-a-value.
    ...("success" in tx ? { success: tx.success } : {}),
    ...("vm_status" in tx ? { vmStatus: tx.vm_status } : {}),
  };
}

/**
 * Recover the atrHash from a transaction view, or `null` if it is not an executed transaction carrying
 * this module's `PaymentSettled` event. Pure. Fail-closed on BOTH outcome facts: a transaction that is not
 * `success === true` AND `vm_status === "Executed successfully"` moved no funds, and a view missing either
 * field gave no evidence of success at all.
 */
export function recoverAtrHashFromTxView(
  view: AptosTxView | null,
  moduleAddress: string,
): `0x${string}` | null {
  if (view === null) return null;
  if (view.success !== true) return null;
  if (view.vmStatus !== "Executed successfully") return null;
  return recoverAtrHashFromSettleViews(view.events, moduleAddress);
}

/** Reads settled transactions from an Aptos fullnode — wraps an `@aptos-labs/ts-sdk` `Aptos` client. */
export interface AptosReader {
  /** Fetch one transaction's view by hash, or `null` if the fullnode has no such transaction. */
  txView(hash: string): Promise<AptosTxView | null>;
}

/** Wrap an `@aptos-labs/ts-sdk` `Aptos` client as an {@link AptosReader} — the one place a chain SDK
 *  reaches this package's public surface. `@aptos-labs/ts-sdk` is a direct dependency, so installing this
 *  package installs it; you still construct the client, because the fullnode endpoint is a deployment
 *  choice. Read-only: nothing here submits a transaction. */
export function makeAptosReader(aptos: Aptos): AptosReader {
  return {
    async txView(hash: string): Promise<AptosTxView | null> {
      try {
        const tx = await aptos.getTransactionByHash({ transactionHash: hash });
        return parseTxView(tx);
      } catch (err) {
        // The port promises `null` for a transaction the fullnode does not have, and the SDK expresses
        // that as a THROW: `getTransactionByHash` raises `AptosApiError` with status 404. Left
        // unhandled, `recover` threw where the surface returns a Refusal, so a caller auditing a hash
        // the node has never seen got an exception instead of an answer. A hash nobody has heard of is
        // an answer.
        //
        // ⛔ ONLY 404. A 429, a 500 or a dropped connection is "we could not look", which is a different
        // fact from "there is no such transaction" — reporting the first as the second would let an
        // outage read as a settlement that never happened, which is the same collapse the acceptance
        // verifier keeps apart between an unreachable node and a forged signature.
        if (err instanceof AptosApiError && err.status === 404) return null;
        throw err;
      }
    },
  };
}

/** The Aptos rail's surface — an OVERLAY binding, which is what shapes it. `propose` returns a Move entry
 *  call for the caller to sign and submit, and it targets a `lcp_payment` module someone deployed, so a
 *  settlement is only recoverable by a reader pointed at the SAME deployment. `enumerate` takes the
 *  candidate hashes from you: Aptos does not forward-index `payment_id`. */
export interface AptosAdapter {
  manifest: BindingManifest;
  /** Network config (fullnode/coin/module) this adapter binds against. */
  network: AptosNetwork;
  /** The `settle_payment<Coin>` Move call the buyer signs to bind `atrHash` (recipient + amount supplied). */
  propose(inputs: {
    atrHash: string;
    recipient: string;
    amount: bigint;
    coinType?: string;
  }): SettlePaymentCall;
  /** Recover the atrHash from a settled transaction, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: AptosSettlementRef,
    reader: AptosReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the tx executed and carries a valid `PaymentSettled` payment_id). */
  observe(
    ref: AptosSettlementRef,
    reader: AptosReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /**
   * Best-effort scan for the settlements bearing `atrHash` among a caller-supplied set of candidate
   * transaction hashes (NOT a native index — Aptos does not forward-index `payment_id`; see the manifest).
   */
  enumerate(
    atrHash: string,
    hashes: string[],
    reader: AptosReader,
  ): Promise<AptosSettlementRef[]>;
}

/** Construct the Aptos adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `APTOS_MANIFEST`; a manifest whose `rail` is not `"aptos"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. `network` is taken here rather than per
 *  call because it selects the module address every proposal targets. This is the package's entry point. */
export function createAptosAdapter(
  manifest: BindingManifest,
  network: AptosNetwork,
): AptosAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "aptos")
    throw new Error(
      `createAptosAdapter: manifest.rail "${manifest.rail}" is not "aptos"`,
    );
  const cfg = getAptosConfig(network);
  const moduleAddress = cfg.lcpModuleAddress;

  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  async function doRecover(
    ref: AptosSettlementRef,
    reader: AptosReader,
  ): Promise<Outcome<`0x${string}`>> {
    const atr = recoverAtrHashFromTxView(
      await reader.txView(ref.hash),
      moduleAddress,
    );
    if (atr === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "aptos/no-settle-payment-id",
        detail: `no executed transaction carrying a ${moduleAddress}::payment::PaymentSettled atrHash for ${ref.hash}`,
      };
    return { ok: true, value: atr };
  }

  return {
    manifest,
    network,

    propose(inputs: {
      atrHash: string;
      recipient: string;
      amount: bigint;
      coinType?: string;
    }): SettlePaymentCall {
      return buildSettlePaymentCall({
        atrHash: inputs.atrHash,
        lcpModuleAddress: moduleAddress,
        coinType: inputs.coinType ?? cfg.settlementCoin,
        recipient: inputs.recipient,
        amount: inputs.amount,
      });
    },

    recover(
      ref: AptosSettlementRef,
      reader: AptosReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: AptosSettlementRef,
      reader: AptosReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      hashes: string[],
      reader: AptosReader,
    ): Promise<AptosSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded payment_id, and the silent
      // [] it would produce is indistinguishable from "no settlements" (mirrors encodePaymentIdArg's loud
      // refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const out: AptosSettlementRef[] = [];
      for (const hash of hashes) {
        const atr = recoverAtrHashFromTxView(
          await reader.txView(hash),
          moduleAddress,
        );
        if (atr !== null && atrHashEquals(atr, atrHash)) out.push({ hash });
      }
      return out;
    },
  };
}
