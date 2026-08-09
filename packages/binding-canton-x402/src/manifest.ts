import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { CANTON_X402_MEMO_KEY } from "./constants.js";

/**
 * The Canton transfer-memo binding manifest.
 *
 * **pattern = "native-field"** (canonical LCP §8.3.1). x402's `exact` scheme for Canton defines
 * `PaymentRequirements.extra.memo` — "Seller-defined UTF-8 string, max 256 bytes. When present, the
 * client MUST include it in the transfer's metadata" — and its facilitator safety check 12 rejects
 * `invalid_exact_canton_memo_mismatch` unless the transfer metadata carries the identical value under
 * `x402.memo`. The atrHash therefore rides a field the host defined, on the transaction that moves the
 * money.
 *
 * **THIS IS A SECOND CANTON RAIL, NOT A REPLACEMENT.** `@integraledger/lcp-binding-canton` binds the same
 * chain through an `LcpAnchor` overlay contract, and it is not obsolete: x402's exact-Canton scheme
 * settles **Canton Coin only** ("`asset`: `\"CC\"`. Settles Canton Coin only", instrument fixed to
 * `Amulet`, via `transfer-factory`, relayed by a facilitator). Every other Canton deployment — any
 * instrument, any synchronizer, DvP and fund and bond workflows, no facilitator — still has no native
 * field to ride, and the overlay is the only carrier there.
 *
 * Where BOTH apply, this one wins on every axis: the weld rides the SAME transaction as the payment
 * rather than a separate contract create; it is enforced by the facilitator rather than by nobody; and it
 * binds the asset rather than declaring `assetBinding: "none"`. That is LCP §8.3's own ordering, and it is
 * why the overlay's docblock now says it is an overlay by CHOICE rather than by necessity — the claim that
 * Daml has no native arbitrary-bytes carrier was simply false.
 *
 * One chain, two carriers, two bindings, for the same reason EVM has three (`evm:x402`, `evm:escrow`,
 * `evm:mpp`): a manifest can honestly describe exactly one carrier.
 *
 * **protocol = "x402"**, and the declaration is substantive. `extra.memo` is x402's field, its 256-byte
 * ceiling is x402's ceiling, and the enforcement is an x402 facilitator's. A deployment settling Canton
 * Coin outside x402 does not get this carrier, and saying so is the point of the axis: an absent
 * `protocol` is a positive claim of protocol-neutrality, which this binding cannot make.
 *
 * **assetBinding = "carried"** — the memo rides a `TransferFactory_Transfer` whose own fields name the
 * receiver, the amount and the instrument, and `CantonX402TransferView` carries all three to the caller. That
 * is the axis's actual test: not that the value exists on-chain, but that a consumer can reach it. The
 * overlay could not, which is why it honestly said `"none"`.
 *
 * **recovery.zeroPartyRecoverable = false** — unchanged, and for the unchanged reason. Daml contract and
 * transaction visibility is limited to stakeholders, so a neutral verifier holding only a settlement
 * reference sees nothing until the payer, the merchant or the DSO grants access. §8.3 asks whether an
 * auditor can reconstruct the atrHash from the settlement reference alone WITHOUT trusting either party to
 * produce records; on Canton they cannot, whichever carrier is used. WLD-3 makes the direction of the
 * error normative — understating costs nothing, overstating is non-conformance.
 *
 * **recovery.forwardIndexable = false** — a participant's update stream is one participant's view, not a
 * chain-global forward index, and the memo is a metadata value rather than an indexed key. Honest for the
 * same reason the overlay's participant query was.
 *
 * **successGate = "structural"** — a Canton transfer that did not commit produces no update, so there is
 * no failed view whose memo could be misread as a settlement. The transfer either executed and its
 * metadata exists, or it did not and nothing does.
 *
 * **weldGrades["x402-memo"] = "tx"** — the memo is committed by the payer's signed
 * `TransferFactory_Transfer`, not by a detached signature over the atrHash bytes. The payer signs the
 * prepared transaction (which contains the memo), so the commitment rides the transaction. Per LCP §8.3 /
 * WLD-3 that is tx-grade.
 *
 * **finality.reversible = false** — once the transfer executes, its input holdings are consumed and Canton
 * has no reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution.
 */
export const CANTON_X402_MANIFEST: BindingManifest = {
  rail: "canton:x402",
  pattern: "native-field",
  protocol: "x402",
  nativeField: CANTON_X402_MEMO_KEY,
  recovery: {
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  },
  assetBinding: "carried",
  successGate: "structural",
  indexing: `participant-updates:transfer.meta.${CANTON_X402_MEMO_KEY}`,
  finality: {
    reversible: false,
    note: "a Canton transfer consumes the input holdings it names and Canton has no reversal, so an executed transfer's memo is permanent; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "x402-memo": "tx" },
  lifecycleStates: ["proposed", "settled"],
};
