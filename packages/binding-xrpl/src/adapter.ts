/**
 * The XRPL `InvoiceID` binding adapter — thin I/O over an injected `XrplReader` port, PURE (no XRPL SDK;
 * the signing/submit SDK — ripple-keypairs / ripple-binary-codec — lives in the caller's rail runtime, not
 * here). It intentionally does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped
 * (`SettlementRef.txHash` is a `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and XRPL speaks
 * transaction hashes read via rippled's `tx`/`account_tx` JSON-RPC. Rather than lie
 * through those types, this exposes an XRPL-native surface (transaction-hash refs, an `XrplReader` port)
 * alongside the shared, chain-agnostic `BindingManifest`. Unifying the port shape across EVM and non-EVM
 * rails is future work; forcing it here would misrepresent the rail.
 *
 * `propose` builds the `InvoiceID` the buyer signs into their `Payment`; `recover` reads the atrHash back
 * from a validated settlement, `InvoiceID` first and the legacy memo only if it is absent; `observe`
 * reports the settled transition; `enumerate` is the best-effort account scan the manifest declares
 * (`forwardIndexable: false`).
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import { decodeInvoiceId, proposeInvoiceId } from "./invoice-id.js";
import { readLcpMemoAtrHash, type XrplMemo } from "./memo.js";

/** An XRPL settlement reference — a validated `Payment` transaction hash (hex, 64 chars). */
export interface XrplSettlementRef {
  txHash: string;
}

/**
 * The minimal, decoded view of one `Payment` this binding cares about. `validated` reflects whether
 * rippled has validated the transaction into a closed ledger; `engineResult` is the ledger engine result
 * (`tesSUCCESS` on a funds-moving success — a `tec*`/`tef*` result lands in the ledger but moves no funds).
 * A binding recovery is only honoured on a validated, `tesSUCCESS` Payment.
 */
export interface XrplPaymentView {
  /**
   * The canonical carrier since 2026-08-08: an unprefixed 64-char `Hash256`. x402's exact-XRPL scheme
   * makes a facilitator reject any memo-bearing transaction, so the weld moved here.
   */
  invoiceId: string | undefined;
  /**
   * The LEGACY carrier, read and never written. Payments welded before the move still carry it, and
   * discarding them would lose real records — but a memo-bearing payment cannot settle through an
   * x402-XRPL facilitator at all (scheme §9: "The facilitator MUST reject transactions with: … `Memos`
   * present"), so nothing emits one now.
   */
  memos: ReadonlyArray<XrplMemo> | undefined;
  validated: boolean;
  engineResult: string | undefined;
}

/** Reads validated transactions / account history — wraps a rippled JSON-RPC client (SDK-side). */
export interface XrplReader {
  /** Fetch one Payment's decoded view by tx hash, or `null` if rippled has no such transaction. */
  paymentView(txHash: string): Promise<XrplPaymentView | null>;
  /** The Payment tx hashes touching `account`, newest first (an `account_tx` scan; bounded by `limit`). */
  paymentHashesFor(account: string, limit?: number): Promise<string[]>;
}

/** Why a Payment view yielded no settled weld — distinguished so `recover`/`observe` report WHY (mirrors
 *  binding-stellar): a transaction rippled does not have is not a failed one, and a failed one is not a
 *  missing memo. One reading shared by every surface, so they cannot disagree about what a view means. */
export type XrplSettlementReading =
  | { settled: true; atrHash: `0x${string}` }
  | {
      settled: false;
      reason:
        | "no-such-transaction"
        | "unsuccessful-transaction"
        | "no-atr-weld";
    };

/**
 * Read a Payment view as a settlement. Pure. Fail-closed: a tx that has not validated, or validated with
 * a non-success engine result, moved no funds — it is not a settlement, so whatever it carries is not a
 * weld (a `tec*`/`tef*` result lands in the ledger but moves nothing); both read
 * `unsuccessful-transaction`.
 *
 * `InvoiceID` is read FIRST and the memo only if it is absent. Order matters and is not arbitrary: the
 * memo path exists solely for payments welded before 2026-08-08, and a payment carrying both is one whose
 * `InvoiceID` is the current, x402-settleable weld.
 */
export function readPaymentView(
  view: XrplPaymentView | null,
): XrplSettlementReading {
  if (view === null) return { settled: false, reason: "no-such-transaction" };
  if (!view.validated || view.engineResult !== "tesSUCCESS")
    return { settled: false, reason: "unsuccessful-transaction" };
  const fromInvoice =
    view.invoiceId === undefined ? null : decodeInvoiceId(view.invoiceId);
  const atrHash = fromInvoice ?? readLcpMemoAtrHash(view.memos);
  if (atrHash === null) return { settled: false, reason: "no-atr-weld" };
  return { settled: true, atrHash };
}

