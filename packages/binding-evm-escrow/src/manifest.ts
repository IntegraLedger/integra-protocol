import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Commerce Payments escrow binding manifest (`AuthCaptureEscrow`, authorize→capture).
 *
 * **pattern = "native-field"** — the atrHash rides `PaymentInfo.salt`, an EXISTING protocol field the
 * service already controls (LCP §8.3.1); no derivation, no overlay. **WLD-3 recovery is an event-data scan,
 * not a topic filter:** the indexed topic is `paymentInfoHash`; `salt` rides the cleartext `PaymentInfo`
 * in `PaymentAuthorized`/`PaymentCharged` event data, so `recover`/`enumerate` decode the event and read
 * `salt` (proven on-chain).
 *
 * **recovery.forwardIndexable = false** — the criterion is enumeration bound to a GIVEN atrHash, and this
 * rail cannot do it. `paymentInfoHash` is the only indexed topic, and it is a hash of the whole
 * `PaymentInfo` struct: a caller holding the complete struct could topic-filter, but a caller holding only
 * an atrHash cannot derive it. So `enumerate` fetches the salt-bearing events over a range and filters
 * client-side on the decoded `salt` — an O(range) scan, which is exactly what `indexing:
 * "event-data-scan:paymentInfoHash"` says and what `adapter.ts` does. Six siblings declare `false` for
 * mechanically equivalent scans; the three that declare `true` (cardano, tempo-mpp, evm-x402) each rest on
 * a real index keyed on the atrHash itself.
 *
 * **weldGrades are TRANSCRIBED from an on-chain proof, never authored here**: `ERC3009 =
 * "signature"` is **proven on-chain** (the payer's USDC `ReceiveWithAuthorization` drives
 * `authorize`); `Permit2`/`SpendPermission` = `"signature"` and `PreApproval` = `"tx"` are
 * **characterized from the pinned source** (`collectors/*.sol`) and NOT yet on-chain-proven — an adapter
 * refuses a collector until its grade is proven the same way (`collectors.ts`). If a run ever falsifies a
 * collector, this manifest changes with it — the on-chain proof stays the authority on what may be declared.
 *
 * **THE atrHash MUST BE PER-TRANSACTION, AND THIS IS THE FIRST PLACE IT IS WRITTEN DOWN.** The carrier is
 * `PaymentInfo.salt`, whose own specification calls it "a source of entropy to ensure unique hashes across
 * different payments". An atrHash carries no entropy: it is deterministic, server-side, and identical for
 * every payment made under one terms document. The consequence is on-chain and immediate — the escrow
 * rejects a `PaymentInfo` it has already seen, so a repeat purchase under one ATR with the same payer,
 * caps and expiries reverts. Nothing in this package can detect that, because the collision is between two
 * transactions it never sees together; a deployment reusing one ATR across purchases is the failure mode,
 * and the fix is a per-transaction ATR, which LCP §6.1 wants anyway.
 *
 * **NO `protocol`, and the silence is now examined rather than default.** x402 publishes an `auth-capture`
 * scheme over this SAME contract stack (`base/commerce-payments`, `AuthCaptureEscrow`), read 2026-08-08 —
 * but x402 building on a contract this binding also builds on does not make this binding x402's. There is
 * no `extra` block here, no facilitator, no payload envelope: this package constructs `PaymentInfo`
 * directly and settles against the contract. Declaring `protocol: "x402"` would claim conformance to a
 * wire format it does not implement.
 *
 * The scheme is still worth reading, because it sharpens the salt requirement above. Under x402
 * auth-capture the signature nonce is the **payer-agnostic** `PaymentInfo` hash — "Payer is zeroed" — and
 * freshness rests entirely on the salt: "each signing call generates a fresh `bytes32` salt, so two payers
 * signing concurrently produce distinct nonces with no collision risk." A deterministic salt removes the
 * only thing keeping two DIFFERENT payers apart there. So a deployment that settles through an x402
 * auth-capture facilitator must not weld this way at all, where a bare deployment only has to keep the ATR
 * per-transaction.
 */
export const ESCROW_MANIFEST: BindingManifest = {
  rail: "evm:escrow",
  pattern: "native-field",
  nativeField: "PaymentInfo.salt",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "carried", // PaymentInfo.token rides the cleartext event data — the record itself names the asset
  successGate: "structural", // a reverted tx emits no logs, so the escrow weld event cannot exist
  indexing: "event-data-scan:paymentInfoHash",
  finality: {
    reversible: true,
    note: 'on-rail void/refund within refundExpiry — not dispute resolution (RCS-5); capture is not reversed, refund is a fresh on-rail remedy The atrHash welded into PaymentInfo.salt MUST be per-transaction: salt is specified as the struct\'s entropy source ("a source of entropy to ensure unique hashes across different payments") and an atrHash carries none, so a repeat purchase under one ATR with the same payer, caps and expiries produces a PaymentInfo the escrow has already seen and reverts.',
  },
  weldGrades: {
    ERC3009: "signature",
    Permit2: "signature",
    SpendPermission: "signature",
    PreApproval: "tx",
  },
  lifecycleStates: [
    "proposed",
    "authorized",
    "captured",
    "charged",
    "voided",
    "reclaimed",
    "refunded",
  ],
};
