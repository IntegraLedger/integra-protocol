import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Aptos `lcp_payment` Move-module binding manifest.
 *
 * **pattern = "overlay-contract"** — the atrHash rides as the `payment_id: vector<u8>` argument of a
 * `<lcpModuleAddress>::payment::settle_payment<Coin>` Move entry call. That call targets a **bespoke,
 * deployed** `lcp_payment` module — not a stock Aptos primitive — so by LCP §8.3.2 this is an
 * overlay-contract binding, NOT native-field. (An earlier descriptor labelled it
 * `native-field`; that classification is superseded by the canonical per-chain binding table
 * ("Aptos = Overlay").
 * Aptos's stock USDC/APT carry no arbitrary-bytes field, so binding atrHash requires this custom module,
 * which is the definition of an overlay contract.) Because the pattern is not `native-field`, this manifest
 * carries **no `nativeField`** — the profile schema enforces the iff and rejects a `nativeField` here.
 *
 * **weld = signature-grade** — the buyer signs the Move-call transaction that carries `payment_id`, so the
 * payer's signature commits the binding atomically with the coin transfer (`"settle-payment": "signature"`).
 *
 * **recovery.forwardIndexable = false** — Aptos indexes events by account + creation-number / handle (the
 * event *type*), NOT by arbitrary data fields, so there is no per-atrHash forward index. `recover` reads
 * `payment_id` from a single settlement's `PaymentSettled` event (zero-party, from the settlement alone);
 * `enumerate` is a best-effort check of a **caller-supplied candidate set** — each candidate transaction
 * hash is fetched via the reader's `txView` and kept when its `PaymentSettled` `payment_id` matches; no
 * event-query surface exists on the reader, hence `indexing: "candidate-set:payment::PaymentSettled"` and
 * `forwardIndexable: false` (honest: the check exists, a native per-payment_id index does not).
 *
 * **NO `protocol`, and the silence is now examined rather than default.** x402's `exact` scheme for Aptos
 * (`x402-foundation/x402`, read 2026-08-08) defines exactly one `extra` member — `extra.feePayer`, the
 * sponsoring account — and no field for arbitrary bytes. There is nothing in that flow for a weld to ride,
 * so this binding neither targets it nor conflicts with it: an x402-Aptos payment can carry this overlay
 * alongside, because the overlay is a separate object the scheme says nothing about.
 */
export const APTOS_MANIFEST: BindingManifest = {
  rail: "aptos",
  pattern: "overlay-contract",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "proposal-only", // the Coin type argument binds at propose; recover reads payment_id alone
  successGate: "raw-field", // success && vm_status === Executed successfully; the fullnode returns failed txs with their events
  indexing: "candidate-set:payment::PaymentSettled",
  finality: {
    reversible: false,
    note: "final on execution (Move settle_payment) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "settle-payment": "signature" },
  lifecycleStates: ["proposed", "settled"],
};
