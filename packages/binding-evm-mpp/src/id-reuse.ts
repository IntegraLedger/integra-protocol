/**
 * MPP-EVM Id-Reuse (LCP §8.3.5): the host's derivation rule, the weld it produces, and the *only* kind of
 * check the resulting on-chain value permits.
 *
 * **THE HOST RULE, quoted.** `draft-evm-charge-00` §5.3.1 (paymentauth.org, read 2026-07-30):
 *
 *     nonce = keccak256(abi.encodePacked(challenge.id, challenge.realm))
 *
 * — with the accompanying sentence "This specification requires the nonce to be set to the `challengeHash`".
 * The nonce is therefore a *derivation*, not a slot: there is nothing here for LCP to occupy. What LCP does
 * instead is supply an input — the seller sets `challenge.id = atrHash` — so the host's own required
 * derivation carries the record into the settlement transaction.
 *
 * **WHAT MAKES THAT SOUND IS NOT UNIQUENESS, AND AN EARLIER DOCBLOCK SAID IT WAS.** It argued that MPP's
 * "Unique challenge identifier" requirement (`draft-httpauth-payment` §5.1.1) was satisfied by making each
 * ATR unique per transaction. Every citation in it was exact; the sufficiency was not. LCP v1.38 §C.1
 * (:1282-1289):
 *
 * > **It is not simply available, and §8.3.5's uniqueness advice is not sufficient for it.** MPP requires
 * > the server to bind the challenge `id` *to the challenge parameters* … expressly to prevent a client
 * > altering the challenge it presents. **Making each ATR unique per transaction satisfies uniqueness but
 * > not that binding.** A per-transaction ATR that itself states the transaction parameters (Section 6.1)
 * > satisfies both, because the parameters are then inside the hashed document; a terms document made
 * > unique by a timestamp alone does not.
 *
 * **THE REQUIREMENT IS ON THE ATR, AND THE TREE ALREADY VERIFIES IT.** This binding holds a hash, never the
 * document, so it cannot inspect what the ATR says — and it should not: where the ATR lives is the seller's
 * and buyer's business, and a rail binding that needed the document would assert a custody LCP does not
 * require. The property §C.1 asks for is **OFR**: the ATR's offer slot is bound, meaning the transaction
 * parameters are inside the hashed document. `verify` implements it as `offerBoundStep`
 * (`verify/src/composition.ts`) and requires it at **TC-4** (`verify/src/required.ts`). So a record whose
 * class is TC-4 has had this checked by the layer that holds the document; a record below TC-4 has not, and
 * the §8.3.5 discharge on this rail is only as good as that rung.
 *
 * The host is internally inconsistent here and the split is kept visible deliberately: the core draft
 * states the challenge-parameter binding as a **MUST** in the `id` field description and as a **SHOULD** in
 * its challenge-binding section. §C.1 names that inconsistency rather than resolving it, and so does this.
 *
 * **Zero-party-recoverable on-chain binding on this rail still requires an Overlay Contract per §8.3.2**
 * (§C.1:1289). Nothing here recovers an atrHash, and nothing may be added that does — see the closing note.
 *
 * **`abi.encodePacked` over two strings is raw UTF-8 concatenation** — no length prefix, no padding. That was
 * confirmed against Foundry's own encoder rather than assumed, and every oracle in
 * `vectors/binding/mpp-evm-id-reuse.json` was produced by two independent keccak-256 implementations,
 * neither of them the one used here.
 *
 * **The atrHash's SPELLING is part of the preimage.** The derivation hashes the id *as a string*, so
 * `0x7f83…` and `7f83…` are different challenge ids with different nonces. This module therefore canonicalizes
 * to LCP's own spelling — lowercase, `0x`-prefixed, 32 bytes — before deriving OR comparing, on both the
 * candidate and the observed nonce. An uppercase-hex spelling of the same bytes is a legal input that reaches
 * the same nonce, not a second wire convention: it is normalized, and the vectors pin that both ways round.
 * What is REJECTED is a value that is not 32 hex bytes at all — a missing `0x`, a wrong length, a non-hex
 * digit. Those are different challenge ids rather than spellings of this one, and there is no canonical form
 * to map them to.
 *
 * **Packed concatenation is undelimited, and the fixed length is what makes that safe.** `('ab','c')` and
 * `('a','bc')` pack identically; the vectors pin that as an observed property of the host rule. It is
 * unreachable for this binding because `challenge.id` is always exactly 66 characters, so no other split of
 * the preimage produces a legal id. The length check below is therefore load-bearing, not defensive noise.
 *
 * **NOTHING HERE RECOVERS AN atrHash, and no future edit may add such a path.** keccak-256 has no inverse:
 * the honest surface is confirmation of a candidate the auditor already holds. Re-deriving from a stored
 * challenge would be service-record recovery wearing the name of zero-party recovery, and would falsify
 * `zeroPartyRecoverable: false` in the manifest.
 */

