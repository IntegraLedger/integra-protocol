/**
 * Signed-acceptance verification (TRM-6) — PURE over an injected signature-verifier port, and rail-neutral
 * by construction: the record names its `scheme`, the injected port implements it, and a port refuses any
 * scheme it does not implement (fail closed). The EVM port (EOA EIP-191/712 and smart-account
 * ERC-1271/6492) is `binding-evm-common`'s; a new rail adds a port without touching this package. What is
 * verified HERE is the STRUCTURE and the ATA-4 commitment-vs-leaf containment; the cryptographic signature
 * check is the port's.
 */

import type { Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals } from "@integraledger/lcp-kernel";
import { type Bounds, isWithin } from "./bounds.js";

/**
 * Namespaced signature scheme, `<family>:<method>` — the family names the rail/ecosystem whose port
 * verifies it, the method names the signature format within it. Registered today:
 *
 *   `evm:eip191` · `evm:eip712` · `evm:erc1271` · `evm:erc6492`   (binding-evm-common)
 *
 * The set is OPEN: a new rail introduces its schemes with its port (`jose:ES256`, `solana:ed25519`, …)
 * with no change to this type. Fail-closed survives the openness because it lives in the port contract —
 * a verifier refuses schemes it does not implement, exactly as `isWithin` refuses bound dimensions it has
 * no semantics for. The namespace is mandatory: an un-namespaced scheme names no family, so no port is
 * answerable for it.
 */
export type AcceptanceScheme = `${string}:${string}`;

/** Structural guard for the scheme namespace (`<family>:<method>`, family colon-free, both non-empty). */
export function isAcceptanceScheme(v: string): v is AcceptanceScheme {
  const i = v.indexOf(":");
  return i > 0 && i < v.length - 1;
}

/**
 * What the signature covers. Registered today: `"atrHash"` (the raw 32-byte fingerprint signed directly —
 * rail-neutral) and `"eip712-acceptance-envelope"` (the EVM typed-data envelope, `binding-evm-common`).
 * Open for the same reason as `AcceptanceScheme`; a port refuses payload types it cannot reconstruct.
 */
export type PayloadType = string;

/** The TRM-6 acceptance record (matches vectors/authority/acceptance.schema.json). */
export interface SignedAcceptance {
  atrHash: `0x${string}`;
  /**
   * The accepting party's identifier IN THE SCHEME'S CANONICAL FORM — the scheme governs the format and
   * its port validates it: a 0x-address for `evm:*`, a key identifier (JWK thumbprint URI / kid) for a
   * JOSE family, a base58 public key for an ed25519 rail, a DID where a family defines one. Open here
   * because a rail-neutral core cannot enumerate every rail's identifier syntax without closing the set.
   */
  signer: string;
  scheme: AcceptanceScheme;
  signature: string;
  /** RFC 3339 — TRM-6's required timestamp (the signer-attested claim; PRS-4 corroborates independently). */
  signedAt: string;
  payloadType: PayloadType;
  grantRef?: string;
  elections?: { forum?: string; governingLaw?: string };
}

/** The signature-verification port — pure input, boolean out. binding-evm-common implements it. */
export interface SignatureVerifier {
  verify(acceptance: SignedAcceptance): Promise<boolean>;
}

/** ATA-4 second half: the accepted commitment must be contained by the leaf grant's bounds. */
export function commitmentWithinLeaf(
  commitment: Bounds,
  leafBounds: Bounds,
): boolean {
  return isWithin(commitment, leafBounds);
}

/**
 * The STRUCTURAL half of acceptance verification — PURE, chain-free, substrate-free: the acceptance must
 * bind `expectedAtrHash` (case-insensitive, ATR canon) and, when an ATA-4 commitment + leaf bounds are
 * supplied, the commitment must be contained by the leaf grant. This is the portable behavior the
 * conformance corpus certifies cross-implementation; the cryptographic signature gate is `binding-evm-common`'s
 * (EOA offline + smart-account on-chain) and is composed on top by `verifyAcceptance`.
 */
export function verifyAcceptanceStructure(
  acceptance: SignedAcceptance,
  expectedAtrHash: string,
  ata4?: { commitment: Bounds; leafBounds: Bounds },
): Outcome<SignedAcceptance> {
  // Decoded-byte comparison per LCP §2.5, which also makes this fail CLOSED on a malformed acceptance:
  // a value that is not an atrHash at all can no longer match an equally malformed expectation.
  if (!atrHashEquals(acceptance.atrHash, expectedAtrHash))
    return refuse(
      "acceptance/atrhash-mismatch",
      `acceptance binds ${acceptance.atrHash}, expected ${expectedAtrHash}`,
    );
  if (
    ata4 !== undefined &&
    !commitmentWithinLeaf(ata4.commitment, ata4.leafBounds)
  )
    return refuse(
      "acceptance/commitment-exceeds-grant",
      "the accepted commitment exceeds the leaf grant's bounds (ATA-4)",
    );
  return { ok: true, value: acceptance };
}

/**
 * Verify an acceptance binds `expectedAtrHash`, does not exceed the leaf grant (ATA-4), and has a valid
 * signature (via the port). Returns an `Outcome`: a `verification-failure` Refusal on any gate, else the
 * verified acceptance. The structural gates run first (fail before touching the chain), then the signature.
 */
export async function verifyAcceptance(
  acceptance: SignedAcceptance,
  expectedAtrHash: string,
  verifier: SignatureVerifier,
  ata4?: { commitment: Bounds; leafBounds: Bounds },
): Promise<Outcome<SignedAcceptance>> {
  const structural = verifyAcceptanceStructure(
    acceptance,
    expectedAtrHash,
    ata4,
  );
  if ("refused" in structural) return structural;
  if (!(await verifier.verify(acceptance)))
    return refuse(
      "acceptance/bad-signature",
      `signature did not verify for ${acceptance.signer} (${acceptance.scheme})`,
    );
  return { ok: true, value: acceptance };
}

function refuse(code: string, detail: string): Outcome<never> {
  return { refused: true, haltClass: "verification-failure", code, detail };
}
