/**
 * The two mandatory x402 checks.
 *
 * 1. **Asset-transfer-method filter.** The atrHash-as-nonce weld rides ONLY on EIP-3009
 *    `transferWithAuthorization`, whose `nonce` is a payer-controlled 32-byte field committed on-chain in
 *    `AuthorizationUsed`. x402's `exact` scheme on EVM defines **three** methods, verified at
 *    `x402-foundation/x402@1fec3aa04e41`:
 *
 *      1. `eip3009`  — tokens with native `transferWithAuthorization` (the default when `extra` omits it)
 *      2. `permit2`  — tokens without it, via a proxy and the canonical Permit2 contract
 *      3. `erc7710`  — smart accounts with delegation support
 *
 *    Only the first exposes a payer-controlled nonce. Under `permit2` the value rides an off-chain EIP-712
 *    witness, and under `erc7710` the payment is authorized by a delegation the payer's smart account
 *    granted — in neither case is there a 32-byte field on the settlement for the weld to occupy. An offer
 *    requesting either would settle a payment that silently DROPS the binding, so this refuses instead.
 *
 *    The rule is not Permit2-specific and the naming here is deliberate: it is "the method must be the one
 *    that carries a payer nonce". A refusal naming only one of the two rejected methods would report a
 *    correct decision for the wrong reason, which is what an operator then debugs.
 *
 *    The settlement-side spender/witness proxy detection is the on-chain extension that lands once a
 *    harness run closes it; it is NOT fabricated here.
 *
 * 2. **Payment-flow filter.** x402 §6.1 defines three flows and reserves `extra.paymentFlow` as a
 *    protocol key: `authorization` (verify → resource → settle), `upfront` (settle → resource) and
 *    `escrow` (settle → resource → settle). "When the resolved payment flow is not `authorization`,
 *    `PaymentRequired` `accepts[].extra.paymentFlow` MUST be present", and "Clients MUST NOT construct a
 *    payment for a `paymentFlow` they do not recognize."
 *
 *    This weld survives `upfront` untouched — one settlement, one EIP-3009 authorization, one nonce.
 *
 *    `escrow` settles TWICE, and the scheme's own table marks `eip3009` "One-time use", so a single nonce
 *    cannot carry both the deposit and the final charge. **That is a statement about THIS carrier, not a
 *    judgement about the flow.** A two-phase settlement is exactly the case the record is supposed to
 *    survive, and there is a binding for it: `@integraledger/lcp-binding-evm-escrow` welds
 *    `PaymentInfo.salt`, which is recoverable from BOTH the authorization and the capture artifact and
 *    joins them on `paymentInfoHash`. So this answers "not this binding, that one" and names it — it does
 *    not tell a deployment how to transact, which is not this project's business.
 *
 * 3. **Inbound `nonce == atrHash` re-challenge.** The seller-side verification that a presented
 *    authorization's nonce equals the atrHash it advertised. The primitive lives here; the re-challenge
 *    orchestration (re-issue the 402 on mismatch) belongs to the seller surface.
 */

import type { Outcome, Refusal } from "@integraledger/lcp-binding-core";
import { atrHashEquals } from "@integraledger/lcp-kernel";

/** The x402 asset-transfer method an offer may request. Only `eip3009` carries the payer nonce. */
export const EIP3009_TRANSFER_METHOD = "eip3009";

/**
 * The methods x402's exact-EVM scheme defines, in the scheme's own order. Listed so the refusal can say
 * whether it met a method the host defines or one nobody does — a typo and an unsupported-but-real method
 * are different problems for the operator reading the message.
 */
export const X402_TRANSFER_METHODS: readonly string[] = [
  "eip3009",
  "permit2",
  "erc7710",
];

/**
 * Refuse an asset-transfer method that carries no payer nonce. Returns a typed `policy-rejection`
 * `Refusal` when the method is present and not `eip3009`; `null` when it is absent or `eip3009` (proceed).
 *
 * Absent is `null` because x402's scheme says so: "If no `assetTransferMethod` is specified in
 * `PaymentRequired.extra`, clients should default to `eip3009`."
 */
