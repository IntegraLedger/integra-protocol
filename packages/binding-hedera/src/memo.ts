/**
 * The Hedera transaction-memo atrHash codec — PURE, no @hashgraph/sdk. The atrHash is carried as the
 * ASCII text of an HTS `TransferTransaction.transactionMemo`.
 *
 * Encoding: the CANONICAL LCP atrHash form — the `0x`-prefixed lowercase hex STRING as UTF-8 ASCII
 * (66 bytes = "0x" + 64 hex; well within Hedera's 100-byte memo ceiling). This is the same on-the-wire
 * shape as the Solana SPL-Memo binding's canonical "hex" encoding and is directly human-readable on
 * HashScan / Mirror Node (which returns the memo as `memo_base64` → these bytes).
 *
 * (Note: an earlier Hedera implementation wrote a *bare* 64-hex memo, no `0x` prefix. That was a
 * demo detail; this protocol package standardizes on the canonical `0x`-prefixed atrHash so `isAtrHash`
 * is the single validator across every rail — no per-rail hex-casing rules.)
 *
 * `decodeMemoAtrHash` returns null for anything that is not a well-formed atr memo (so a Mirror Node scan
 * can skip non-LCP memos without treating them as errors); `encodeMemoAtrHash` fails LOUD on a malformed
 * atrHash (fail-fast — never emit a memo we could not later validate).
 */
import { isMppAttributionValue } from "@integraledger/lcp-binding-core";
import {
  atrHashEquals,
  canonicalAtrHash,
  isAtrHash,
} from "@integraledger/lcp-kernel";
import { HEDERA_MEMO_MAX_BYTES } from "./constants.js";

/**
 * Build the `transactionMemo` string carrying `atrHash`. Throws on a malformed atrHash (fail-fast), and on
 * one that collides with MPP's Attribution tag — see `decodeMemoAtrHash`. Writing a memo this rail would
 * later refuse to read is silent data loss: the settlement would confirm, and the reference in it would be
 * unrecoverable forever.
 */
export function encodeMemoAtrHash(atrHash: string): string {
  const memo = canonicalAtrHash(atrHash, "encodeMemoAtrHash");
  if (isMppAttributionValue(memo))
    throw new Error(
      `encodeMemoAtrHash: this atrHash collides with MPP's Attribution-memo tag and could never be recovered from this rail — see binding-core/src/mpp-attribution.ts; got "${memo}"`,
    );
  // A defensive invariant, not a runtime branch: "0x"+64hex = 66 bytes ≤ 100. If a future atrHash form
  // ever exceeded the memo ceiling this would fail loud rather than emit a truncated (unrecoverable) memo.
  const byteLength = new TextEncoder().encode(memo).length;
  if (byteLength > HEDERA_MEMO_MAX_BYTES)
    throw new Error(
      `encodeMemoAtrHash: memo is ${byteLength} bytes, exceeds Hedera's ${HEDERA_MEMO_MAX_BYTES}-byte ceiling`,
    );
  return memo;
}

/**
 * Decode a `transactionMemo` string back to an atrHash, or `null` if it is not one.
 *
 * `null` rather than a throw, because a Mirror Node scan meets every memo on the account and a foreign one
 * is not an error. Two things are foreign here. The first is anything that is not a well-formed atrHash.
 * The second is MPP's Attribution memo, which IS a well-formed atrHash by shape — required on every MPP
 * charge transaction, exactly 32 bytes, `0x`-prefixed — and reading one as a terms reference would
 * manufacture a weld no seller ever made. LCP v1.38 §C.1 makes discriminating a MUST.
 */
export function decodeMemoAtrHash(memo: string): `0x${string}` | null {
  if (!isAtrHash(memo)) return null;
  const canonical = canonicalAtrHash(memo, "decodeMemoAtrHash");
  return isMppAttributionValue(canonical) ? null : canonical;
}

/** True iff `memo` carries exactly `atrHash` (verification-time check, case-insensitive). */
export function verifyMemoAtrHash(inputs: {
  memo: string;
  atrHash: string;
}): boolean {
  const decoded = decodeMemoAtrHash(inputs.memo);
  if (decoded === null) return false;
  return atrHashEquals(decoded, inputs.atrHash);
}
