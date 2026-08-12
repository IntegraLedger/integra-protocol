/**
 * The SPL-Memo atrHash codec — PURE, no Solana SDK. The atrHash is carried as the data of a Memo-program
 * instruction. Two encodings:
 *   - "hex" (CANONICAL) — the 0x-prefixed lowercase hex STRING as UTF-8 ASCII (human-readable on Solscan;
 *      the per-chain binding table's "0x-prefixed ASCII hex of atrHash");
 *   - "raw" — the 32 raw bytes (smaller; only where every verifier parses the memo as bytes).
 * `decodeSplMemo` returns null for anything that is not a well-formed atr memo (so a settlement scan can
 * skip non-LCP memos without treating them as errors); `encodeSplMemo` fails LOUD on a malformed atrHash.
 */
import { bytesToHex, hexToBytes } from "@integraledger/lcp-binding-core";
import {
  atrHashEquals,
  canonicalAtrHash,
  isAtrHash,
} from "@integraledger/lcp-kernel";

/** Which of the two memo forms to WRITE. `"hex"` is canonical and the default — the 0x-prefixed lowercase
 *  hex string as ASCII, which renders readably in a block explorer. `"raw"` is the 32 bytes, half the
 *  size, and only safe where every verifier reads the memo as bytes. `decodeSplMemo` needs to be TOLD
 *  which form to read; the adapter's recovery path is what tries `"hex"` then `"raw"` on your behalf. */
export type MemoEncoding = "hex" | "raw";

/** Build the Memo-instruction data bytes carrying `atrHash`. Throws on a malformed atrHash (fail-fast). */
export function encodeSplMemo(
  atrHash: string,
  encoding: MemoEncoding = "hex",
): Uint8Array {
  const canonical = canonicalAtrHash(atrHash, "encodeSplMemo");
  if (encoding === "raw") return hexToBytes(canonical);
  return new TextEncoder().encode(canonical);
}

/** Decode Memo-instruction data back to an atrHash, or `null` if it is not a well-formed atr memo. */
export function decodeSplMemo(
  memoData: Uint8Array,
  encoding: MemoEncoding = "hex",
): `0x${string}` | null {
  if (encoding === "raw") {
    if (memoData.length !== 32) return null;
    return bytesToHex(memoData) as `0x${string}`;
  }
  const text = new TextDecoder().decode(memoData);
  if (!isAtrHash(text)) return null;
  return text.toLowerCase() as `0x${string}`;
}

/** True iff `memoData` carries exactly `atrHash` under `encoding` (verification-time check). */
export function verifySplMemo(inputs: {
  memoData: Uint8Array;
  atrHash: string;
  encoding?: MemoEncoding;
}): boolean {
  const decoded = decodeSplMemo(inputs.memoData, inputs.encoding ?? "hex");
  if (decoded === null) return false;
  return atrHashEquals(decoded, inputs.atrHash);
}