/** Recover the atrHash from a single Payment view, or `null` if it is not a settled, welded Payment.
 *  The null-collapsing convenience over `readPaymentView` — the reasons live there. */
export function recoverAtrHashFromPayment(
  view: XrplPaymentView | null,
): `0x${string}` | null {
  const reading = readPaymentView(view);
  return reading.settled ? reading.atrHash : null;
}

/** The XRPL rail's surface. The weld rides `InvoiceID` on the `Payment` — a 32-byte field that holds the
 *  whole atrHash, so recovery is complete. **`InvoiceID` is one field and x402's `extra.invoiceId` wants
 *  the same one**: the two welds are mutually exclusive per transaction and nothing on-chain distinguishes
 *  them, which is why `propose` takes `usesX402InvoiceBinding` and throws rather than quietly picking. */
export interface XrplAdapter {
  manifest: BindingManifest;
  /**
   * The `InvoiceID` to sign into the settlement `Payment`. Throws on a malformed atrHash, and throws when
   * the seller also intends an x402 `extra.invoiceId` — the two welds are mutually exclusive per
   * transaction and nothing on-chain tells them apart.
   */
  propose(inputs: {
    atrHash: string;
    usesX402InvoiceBinding?: boolean;
  }): string;
  /** Recover the atrHash from a validated settlement, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: XrplSettlementRef,
    reader: XrplReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the Payment is validated, tesSUCCESS, and carries a recoverable
   *  atrHash — `InvoiceID`, or the legacy memo where one predates the move). */
  observe(
    ref: XrplSettlementRef,
    reader: XrplReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** Best-effort account scan for settlements bearing `atrHash` (NOT a native index — see the manifest). */
  enumerate(
    atrHash: string,
    account: string,
    reader: XrplReader,
    limit?: number,
  ): Promise<XrplSettlementRef[]>;
}

/** Construct the XRPL adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `XRPL_MANIFEST`; a manifest whose `rail` is not `"xrpl"` throws, because an adapter over another rail's
 *  manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createXrplAdapter(manifest: BindingManifest): XrplAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "xrpl")
    throw new Error(
      `createXrplAdapter: manifest.rail "${manifest.rail}" is not "xrpl"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  /** Every refusal on this rail is a verification failure, namespaced `xrpl/…` (mirrors binding-stellar,
   *  whose granularity is the model: `recover` and `observe` report WHY, because a failed transaction is
   *  not a missing memo and a transaction rippled does not have is neither). */
  const refuse = (code: string, detail: string): Outcome<never> => ({
    refused: true,
    haltClass: "verification-failure",
    code: `xrpl/${code}`,
    detail,
  });

  async function doRecover(
    ref: XrplSettlementRef,
    reader: XrplReader,
  ): Promise<Outcome<`0x${string}`>> {
    const reading = readPaymentView(await reader.paymentView(ref.txHash));
    if (reading.settled) return { ok: true, value: reading.atrHash };
    switch (reading.reason) {
      case "no-such-transaction":
        return refuse(
          "no-such-transaction",
          `rippled has no transaction ${ref.txHash} — nothing settled there`,
        );
      case "unsuccessful-transaction":
        return refuse(
          "unsuccessful-transaction",
          `transaction ${ref.txHash} did not settle (unvalidated, or a non-tesSUCCESS engine result) — whatever it carries is not a weld`,
        );
      case "no-atr-weld":
        return refuse(
          "no-atr-weld",
          `no atrHash on validated tesSUCCESS Payment ${ref.txHash} — neither InvoiceID nor a legacy LCP memo carries one`,
        );
    }
  }

  return {
    manifest,

    propose(inputs: {
      atrHash: string;
      usesX402InvoiceBinding?: boolean;
    }): string {
      return proposeInvoiceId(inputs);
    },

    recover(
      ref: XrplSettlementRef,
      reader: XrplReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: XrplSettlementRef,
      reader: XrplReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      account: string,
      reader: XrplReader,
      limit?: number,
    ): Promise<XrplSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded memo, and the silent []
      // it would produce is indistinguishable from "no settlements" (mirrors proposeInvoiceId's loud refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const hashes = await reader.paymentHashesFor(account, limit);
      const out: XrplSettlementRef[] = [];
      for (const txHash of hashes) {
        const atr = recoverAtrHashFromPayment(await reader.paymentView(txHash));
        if (atr !== null && atrHashEquals(atr, atrHash)) out.push({ txHash });
      }
      return out;
    },
  };
}
