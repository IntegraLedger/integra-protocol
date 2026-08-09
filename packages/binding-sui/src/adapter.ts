/**
 * The Sui Pay402 `payment_id` adapter — thin I/O with @mysten/sui isolated here. It intentionally
 * does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef.txHash` is a
 * `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and Sui speaks transaction digests + Move events.
 * Rather than lie through those types, this exposes a Sui-native surface (digest refs, a `SuiReader` port)
 * alongside the shared, chain-agnostic `BindingManifest`. Unifying the port shape across EVM and non-EVM
 * rails is future work; forcing it here would misrepresent the rail.
 *
 * `propose` appends the Pay402 `settle_payment<T>` Move call — carrying the atrHash in `payment_id` — to a
 * caller-owned `Transaction` (the buyer signs and submits it); `recover` reads the atrHash back from a
 * settled transaction's `PaymentSettled` event; `observe` reports the settled transition; `enumerate` is
 * the best-effort event-type scan the manifest declares (`forwardIndexable: false`).
 *
 * ★ WHY THERE IS NO EXPLICIT SUCCESS GATE HERE — the rail supplies one STRUCTURALLY, and that reliance is
 * recorded so a future reader change cannot silently break it. Sui executes a PTB atomically: on abort,
 * ALL effects are discarded, INCLUDING emitted events. A failed transaction is still committed for gas but
 * carries no events, so `settledEvents(digest)` returns `[]` and recovery refuses with nothing extra to
 * check. This is the same posture as the EVM rails (a reverted tx emits no logs, so the weld event is
 * absent) and it is why this binding needs no `success`-shaped field, unlike solana/xrpl/hedera/aptos —
 * whose rails DO record a failed transaction's payload. **If the reader ever sources events from anywhere
 * that survives an abort — a dry-run/`devInspect` simulation, a mempool feed, a re-executed effects
 * projection — this reliance breaks and an explicit gate on `effects.status` becomes mandatory.**
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import type { Transaction } from "@mysten/sui/transactions";
import { pay402SettledEventType, pay402SettleTarget } from "./constants.js";
import { decodeAtrPaymentId, encodeAtrPaymentId } from "./payment-id.js";

/**
 * A Sui settlement reference — a transaction digest plus the Pay402 package id whose `PaymentSettled`
 * event is the trusted weld. `packageId` is REQUIRED: a single Sui PTB can compose calls from arbitrary
 * packages, so `recover` must exact-match the fully-qualified `<packageId>::payment::PaymentSettled` event
 * — matching a bare `::PaymentSettled` suffix would let a same-tx event from an untrusted package spoof the
 * weld (fail-fast: the caller states which package it trusts, never a loose suffix guess).
 */
export interface SuiSettlementRef {
  digest: string;
  packageId: string;
}

/** The minimal, decoded view of one `PaymentSettled` Move event this binding cares about. */
export interface PaymentSettledView {
  /** The fully-qualified Move event type (`<pkg>::payment::PaymentSettled`). */
  type: string;
  /** The `payment_id` bytes as the RPC surfaces them (a JSON number[]), if present. */
  paymentId?: readonly number[];
  /** The digest of the transaction that emitted this event (from `event.id.txDigest`), if known. */
  digest?: string;
}

/** Arguments for building the Pay402 settle call. */
export interface SettlePaymentArgs {
  /** The Pay402 fork's deployed package object id (`0x…`). */
  packageId: string;
  /** The USDC `Coin<T>` type tag (the settle call's single type argument). */
  coinType: string;
  /** The buyer's coin object to pay from (an owned `Coin<T>` object id). */
  buyerCoin: string;
  /** The buyer's Sui address. */
  buyer: string;
  /** The merchant (seller) Sui address. */
  merchant: string;
  /** The payment amount in base units. */
  amount: bigint;
  /** The facilitator fee in base units (0 in the unsponsored-pull path). */
  facilitatorFee: bigint;
  /** The atrHash to weld into `payment_id` (0x-prefixed 32-byte). */
  atrHash: string;
  /** The shared `Clock` object id (`0x6` on every Sui network). */
  clock?: string;
}

/** The Sui shared `Clock` object — a fixed system object id on every network. */
const SUI_CLOCK_OBJECT_ID = "0x6";

/**
 * Append the Pay402 `settle_payment<Coin<T>>` Move call — carrying `atrHash` in `payment_id` — to `tx`.
 * Mutates the caller's `Transaction` (the SDK's giant generic result type stays off this package's
 * exported surface — this returns `void`). Throws on a malformed atrHash (fail-fast, via the codec).
 */
