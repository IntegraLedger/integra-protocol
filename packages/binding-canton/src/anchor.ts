/**
 * The `LcpAnchor` payload codec — PURE, no Daml SDK, no HTTP. This is the overlay-contract analogue of a
 * native-field codec: instead of packing the atrHash into a carrier byte field, it builds the `LcpAnchor`
 * contract-create payload (the atrHash carried as a `Text` field) and reads the atrHash back out of a
 * queried contract payload.
 *
 * The `Text` field stores the atrHash as **64-char lowercase hex WITHOUT the `0x` prefix** — this is the
 * form the deployed lcp-anchor DAR stores and the form a participant `/v1/query` filters on (ported from
 * the reference Canton client, which strips the prefix and lowercases before create and query). The
 * codec normalizes to and from the canonical LCP `0x`-prefixed atrHash at the package boundary.
 *
 * `buildAnchorPayload` fails LOUD on a malformed atrHash (fail-fast, at the source). `readAnchorAtrHash`
 * returns `null` for a payload that does not carry a well-formed atrHash, so a participant query can skip
 * a non-LCP contract without treating it as an error (mirrors binding-solana's decode → null).
 */
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";

/** The `LcpAnchor` contract payload — the on-ledger fields of the overlay contract. */
export interface LcpAnchorPayload {
  /** Daml party identifier of the buyer (the contract signatory). */
  buyer: string;
  /** Daml party identifier of the seller (the contract observer). */
  seller: string;
  /** The atrHash as 64-char lowercase hex, NO `0x` prefix (the on-ledger / query form). */
  atrHash: string;
  /** An optional opaque payment reference carried alongside the anchor (empty when unused). */
  paymentRef: string;
}

/** Strip a leading `0x`/`0X` if present. */
function stripHexPrefix(s: string): string {
  return /^0x/i.test(s) ? s.slice(2) : s;
}

/** The 64-char lowercase-hex, prefix-less on-ledger form of a canonical `0x`-prefixed atrHash. */
export function atrHashToLedgerText(atrHash: string): string {
  if (!isAtrHash(atrHash))
    throw new Error(
      `atrHashToLedgerText: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
    );
  return stripHexPrefix(atrHash).toLowerCase();
}

/** Recover a canonical `0x`-prefixed atrHash from an on-ledger `Text` field, or `null` if malformed. */
export function ledgerTextToAtrHash(text: string): `0x${string}` | null {
  const candidate = `0x${stripHexPrefix(text).toLowerCase()}`;
  return isAtrHash(candidate) ? (candidate as `0x${string}`) : null;
}

/**
 * Build the `LcpAnchor` create-command payload carrying `atrHash`. Throws on a malformed atrHash
 * (fail-fast) — never mint a contract whose anchor a verifier would reject.
 */
export function buildAnchorPayload(inputs: {
  buyer: string;
  seller: string;
  atrHash: string;
  paymentRef?: string;
}): LcpAnchorPayload {
  if (inputs.buyer.length === 0)
    throw new Error("buildAnchorPayload: buyer party is empty");
  if (inputs.seller.length === 0)
    throw new Error("buildAnchorPayload: seller party is empty");
  return {
    buyer: inputs.buyer,
    seller: inputs.seller,
    atrHash: atrHashToLedgerText(inputs.atrHash),
    paymentRef: inputs.paymentRef ?? "",
  };
}

/** Read the atrHash off a queried `LcpAnchor` payload, or `null` if it carries no well-formed atrHash. */
export function readAnchorAtrHash(
  payload: LcpAnchorPayload,
): `0x${string}` | null {
  return ledgerTextToAtrHash(payload.atrHash);
}

/** True iff `payload` anchors exactly `atrHash` (verification-time check). */
export function verifyAnchorAtrHash(inputs: {
  payload: LcpAnchorPayload;
  atrHash: string;
}): boolean {
  const anchored = readAnchorAtrHash(inputs.payload);
  if (anchored === null) return false;
  return atrHashEquals(anchored, inputs.atrHash);
}
