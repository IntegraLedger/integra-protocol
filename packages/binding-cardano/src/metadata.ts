/**
 * The Cardano LCP-metadata atrHash codec — PURE, no chain SDK, no CBOR library dependency.
 *
 * The atrHash rides a dedicated LCP transaction-metadata label (see constants.ts — label 8847, the
 * dedicated label that replaces the CIP-20 674 piggyback). The label's value is a Cardano
 * `transaction_metadatum` **text-keyed map** `{ atrHash: <bare-hex>, v: <lcp-version> }`, exactly as the
 * reference implementation builds and reads it:
 *   - `atrHash` — bare lowercase hex, NO `0x` prefix, exactly 64 chars (32 bytes). This IS the atrHash.
 *     64 hex chars = 64 bytes = exactly Cardano's per-string 64-byte metadatum limit, so it fits in a
 *     single text chunk (no CIP-20 chunking needed; a `0x`-prefixed form would be 66 bytes and OVERFLOW,
 *     which is why the on-chain value is bare hex).
 *   - `v` — the LCP spec version (e.g. "0.1.38"), a short text string.
 *
 * The CBOR here is HAND-ROLLED (restricted to the narrow subset this
 * one metadatum needs: text, uint-length-prefixed map) to the canonical-CBOR rules (RFC 8949 §4.2.1):
 * shortest-length encoding, definite-length map, keys ordered by encoded length then bytewise lex. It
 * emits ONLY the label-value metadatum (the `{ v, atrHash }` map), which is the binding-relevant unit —
 * `propose` returns it and `recover` reads it. Building the full tx auxiliary_data (tag-259 wrapping
 * `{ 0: { 8847: <this> } }`, the blake2b aux_data_hash, and the tx body) is integration-only and does NOT
 * belong in the protocol codec. The exact bytes of this metadatum are cross-checked byte-for-byte against
 * an independent CBOR oracle in the vector test (`vectors/binding/cardano-metadatum.json`).
 *
 * `decode*` returns `null` for anything that is not a well-formed LCP metadatum, so a settlement scan can
 * skip non-LCP metadata without treating it as an error; `encode*` fails LOUD on a malformed atrHash.
 */
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";

// ── Minimal canonical-CBOR primitives (hand-rolled; no library dep) ──────────────────────────────

/** Encode a header byte + optional length bytes for a CBOR major type (RFC 8949 §3, shortest form). */
function majorHeader(majorType: number, n: number): number[] {
  if (n < 0) throw new Error("cbor: negative length");
  const tag = majorType << 5;
  if (n < 24) return [tag | n];
  if (n < 0x100) return [tag | 24, n];
  if (n < 0x10000) return [tag | 25, (n >> 8) & 0xff, n & 0xff];
  // The LCP metadatum never needs 4-byte lengths (keys + 64-byte values are all < 0x10000), so we stop
  // here and fail loud rather than carry unused encoding paths (dead-code / fail-fast).
  throw new Error(`cbor: length ${n} exceeds the LCP metadatum encoding range`);
}

/** Encode a CBOR text string (major 3). Enforces Cardano's 64-byte per-string metadatum limit. */
function encText(s: string): number[] {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 64)
    throw new Error(
      `cbor: text string exceeds Cardano's 64-byte metadatum limit (${bytes.length} bytes: "${s.slice(0, 30)}…")`,
    );
  return [...majorHeader(3, bytes.length), ...bytes];
}

/**
 * Canonical-CBOR of the LCP label value — a text-keyed map `{ atrHash, v }`, keys ordered by encoded
 * length then bytewise (RFC 8949 §4.2.1). `"v"` (1-byte text) sorts before `"atrHash"` (7-byte text), so
 * the on-chain, canonical key order is `v` then `atrHash` — matching the reference `encMetadatum`
 * sort. Returns the metadatum bytes.
 */
