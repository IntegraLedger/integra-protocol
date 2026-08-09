/**
 * The XRPL tx-memo atrHash codec — PURE, no XRPL SDK.
 *
 * On the XRP Ledger the atrHash is carried as the `MemoData` of a `Memo` on the buyer's native XRP
 * `Payment`. Every `Memo` sub-field is itself hex-encoded per the XRPL Memo spec, so:
 *   - `MemoData`   = the atrHash as **bare, upper-case, 64-char hex** (the 32 atrHash bytes, hex-encoded —
 *      NO `0x` prefix; the field IS the hex of the raw memo bytes, so the payload bytes ARE the atrHash);
 *   - `MemoType`   = `hex("lcp/atrHash")` — the LCP discriminator a scan matches on;
 *   - `MemoFormat` = `hex("application/octet-stream")`.
 *
 * `decodeLcpMemo` returns `null` for anything that is not a well-formed LCP atr memo (so a settlement
 * scan skips non-LCP memos without treating them as errors); `buildLcpMemo` fails LOUD on a malformed
 * atrHash. atrHash is any-case per ATR canon; the recovered value is normalised to `0x`-prefixed
 * lower-case (the shape the rest of the stack compares against).
 */
import { bytesToHex, hexToBytes } from "@integraledger/lcp-binding-core";
import {
  atrHashEquals,
  canonicalAtrHash,
  isAtrHash,
} from "@integraledger/lcp-kernel";

/** One XRPL `Memo` in transaction-JSON form (each sub-field is hex per the XRPL Memo spec). */
export interface XrplMemo {
  Memo: {
    MemoType?: string;
    MemoData: string;
    MemoFormat?: string;
  };
}

/** Strip a leading `0x`/`0X` (XRPL `MemoData` stores bare hex, no prefix). */
function stripHexPrefix(s: string): string {
  return /^0x/i.test(s) ? s.slice(2) : s;
}

/** Hex-encode an ASCII string into the bare-hex form the XRPL Memo spec expects (upper-case). */
function utf8ToHex(s: string): string {
  return bytesToHex(new TextEncoder().encode(s)).slice(2).toUpperCase();
}

/** The hex-encoded `MemoType` that marks a memo as the LCP atrHash memo. */
export const LCP_MEMO_TYPE_HEX: string = utf8ToHex("lcp/atrHash");
/** The hex-encoded `MemoFormat` (`application/octet-stream`). */
export const LCP_MEMO_FORMAT_HEX: string = utf8ToHex(
  "application/octet-stream",
);

/**
 * Build the LCP atrHash `Memo` the buyer attaches to their XRP `Payment`. Throws on a malformed atrHash
 * (fail-fast). `MemoData` is the bare, upper-case 64-char hex of the atrHash's 32 bytes.
 */
export function buildLcpMemo(atrHash: string): XrplMemo {
  if (!isAtrHash(atrHash))
    throw new Error(
      `buildLcpMemo: atrHash must be a 32-byte value (64 hex chars), got "${atrHash}"`,
    );
  const hash = stripHexPrefix(atrHash).toUpperCase();
  return {
    Memo: {
      MemoType: LCP_MEMO_TYPE_HEX,
      MemoData: hash,
      MemoFormat: LCP_MEMO_FORMAT_HEX,
    },
  };
}

/**
 * Decode a single `Memo` back to a `0x`-prefixed lower-case atrHash, or `null` if it is not a
 * well-formed LCP atr memo (wrong `MemoType`, or `MemoData` is not a 32-byte hex value).
 */
export function decodeLcpMemo(memo: XrplMemo): `0x${string}` | null {
  if (memo.Memo?.MemoType?.toUpperCase() !== LCP_MEMO_TYPE_HEX) return null;
  const data = memo.Memo.MemoData;
  if (typeof data !== "string") return null;
  const candidate = `0x${stripHexPrefix(data).toLowerCase()}`;
  if (!isAtrHash(candidate)) return null;
  return candidate as `0x${string}`;
}

/**
 * Recover the atrHash from a `Payment`'s `Memos` array (the first LCP memo that decodes wins), or `null`
 * if no LCP atr memo is present. Handles a missing/undefined `Memos` array (a scan skips it).
 */
export function readLcpMemoAtrHash(
  memos: ReadonlyArray<XrplMemo> | undefined,
): `0x${string}` | null {
  if (memos === undefined) return null;
  for (const m of memos) {
    const atr = decodeLcpMemo(m);
    if (atr !== null) return atr;
  }
  return null;
}

/** True iff `memos` carries exactly `atrHash` under the LCP memo binding (verification-time check). */
export function verifyLcpMemo(inputs: {
  memos: ReadonlyArray<XrplMemo> | undefined;
  atrHash: string;
}): boolean {
  const decoded = readLcpMemoAtrHash(inputs.memos);
  if (decoded === null) return false;
  return atrHashEquals(decoded, inputs.atrHash);
}

/**
 * The raw 32 memo bytes for `atrHash` (the payload `MemoData` hex-encodes). Exposed for callers that
 * need the byte form directly; throws on a malformed atrHash (fail-fast).
 */
export function atrHashMemoBytes(atrHash: string): Uint8Array {
  return hexToBytes(canonicalAtrHash(atrHash, "atrHashMemoBytes"));
}
