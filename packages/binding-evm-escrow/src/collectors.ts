/**
 * The Commerce Payments token collectors — the modular payer-authorization methods `authorize`/`charge`
 * pull funds through. Addresses are the deterministic base/commerce-payments deployments (identical on
 * Base Mainnet and Base Sepolia). Each carries its **weld grade** (per the manifest) and whether that
 * grade is **on-chain-proven** vs characterized-from-source.
 *
 * The ERC3009 collector's `collectorData` IS the payer's signature (the collector runs it through
 * `_handleERC6492Signature`, so a smart-wallet ERC-6492 sig works too) over the USDC
 * `ReceiveWithAuthorization` with `to = <the collector>`, `value = maxAmount`, `nonce =
 * getHash(paymentInfo with payer = 0)`. The signing itself is the money-path runtime's job
 * this package declares the collectors, their grades, and the policy.
 */
import type { Refusal, WeldGrade } from "@integraledger/lcp-binding-core";

/** The four Commerce Payments collectors — the payer-authorization methods funds are pulled through.
 *  Naming one is not the same as being able to USE it here: the shipped policy accepts only collectors
 *  whose weld grade is on-chain-proven, and today that is `ERC3009` alone. */
export type CollectorName =
  | "ERC3009"
  | "Permit2"
  | "SpendPermission"
  | "PreApproval";

/** One collector's declaration: where it is deployed, what weld grade it earns, and — separately —
 *  whether that grade has been PROVEN by an on-chain run rather than read off the pinned source.
 *  `proven: false` is not a doubt about the code; it records that nobody has watched it happen. */
export interface EscrowCollector {
  name: CollectorName;
  address: `0x${string}`;
  grade: WeldGrade;
  /** True iff the grade is proven by an on-chain run (not merely read from the pinned source). */
  proven: boolean;
}

/** The base/commerce-payments collector deployments (Base Mainnet == Base Sepolia, deterministic). */
export const COLLECTORS: Record<CollectorName, EscrowCollector> = {
  ERC3009: {
    name: "ERC3009",
    address: "0x0E3dF9510de65469C4518D7843919c0b8C7A7757",
    grade: "signature",
    proven: true,
  },
  Permit2: {
    name: "Permit2",
    address: "0x992476B9Ee81d52a5BdA0622C333938D0Af0aB26",
    grade: "signature",
    proven: false,
  },
  SpendPermission: {
    name: "SpendPermission",
    address: "0x8d9F34934dc9619e5DC3Df27D0A40b4A744E7eAa",
    grade: "signature",
    proven: false,
  },
  PreApproval: {
    name: "PreApproval",
    address: "0x1b77ABd71FCD21fbe2398AE821Aa27D1E6B94bC6",
    grade: "tx",
    proven: false,
  },
};

/** The `AuthCaptureEscrow` (Base Mainnet == Base Sepolia). */
export const AUTH_CAPTURE_ESCROW =
  "0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff" as const;

/** The declaration for one collector. Total over the union, so it cannot fail — the acceptability check
 *  is a separate call, and reaching a collector here is not permission to use it. */
export function getCollector(name: CollectorName): EscrowCollector {
  return COLLECTORS[name];
}

/**
 * Enforce a **signature-grade, on-chain-proven** collector policy (fail-fast, no silent tx-grade
 * fallback): refuse a `tx`-grade collector where signature-grade is required, and refuse a collector
 * whose grade is not yet on-chain-proven (only ERC3009 is). Returns a `policy-rejection` Refusal
 * or `null` when the collector is acceptable.
 */
export function assertSignatureGrade(name: CollectorName): Refusal | null {
  const c = COLLECTORS[name];
  if (c.grade !== "signature")
    return {
      refused: true,
      haltClass: "policy-rejection",
      code: "escrow/tx-grade-collector",
      detail: `collector ${name} is ${c.grade}-grade; a signature-grade weld is required (no silent tx-grade fallback)`,
    };
  if (!c.proven)
    return {
      refused: true,
      haltClass: "policy-rejection",
      code: "escrow/unproven-collector",
      detail: `collector ${name}'s grade is characterized-from-source but not on-chain-proven — prove it on-chain before use`,
    };
  return null;
}