import type { Outcome, Refusal } from "@integraledger/lcp-binding-core";
import { canonicalAtrHash } from "@integraledger/lcp-kernel";
import { concat, type Hex, keccak256, stringToBytes } from "viem";

/** A 32-byte value in the canonical lowercase-`0x` spelling this binding hashes and compares. */
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** The challenge the seller emits, and the nonce the buyer's authorization will therefore carry. */
export interface MppEvmChallengeBinding {
  /** `challenge.id` — the atrHash itself, in LCP's canonical lowercase `0x` spelling. */
  readonly challengeId: Hex;
  /** `challenge.realm` — MPP's protection space, the second half of the preimage. */
  readonly realm: string;
  /** The EIP-3009 nonce `keccak256(abi.encodePacked(id, realm))` requires. DERIVED, never chosen. */
  readonly nonce: Hex;
}

/** A candidate atrHash confirmed against a settlement's on-chain nonce. Confirmation, never recovery. */
export interface MppEvmCandidateConfirmation {
  readonly confirmed: true;
  /** The candidate that reproduced the on-chain nonce, canonicalized. */
  readonly atrHash: Hex;
  /** The protection space the derivation was performed under — the confirmation is scoped to it. */
  readonly realm: string;
  /** The on-chain nonce the candidate reproduced. */
  readonly nonce: Hex;
}

/**
 * MPP's derivation, exactly as its EVM method specifies it: `keccak256(abi.encodePacked(id, realm))`.
 *
 * Total over any two non-empty strings, because it implements MPP's rule and not an LCP-specific one — an
 * ordinary opaque challenge id derives here too, which is what makes this the host's function rather than
 * ours. THROWS on an empty id or realm: MPP requires both on every challenge (`realm` is a MUST per
 * §5.1.1), so an empty one is a wiring defect in the caller, not a value to hash.
 */
export function deriveChallengeHash(challengeId: string, realm: string): Hex {
  if (challengeId === "")
    throw new Error(
      "MPP challenge id must be non-empty — it is half the nonce preimage",
    );
  if (realm === "")
    throw new Error(
      "MPP realm must be non-empty — the core scheme makes realm a MUST on every challenge, and it is half the nonce preimage",
    );
  return keccak256(concat([stringToBytes(challengeId), stringToBytes(realm)]));
}

/**
 * The Id-Reuse weld at PROPOSAL time: `challenge.id = atrHash`, and the nonce that follows from it.
 *
 * THROWS on a malformed atrHash, via `canonicalAtrHash` — a seller welding a hash that is not 32 bytes is a
 * wiring defect, and the guard is also what keeps the fixed-length argument above true of the code.
 *
 * **Do not reach for `binding-evm-common`'s `assertBytes32` here.** It enforces the same 32 bytes but
 * explains them as the value that will "ride as the EIP-3009 nonce" — true on x402, false on this rail, and
 * precisely the cross-rail misreading `binding-evm-x402`'s KNOWN-BAD note exists to stop. On MPP-EVM the
 * atrHash rides `challenge.id` and the nonce is DERIVED from it, never occupied by it. `canonicalAtrHash`
 * states the shape requirement and nothing about where the value rides, which is why it is the right guard:
 * the rail-specific reasoning belongs in this docblock and in the manifest, not in an error string.
 */
