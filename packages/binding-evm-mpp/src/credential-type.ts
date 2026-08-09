/**
 * MPP's EVM method offers FOUR credential types, and this binding can read exactly one of them off a chain.
 * That asymmetry is what this module exists to say out loud, because the alternative is a wrong answer.
 *
 * `draft-evm-charge-00` (paymentauth.org, read 2026-07-30), §5:
 *
 * - **§5.3 `authorization`** — the client signs an EIP-3009 `transferWithAuthorization` message whose `nonce`
 *   §5.3.1 REQUIRES to be the `challengeHash`. The derived value is therefore *on-chain*: the token emits
 *   `AuthorizationUsed(authorizer, indexed nonce)` and §8 consumes it ("The nonce is consumed on-chain by the
 *   token contract itself"). **This is the only credential type this binding can confirm against.**
 * - **§5.2 `permit2`** — the RECOMMENDED type (§5.2: "The RECOMMENDED credential type"). It carries the SAME
 *   `challengeHash`, but inside the EIP-712 `PaymentWitness` struct the client signs; §10.4 places it "in the
 *   EIP-712 witness data (Permit2)". It never reaches calldata or a log, so a verifier holding only the
 *   transaction cannot read it. Settlement goes through Permit2's `permitWitnessTransferFrom`, which moves the
 *   token — an ERC-20 `Transfer` and no `AuthorizationUsed`.
 * - **§5.4 `transaction`** and **§5.5 `hash`** — plain ERC-20 transfers with no challenge binding at all;
 *   §10.4 says they "provide weaker challenge binding than Permit2 credentials" and that the server "cannot
 *   prove the payment was created for a specific challenge instance". Again a `Transfer`, no `AuthorizationUsed`.
 *
 * **So the absence of `AuthorizationUsed` has two possible meanings, and they are not the same answer.** If
 * the configured token did not move either, the transaction settled none of this asset — a true and useful
 * report. If the token DID move, the transaction settled and this binding simply cannot read its credential
 * binding; reporting that as an absence would be a silent wrong answer at a verification boundary. Hence the
 * refusal below, which names the credential type rather than the missing event.
 *
 * The `did the asset move` predicate itself is NOT here — it is `assetWasTransferred` in
 * `binding-evm-common`, because binding-evm-x402 asks the identical question about its own unreadable path
 * (the Permit2 fallback) and two copies of one predicate is how the two rails drift apart. What stays here
 * is the part that is genuinely MPP's: which of MPP's four credential types the caller is looking at, and
 * the refusal that says so.
 */
import type { Refusal } from "@integraledger/lcp-binding-core";

/**
 * The refusal for a settlement this binding cannot read: the token moved, and no EIP-3009 authorization
 * accompanied it.
 *
 * Stated as a refusal rather than a throw because it is a fact about data under audit, not a wiring defect —
 * a seller choosing MPP's RECOMMENDED credential type has done nothing wrong, and the verifier needs to be
 * told which of MPP's four modes it is looking at, not handed an exception.
 */
export function notAuthorizationCredentialType(asset: string): Refusal {
  return {
    refused: true,
    haltClass: "verification-failure",
    code: "mpp-evm/not-authorization-credential-type",
    detail: `token ${asset} was transferred by this settlement but it emitted no EIP-3009 AuthorizationUsed — MPP's permit2 (§5.2, the RECOMMENDED type), transaction (§5.4) and hash (§5.5) credential types keep the challengeHash off-chain or bind no challenge at all, and only the opt-in authorization type (§5.3) puts it in the on-chain nonce, so this settlement carries no on-chain value a candidate atrHash could be confirmed against`,
  };
}
