import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Sui Pay402 `payment_id` binding manifest.
 *
 * **protocol = "x402", SCOPED TO PAY402 — and the scoping is the substance.** Pay402 is an x402
 * facilitator, not a bare-rail payment primitive: its Move module is `x402_payment` and `settle_payment`
 * takes a `facilitator_fee`. The field's contract is `absent IFF protocol-neutral`, so omitting it would be
 * a positive claim of neutrality this binding cannot make. The rail id stays `sui`: the rail is the chain,
 * the protocol is what settles over it.
 *
 * **BUT THIS IS NOT x402'S PUBLISHED exact-Sui SCHEME, AND A READER MUST NOT INFER THAT.** Verified at
 * `x402-foundation/x402` HEAD 2026-08-08, `specs/schemes/exact/scheme_exact_sui.md` describes a different
 * shape entirely: a plain `0x2::coin::Coin<T>` transfer in a client-signed transaction, payload
 * `{signature, transaction}`, verified by simulation. It has **no `payment_id`**, no facilitator Move
 * module, no `PaymentSettled` event, and does not mention Pay402 at all — measured: zero occurrences of
 * "pay402", "payment_id" or "PaymentSettled" in the document.
 *
 * So `protocol: "x402"` here names the protocol family the facilitator implements, not conformance to that
 * scheme document. The carrier below is **Pay402's**, and a deployment settling through a facilitator that
 * follows x402's published exact-Sui scheme has no `payment_id` argument to weld into — it needs a
 * different binding, which this package does not provide. Stating that is the point of the declaration:
 * silence would have been read as neutrality, and an unqualified `x402` would be read as the scheme.
 *
 * **pattern = "native-field"** — the atrHash rides the FULL 32 raw bytes of Pay402's
 * `settle_payment<T>(.., payment_id: vector<u8>, ..)` argument (canonical LCP §8.3.1 per the LCP per-chain
 * table; Pay402 is an MIT-licensed third-party Sui x402 facilitator, not a custom LCP overlay). It is NOT
 * x402's canonical Sui facilitator, and the paragraph above is why: x402 publishes its own exact-Sui scheme
 * and does not name Pay402 anywhere in it. The buyer signs the settlement transaction carrying
 * `payment_id`, so the weld is **signature-grade** — the payer's signature commits to `payment_id`
 * atomically with the coin transfer.
 *
 * **recovery.forwardIndexable = false** — Sui's `suix_queryEvents` filters by `MoveEventType`
 * (`<pkg>::payment::PaymentSettled`), NOT by the `payment_id` bytes. `recover` reads `payment_id` from a
 * single settled transaction's event (zero-party, from the settlement alone — the full hash is present, no
 * truncation like Stellar's mux prefix); `enumerate` is a best-effort **event-type scan** filtered
 * client-side on `payment_id`, which is an O(history) scan, NOT an O(1) forward index keyed on the atrHash
 * — hence `indexing: "event-scan:PaymentSettled.payment_id"` and `forwardIndexable: false` (honest: the
 * scan exists, the native atrHash index does not).
 */
export const SUI_MANIFEST: BindingManifest = {
  rail: "sui",
  protocol: "x402",
  pattern: "native-field",
  nativeField: "pay402-payment-id",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "proposal-only", // coinType is the Move call's type argument in propose; recover never re-checks it
  successGate: "structural", // an aborted PTB discards ALL effects including events — settledEvents returns []
  indexing: "event-scan:PaymentSettled.payment_id",
  finality: {
    reversible: false,
    note: "final on checkpoint (Pay402 settle_payment) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { pay402: "signature" },
  lifecycleStates: ["proposed", "settled"],
};
