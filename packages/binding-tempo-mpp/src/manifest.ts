import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Tempo TIP-20 memo binding manifest for MPP (LCP §8.3.1 Native Field).
 *
 * **pattern = "native-field"** — the atrHash rides the `bytes32 memo` of TIP-20's
 * `transferWithMemo(address to, uint256 amount, bytes32 memo)`, an existing chain-level primitive for
 * arbitrary 32 bytes, emitted as `TransferWithMemo(address indexed from, address indexed to, uint256
 * amount, bytes32 indexed memo)`. No overlay contract, no sidecar. Under MPP the seller advertises
 * `methodDetails.memo = atrHash` in the MAC-protected challenge body and the buyer's `transferWithMemo`
 * call carries it.
 *
 * **Every value below was OBSERVED on Tempo mainnet (chainId 4217) on 2026-07-30, not read off a spec.**
 * The observation is tx `0x45dfbd262d0d43e3ad72f35ce6e6ac7861c112a1aeee48c2e8fa0be9031f9aef` at block
 * 32395772 — check it on any Tempo explorer rather than taking this comment's word for it. See the
 * README's provenance section for the full discharge.
 *
 * - `recovery.onChain` — the memo is topic 3 of the settlement's own log. Observed.
 * - `recovery.zeroPartyRecoverable` — the FULL 32 bytes ride in the topic (no truncation, unlike
 *   Stellar's 8-byte mux prefix), so `eth_getTransactionReceipt(txHash)` alone recovers it with no
 *   seller cooperation and no indexer. Observed from a public RPC.
 * - `recovery.forwardIndexable` — the memo is an INDEXED parameter, so
 *   `eth_getLogs({topics:[sig,null,null,memo]})` returns every settlement ever bound to one atrHash in
 *   one query. Observed: the topic-3 filter returned exactly the pinned settlement. **One of two shipped
 *   profiles indexed by the reference itself**, `evm:x402` being the other (EIP-3009's indexed `nonce`
 *   topic); `cardano` indexes by metadata LABEL and `evm:escrow` scans event DATA, while
 *   solana/xrpl/hedera/sui/stellar declare `false` and offer a history scan instead. What is distinctive
 *   here is the carrier — 32 free-form bytes with no other job, on the transfer's own event.
 *
 * **`weldGrades` names two call paths because the two grades genuinely differ, and this is the one place
 * the grade is `signature`, not `tx`** — an earlier sketch wrote `{"tip20-memo": "tx"}` and the gate
 * corrected it:
 * - `transferWithMemo` is **signature**-grade. The observed Tempo transaction (type `0x76`) carries the
 *   transfer in a `calls[]` array under the payer's own `secp256k1` `signature`, with the sponsor's
 *   `feePayerSignature` alongside it — so the payer's signature commits to the calldata carrying the memo,
 *   exactly as EIP-3009's does on x402 and the SPL memo instruction does on Solana. Under-declaring it as
 *   tx-grade would understate the weld and contradict every sibling binding's reading of the same fact.
 * - `transferFromWithMemo` is **tx**-grade. TIP-20 also exposes
 *   `transferFromWithMemo(from, to, amount, memo)`, which emits the same event; there the SPENDER chooses
 *   the memo, and the owner's `approve`/`permit` signature does not cover it. It is not reachable through
 *   MPP's Tempo charge method (mpp-rs accepts only the `transfer` and `transferWithMemo` selectors as
 *   payment calls) but it IS reachable on a bare-TIP-20 rail, and the log alone cannot tell the two apart
 *   — `weldGradeForCall` needs the calldata, which is why the grade is a property of the call and not of
 *   the event.
 */
export const TEMPO_MPP_MANIFEST: BindingManifest = {
  rail: "tempo:mpp",
  protocol: "mpp",
  pattern: "native-field",
  nativeField: "tip20.memo",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: true,
  },
  assetBinding: "filtered", // recovery skips every event whose address is not the configured TIP-20 token (requireTip20Token throws unset)
  successGate: "structural", // a reverted tx emits no logs, so the weld event cannot exist
  indexing: "topic:TransferWithMemo.memo",
  finality: {
    reversible: false,
    note: "final on confirmation (TIP-20 transferWithMemo) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: {
    "tip20-transferWithMemo": "signature",
    "tip20-transferFromWithMemo": "tx",
  },
  lifecycleStates: ["proposed", "settled"],
};
