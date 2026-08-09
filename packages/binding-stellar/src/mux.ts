/**
 * The CAP-67 muxed-address atrHash codec — the honest heart of the Stellar binding. Ported from the proven
 * reference mux codec, restricted to the single canonical scheme `mux_id = atrHash[:8]`
 * (project_stellar_mux_prefix8_audit — the HMAC variant is deliberately NOT ported; it trades the wanted
 * auditability for unwanted per-seller unlinkability).
 *
 * ★ CONFIRM-NOT-RECOVER. A CAP-67 muxed id is exactly 8 bytes. `mux_id = atrHash[:8]` therefore carries
 * only the FIRST 8 bytes of the 32-byte atrHash on-chain — the full hash does NOT fit. So this module can:
 *   - DERIVE the 8-byte prefix from a known atrHash (`deriveMuxId`);
 *   - ENCODE/DECODE a CAP-67 M-address (`encodeMuxedAddress` / `decodeMuxedAddress`), round-tripping the
 *     8-byte id;
 *   - CONFIRM that a known atrHash's prefix-8 equals an M-address's on-chain mux id (`verifyMuxedBinding`).
 * It CANNOT recover the full atrHash from a settlement alone — the settlement holds 8 bytes, not 32. The
 * full atrHash is obtained off-chain from `extensions.legalContext.info`; the on-chain mux id is the public match
 * check, not the source of the hash. `recoverMuxIdPrefix8` returns exactly those 8 bytes, labelled as a
 * prefix — never a `0x…64hex` value that would falsely read as a full atrHash.
 */
import { hexToBytes } from "@integraledger/lcp-binding-core";
import {
  bytesEqual,
  canonicalAtrHash,
  isAtrHash,
} from "@integraledger/lcp-kernel";
import { StrKey } from "@stellar/stellar-sdk";
import { MUX_ID_BYTES } from "./constants.js";

/** Derive the 8-byte mux id from a known atrHash: `mux_id = atrHash[:8]`. Throws on a malformed atrHash
 *  (fail-fast). Pure — no SDK. */
export function deriveMuxId(atrHash: string): Uint8Array {
  return hexToBytes(canonicalAtrHash(atrHash, "deriveMuxId")).slice(
    0,
    MUX_ID_BYTES,
  );
}

/** Encode a base G-pubkey (StrKey) + 8-byte mux id as a 69-character CAP-67 M-address. Throws on a
 *  wrong-length mux id (fail-fast). */
export function encodeMuxedAddress(
  basePubkey: string,
  muxId: Uint8Array,
): string {
  if (muxId.length !== MUX_ID_BYTES)
    throw new Error(
      `encodeMuxedAddress: mux id must be exactly ${MUX_ID_BYTES} bytes, got ${muxId.length}`,
    );
  const baseBytes = StrKey.decodeEd25519PublicKey(basePubkey);
  const combined = new Uint8Array(32 + MUX_ID_BYTES);
  combined.set(
    new Uint8Array(
      baseBytes.buffer,
      baseBytes.byteOffset,
      baseBytes.byteLength,
    ),
    0,
  );
  combined.set(muxId, 32);
  return StrKey.encodeMed25519PublicKey(Buffer.from(combined));
}

/** The decoded parts of a CAP-67 M-address: the base G-pubkey and the 8-byte mux id prefix. */
export interface DecodedMuxedAddress {
  basePubkey: string;
  muxId: Uint8Array;
}

/** Decode a CAP-67 M-address into its base G-pubkey and 8-byte mux id. Returns `null` for anything that is
 *  not a valid M-address (so a settlement scan skips a non-muxed destination without treating it as an
 *  error — mirrors the codec's null-vs-throw convention). */
export function decodeMuxedAddress(mAddr: string): DecodedMuxedAddress | null {
  if (!StrKey.isValidMed25519PublicKey(mAddr)) return null;
  const bytes = StrKey.decodeMed25519PublicKey(mAddr);
  const muxId = new Uint8Array(MUX_ID_BYTES);
  muxId.set(bytes.subarray(32, 32 + MUX_ID_BYTES));
  return {
    basePubkey: StrKey.encodeEd25519PublicKey(bytes.subarray(0, 32)),
    muxId,
  };
}

/** Recover the 8-byte mux id PREFIX from a settlement's CAP-67 M-address. This is the ONLY thing on-chain —
 *  it is `atrHash[:8]`, NOT the full atrHash. Returned as raw 8 bytes (never a `0x…64hex` value that would
 *  read as a full hash). `null` if the address is not a valid M-address. */
export function recoverMuxIdPrefix8(mAddr: string): Uint8Array | null {
  const decoded = decodeMuxedAddress(mAddr);
  return decoded === null ? null : decoded.muxId;
}

/** CONFIRM (not recover): does a known atrHash's prefix-8 equal the mux id carried by `mAddr`? This is the
 *  primary honest surface — an observer holding the atrHash checks the on-chain destination binds to it.
 *  `false` for a non-M-address or a malformed atrHash (never throws on those; fail-CLOSED). */
export function verifyMuxedBinding(inputs: {
  muxedM: string;
  atrHash: string;
}): boolean {
  if (!isAtrHash(inputs.atrHash)) return false;
  const onChain = recoverMuxIdPrefix8(inputs.muxedM);
  if (onChain === null) return false;
  return bytesEqual(onChain, deriveMuxId(inputs.atrHash));
}
