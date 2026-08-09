import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Canton `LcpAnchor` overlay-contract binding manifest.
 *
 * **pattern = "overlay-contract"** — by CHOICE (canonical LCP §8.3.2), and the distinction matters. An
 * earlier cut of this docblock said "by NECESSITY", on the premise that "Daml has no native
 * arbitrary-bytes carrier on a transaction (no memo, metadata label, or nonce)". That premise is FALSE:
 * x402's `exact` scheme for Canton defines `PaymentRequirements.extra.memo`, echoed by the payer into the
 * transfer metadata under `x402.memo` and enforced by the facilitator. Where that scheme applies, the memo
 * is the stronger carrier — same transaction as the payment, facilitator-verified, asset-bound — and it is
 * `@integraledger/lcp-binding-canton-x402`, not this package.
 *
 * **WHAT THIS PACKAGE IS FOR IS EVERYTHING THAT SCHEME DOES NOT REACH.** x402's exact-Canton scheme
 * settles **Canton Coin only** ("`asset`: `\"CC\"`. Settles Canton Coin only", instrument fixed to
 * `Amulet`, via `transfer-factory`, relayed by a facilitator). Enterprise Canton is the rest: any
 * instrument, any synchronizer, DvP and fund and bond workflows, deployments with no facilitator and no
 * x402 at all. An overlay is the only carrier available there, and this rail exists so those deployments
 * are not asked to become Canton Coin payments to record a legal context.
 *
 * The two are separate bindings for the same reason EVM has three (`evm:x402`, `evm:escrow`, `evm:mpp`):
 * one chain, several carriers, and a manifest can honestly describe exactly one.
 *
 * There is **no `nativeField`** (the profile schema's iff rejects a `nativeField` on a non-native pattern,
 * and asserting one would misrepresent the rail).
 *
 * **weldGrades["lcp-anchor"] = "tx"** — the atrHash is committed by the buyer-submitted `create-LcpAnchor`
 * transaction, NOT by a detached signature over the atrHash bytes. The buyer is the Daml *signatory*, but
 * "signatory" here means the party authorizing the create command; the commitment rides the transaction,
 * not a message the buyer signs over the atrHash itself. Per LCP §8.3 / WLD-3 that is **tx-grade** (mirrors
 * the escrow `PreApproval` case, where a transaction — not a signature over the binding value — commits).
 *
 * **recovery.forwardIndexable = false** — HONEST. A participant `/v1/query` filtered on `atrHash` is a
 * lookup over ONE participant's active contract set, not a chain-global forward index. It is the
 * overlay-contract analogue of Solana's memo scan: the query exists, a native global index does not —
 * hence `indexing: "participant-query:LcpAnchor.atrHash"` and `forwardIndexable: false`.
 * **recovery.zeroPartyRecoverable = false** — and this is the one that reads counter-intuitively, so the
 * test is stated rather than assumed. §8.3 asks whether an auditor can reconstruct the atrHash **from the
 * settlement reference alone, without trusting either party to produce records**. On Canton they cannot.
 * `LcpAnchor`'s stakeholders are signatory = buyer and observer = seller (`constants.ts`, `anchor.ts`) —
 * the two transacting parties and nobody else — and Daml contract visibility is limited to stakeholders,
 * so `CantonParticipantConfig` requires a `bearerJwt` authenticating the READING party. A neutral verifier
 * holding only a settlement reference sees nothing until a party grants it access.
 *
 * The earlier `true` rested on "readable without either party's PRIVATE MATERIAL", which is a different
 * question: no private key is needed, but a party's cooperation is. §8.3 asks the second. This is the shape
 * §8.3.4 describes for Opaque Challenge — auditors need access to the service's store — and WLD-3 makes the
 * direction of the error normative: misrepresenting an advisory-grade binding as zero-party-recoverable is
 * non-conformance, while understating costs nothing. The neighbouring `forwardIndexable: false` was already
 * decided on exactly this reasoning; recoverability now matches it.
 *
 * **lifecycleStates = ["proposed", "anchored"]** — the Canton anchor flow: the seller
 * builds the settlement request (proposed), the buyer creates the `LcpAnchor` contract (anchored / active
 * on the participant); the verify path confirms the anchor is active, and its anchor-reference
 * builder speaks of the anchor — "anchored" names the LcpAnchor mechanism precisely.
 *
 * **finality.reversible = false** — an `LcpAnchor` contract is only ever archived by a NEW transaction
 * (Daml has no reversal); recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution.
 */
export const CANTON_MANIFEST: BindingManifest = {
  rail: "canton",
  pattern: "overlay-contract",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  },
  assetBinding: "none", // the LcpAnchor template carries the atrHash alone; recovery never observes what settled — the x402 sibling binding is "carried", and that is the real cost of an overlay
  successGate: "structural", // a Daml command that did not commit leaves no LcpAnchor; queries return ACTIVE contracts only
  indexing: "participant-query:LcpAnchor.atrHash",
  finality: {
    reversible: false,
    note: "an LcpAnchor contract is only ever archived by a NEW transaction (Daml has no reversal); recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "lcp-anchor": "tx" },
  lifecycleStates: ["proposed", "anchored"],
};