export function appendSettlePaymentCall(
  tx: Transaction,
  args: SettlePaymentArgs,
): void {
  const paymentId = encodeAtrPaymentId(args.atrHash);
  tx.moveCall({
    target: pay402SettleTarget(args.packageId),
    typeArguments: [args.coinType],
    arguments: [
      tx.object(args.buyerCoin),
      tx.pure.address(args.buyer),
      tx.pure.u64(args.amount),
      tx.pure.address(args.merchant),
      tx.pure.u64(args.facilitatorFee),
      tx.pure.vector("u8", Array.from(paymentId)),
      tx.object(args.clock ?? SUI_CLOCK_OBJECT_ID),
    ],
  });
}

/**
 * Recover the atrHash from a set of event views — the first event whose type EXACTLY equals `eventType`
 * (the trusted `<packageId>::payment::PaymentSettled`) and whose `payment_id` decodes wins. Pure. Exact
 * type match (not a `::PaymentSettled` suffix) so a same-tx event from an untrusted package cannot spoof
 * the weld.
 */
export function recoverAtrHashFromEvents(
  views: PaymentSettledView[],
  eventType: string,
): `0x${string}` | null {
  for (const v of views) {
    if (v.type !== eventType) continue;
    if (v.paymentId === undefined) continue;
    const atr = decodeAtrPaymentId(v.paymentId);
    if (atr !== null) return atr;
  }
  return null;
}

/** Reads settled transactions / queries settle events — wraps a @mysten/sui `SuiJsonRpcClient`. */
export interface SuiReader {
  /** The `PaymentSettled` event views emitted by the transaction `digest`. */
  settledEvents(digest: string): Promise<PaymentSettledView[]>;
  /** Scan recent `PaymentSettled` events of `eventType`, newest first (best-effort, not an atrHash index). */
  querySettled(
    eventType: string,
    limit?: number,
  ): Promise<PaymentSettledView[]>;
}

/** The Sui rail's surface. `propose` MUTATES the `Transaction` you hand it — it appends the Pay402 settle
 *  call and returns nothing, rather than handing back an artifact to attach. The full 32 bytes ride in
 *  `payment_id`, so recovery is complete (unlike Stellar's prefix); `enumerate` is an event-type query,
 *  which is a scan and not a native index. */
export interface SuiAdapter {
  manifest: BindingManifest;
  /** Append the Pay402 settle call (carrying the atrHash in `payment_id`) to the buyer's `Transaction`. */
  propose(tx: Transaction, args: SettlePaymentArgs): void;
  /** Recover the atrHash from a settled tx, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: SuiSettlementRef,
    reader: SuiReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the tx settled and carries a valid Pay402 payment_id). */
  observe(
    ref: SuiSettlementRef,
    reader: SuiReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** Best-effort event-type scan for settlements bearing `atrHash` (NOT a native index — see manifest). */
  enumerate(
    atrHash: string,
    eventType: string,
    reader: SuiReader,
    limit?: number,
  ): Promise<SuiSettlementRef[]>;
}

/** Construct the Sui adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `SUI_MANIFEST`; a manifest whose `rail` is not `"sui"` throws, because an adapter over another rail's
 *  manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createSuiAdapter(manifest: BindingManifest): SuiAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "sui")
    throw new Error(
      `createSuiAdapter: manifest.rail "${manifest.rail}" is not "sui"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  async function doRecover(
    ref: SuiSettlementRef,
    reader: SuiReader,
  ): Promise<Outcome<`0x${string}`>> {
    const eventType = pay402SettledEventType(ref.packageId);
    const atr = recoverAtrHashFromEvents(
      await reader.settledEvents(ref.digest),
      eventType,
    );
    if (atr === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "sui/no-payment-id",
        detail: `no ${eventType} event carrying an atrHash payment_id in ${ref.digest}`,
      };
    return { ok: true, value: atr };
  }

  return {
    manifest,

    propose(tx: Transaction, args: SettlePaymentArgs): void {
      appendSettlePaymentCall(tx, args);
    },

    recover(
      ref: SuiSettlementRef,
      reader: SuiReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: SuiSettlementRef,
      reader: SuiReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      eventType: string,
      reader: SuiReader,
      limit?: number,
    ): Promise<SuiSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded payment_id, and the silent
      // [] it would produce is indistinguishable from "no settlements" (mirrors encodeAtrPaymentId's loud
      // refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      // Every matched event has `type === eventType` = `<packageId>::payment::PaymentSettled`, so the
      // trusted package is the type's first segment — stamp it so each ref round-trips back into `recover`.
      const packageId = eventType.split("::")[0] ?? eventType;
      const views = await reader.querySettled(eventType, limit);
      const out: SuiSettlementRef[] = [];
      for (const v of views) {
        if (v.type !== eventType || v.paymentId === undefined) continue;
        if (v.digest === undefined) continue;
        const atr = decodeAtrPaymentId(v.paymentId);
        if (atr !== null && atrHashEquals(atr, atrHash))
          out.push({ digest: v.digest, packageId });
      }
      return out;
    },
  };
}