export function encodeLcpMetadatum(fields: {
  atrHash: string;
  v: string;
}): Uint8Array {
  const bareHash = normalizeBareHash(fields.atrHash);
  if (!fields.v)
    throw new Error("encodeLcpMetadatum: v (LCP version) is required");
  // map(2), then the two pairs in canonical key order: v (short key) before atrHash (long key).
  const out: number[] = [
    ...majorHeader(5, 2),
    ...encText("v"),
    ...encText(fields.v),
    ...encText("atrHash"),
    ...encText(bareHash),
  ];
  return Uint8Array.from(out);
}

// ── atrHash ⇄ Cardano metadata value ────────────────────────────────────────────────────────────

/**
 * Normalize an atrHash to the on-chain bare-hex form (lowercase, no `0x`, 64 chars). Throws if malformed.
 * Accepts either a lowercase-`0x`-prefixed atrHash OR the already-normalized bare-hex form, so it is
 * idempotent: the
 * `propose` path calls `buildLcpMetadataValue` (which strips `0x`) THEN `encodeLcpMetadatum` (which
 * re-normalizes the bare value) — both must validate the same value without a double-prefix requirement.
 */
function normalizeBareHash(atrHash: string): string {
  const prefixed = atrHash.startsWith("0x") ? atrHash : `0x${atrHash}`;
  if (!isAtrHash(prefixed))
    throw new Error(
      `atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
    );
  return prefixed.slice(2).toLowerCase();
}

/** The JSON shape of the LCP label value as Blockfrost returns it under `json_metadata`. */
export interface LcpMetadataValue {
  /** LCP spec version this binding conforms to (e.g. "0.1.38"). */
  v: string;
  /** atrHash as bare lowercase hex (no 0x), 64 chars. */
  atrHash: string;
}

/**
 * Build the LCP label value object (Blockfrost `json_metadata` shape). Throws on a malformed atrHash
 * (fail-fast). This is the JSON view; `encodeLcpMetadatum` is the on-chain CBOR view of the same value.
 */
export function buildLcpMetadataValue(
  atrHash: string,
  v: string,
): LcpMetadataValue {
  if (!v) throw new Error("buildLcpMetadataValue: v (LCP version) is required");
  return { v, atrHash: normalizeBareHash(atrHash) };
}

/**
 * Recover the 0x-prefixed atrHash from an LCP label value object, or `null` if it is not a well-formed
 * LCP metadatum (so a metadata scan skips non-LCP entries rather than erroring). Accepts any-case hex
 * DIGITS and a stray lowercase `0x` prefix (defensive against a non-canonical writer), but the prefix
 * itself must be lowercase: `isAtrHash` is the ATR canon, and it rejects `0X` — the same rule the
 * carrier corpus pins with its uppercase-0X reject vector.
 */
export function decodeLcpMetadataValue(value: unknown): `0x${string}` | null {
  if (value === null || typeof value !== "object") return null;
  const hash = (value as Record<string, unknown>)["atrHash"];
  if (typeof hash !== "string") return null;
  const candidate = hash.startsWith("0x") ? hash : `0x${hash}`;
  if (!isAtrHash(candidate)) return null;
  return candidate.toLowerCase() as `0x${string}`;
}

/** A single Blockfrost tx-metadata array entry (`GET /txs/{hash}/metadata`). */
export interface BlockfrostMetadataEntry {
  label: string;
  json_metadata: unknown;
}

/**
 * Extract the 0x-prefixed atrHash from a Blockfrost tx-metadata array (the recover boundary), or `null`
 * if no LCP-label entry carries a well-formed atrHash.
 */
export function recoverAtrHashFromMetadata(
  metadata: readonly BlockfrostMetadataEntry[] | null | undefined,
  label: number,
): `0x${string}` | null {
  if (!metadata) return null;
  const entry = metadata.find((m) => m.label === String(label));
  if (entry === undefined) return null;
  return decodeLcpMetadataValue(entry.json_metadata);
}

/** True iff `value` carries exactly `atrHash` (verification-time check). */
export function verifyAtrMetadata(inputs: {
  value: unknown;
  atrHash: string;
}): boolean {
  const decoded = decodeLcpMetadataValue(inputs.value);
  if (decoded === null) return false;
  return atrHashEquals(decoded, inputs.atrHash);
}