export function bindAtrHash(
  atrHash: string,
  realm: string,
): MppEvmChallengeBinding {
  const challengeId = canonicalAtrHash(
    atrHash,
    "bindAtrHash",
    "on this rail it rides challenge.id and the EIP-3009 nonce is DERIVED from it (draft-evm-charge-00 §5.3.1), never occupied by it",
  ) as Hex;
  return { challengeId, realm, nonce: deriveChallengeHash(challengeId, realm) };
}

/**
 * Confirm a candidate atrHash against the `AuthorizationUsed` nonces ONE settlement emitted.
 *
 * The auditor brings the atrHash (from the record, or from `legal-context.json`); the chain confirms it.
 * Refusals rather than throws, because both the candidate and the observed nonces are data under audit —
 * the realm is not: it is the verifier's own configuration, so an empty one throws.
 *
 * Every observed nonce is validated BEFORE any is matched: a malformed entry refuses loudly instead of being
 * skipped past, because silently narrowing a settlement view could turn "this transaction is not what you
 * think" into "no match found".
 */
export function checkCandidate(
  atrHash: string,
  realm: string,
  observedNonces: readonly string[],
): Outcome<MppEvmCandidateConfirmation> {
  if (!BYTES32.test(atrHash))
    return {
      refused: true,
      haltClass: "verification-failure",
      code: "mpp-evm/candidate-malformed",
      detail: `a candidate atrHash must be a 0x-prefixed 32-byte value to be a legal MPP challenge id, got "${atrHash}"`,
    };
  for (const observed of observedNonces)
    if (!BYTES32.test(observed))
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "mpp-evm/nonce-malformed",
        detail: `an observed EIP-3009 nonce must be a 0x-prefixed 32-byte value, got "${observed}"`,
      };
  if (observedNonces.length === 0)
    return {
      refused: true,
      haltClass: "verification-failure",
      code: "mpp-evm/no-settlement-event",
      detail:
        "no EIP-3009 AuthorizationUsed nonce was observed for this settlement — there is nothing to verify against",
    };
  const candidate = canonicalAtrHash(atrHash, "checkCandidate") as Hex;
  const nonce = deriveChallengeHash(candidate, realm);
  const matched = observedNonces.find((o) => o.toLowerCase() === nonce);
  if (matched === undefined)
    return {
      refused: true,
      haltClass: "verification-failure",
      code: "mpp-evm/candidate-mismatch",
      detail: `no observed nonce equals keccak256(packed("${candidate}", "${realm}")) = ${nonce}`,
    };
  return {
    ok: true,
    value: { confirmed: true, atrHash: candidate, realm, nonce },
  };
}

/**
 * The refusal recovery always returns, stated in one place so the reason travels with the code.
 *
 * Not a "not implemented yet" and not a gap to be filled: the on-chain value is a hash over the atrHash, so
 * there is no function from settlement to atrHash to write. A caller wanting the record must bring the
 * candidate and use `verifyCandidate`.
 */
export function notRecoverableByConstruction(): Refusal {
  return {
    refused: true,
    haltClass: "verification-failure",
    code: "mpp-evm/not-recoverable-by-construction",
    detail:
      "MPP-EVM is an Id-Reuse binding (LCP §8.3.5): the on-chain EIP-3009 nonce is keccak256 over the atrHash and the realm, so no atrHash can be recovered from a settlement — bring the candidate atrHash and use verifyCandidate",
  };
}