export function filterAssetTransferMethod(
  assetTransferMethod: string | undefined,
): Refusal | null {
  if (
    assetTransferMethod === undefined ||
    assetTransferMethod === EIP3009_TRANSFER_METHOD
  )
    return null;
  const known = X402_TRANSFER_METHODS.includes(assetTransferMethod);
  return {
    refused: true,
    haltClass: "policy-rejection",
    code: "x402/asset-transfer-method-unsupported",
    detail: `the atrHash weld requires the eip3009 asset-transfer method, whose payer-controlled nonce carries it; got "${assetTransferMethod}"${
      known
        ? " — a method x402 defines, but one that exposes no 32-byte payer field for the weld"
        : " — not a method x402's exact-EVM scheme defines (eip3009, permit2, erc7710)"
    }. Refusing rather than settling unwelded.`,
  };
}

/** The x402 payment flows, §6.1. `authorization` is the default when `extra.paymentFlow` is omitted. */
export const X402_PAYMENT_FLOWS: readonly string[] = [
  "authorization",
  "upfront",
  "escrow",
];

/**
 * Report a payment flow this weld cannot ride. `null` means proceed.
 *
 * Absent is `null` because §6.1 makes `authorization` the resolved default, and it is also the flow whose
 * ordering the rest of this package assumes: verify → resource → settle.
 *
 * The `escrow` answer is a ROUTING answer, not a policy one. Which settlement shape a party chooses is
 * theirs; what this project owes them is a record that survives it, and for two-phase settlement that
 * record is `binding-evm-escrow`'s, not this one's.
 */
export function filterPaymentFlow(
  paymentFlow: string | undefined,
): Refusal | null {
  if (paymentFlow === undefined || paymentFlow === "authorization") return null;
  if (paymentFlow === "upfront") return null;
  const known = X402_PAYMENT_FLOWS.includes(paymentFlow);
  return {
    refused: true,
    haltClass: "policy-rejection",
    code: known
      ? "x402/weld-not-carried-by-this-binding"
      : "x402/payment-flow-unrecognized",
    detail: known
      ? `the escrow payment flow settles twice (settle -> resource -> settle) and x402 marks eip3009 "One-time use", so this binding's nonce can carry only one of the two. Use @integraledger/lcp-binding-evm-escrow for a two-phase settlement: it welds PaymentInfo.salt, which is recoverable from BOTH the authorization and the capture artifact and joins them on paymentInfoHash. Which settlement shape you use is your choice; this is about which binding carries the record across it.`
      : `unrecognized x402 paymentFlow "${paymentFlow}" — §6.1 defines ${X402_PAYMENT_FLOWS.join(", ")}, and clients MUST NOT construct a payment for a flow they do not recognize`,
  };
}

/**
 * The inbound re-challenge: does a presented authorization nonce equal the advertised atrHash?
 * Compared as DECODED BYTES per LCP §2.5, so the two any-case spellings of one hash agree; returns the
 * lowercased nonce on match, else a `verification-failure`
 * `Refusal` (the caller re-issues the 402 — never settles an unwelded payment).
 */
export function verifyInboundNonce(
  presentedNonce: string,
  expectedAtrHash: string,
): Outcome<`0x${string}`> {
  // Decoded-byte comparison per LCP §2.5. Fails CLOSED: a presented nonce that is not a well-formed
  // atrHash is refused rather than case-folded into a string match against a malformed expectation.
  if (!atrHashEquals(presentedNonce, expectedAtrHash))
    return {
      refused: true,
      haltClass: "verification-failure",
      code: "x402/nonce-mismatch",
      detail: `presented nonce ${presentedNonce} does not equal the advertised atrHash ${expectedAtrHash}`,
    };
  return { ok: true, value: presentedNonce.toLowerCase() as `0x${string}` };
}
