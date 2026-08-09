/**
 * TIP-20 memo CALLS — PURE, CHAIN-LEVEL, MPP-free.
 *
 * Two jobs. First, encode `transferWithMemo(to, amount, memo)` calldata: selector ‖ left-padded address ‖
 * uint256 ‖ the RAW bytes32 memo. The layout is pinned against a real mainnet call rather than against a
 * reading of the ABI spec, because a wrong layout still produces plausible-looking bytes.
 *
 * Second, grade the weld of an observed call. This is the half that cannot be done from the log: TIP-20's
 * `TransferWithMemo` is emitted by `transferWithMemo` AND `transferFromWithMemo` (and by the mint/burn memo
 * variants), and the four differ in WHO chose the memo:
 *
 *   - `transferWithMemo`     — the token holder calls it, so the payer's own signature over the
 *                              transaction covers the calldata carrying the memo: SIGNATURE-grade.
 *   - `transferFromWithMemo` — a spender moves someone else's tokens under an allowance and picks the memo
 *                              itself; the owner's `approve`/`permit` signature says nothing about it: only
 *                              TX-grade.
 *
 * MPP's Tempo charge method accepts only the `transfer` and `transferWithMemo` selectors as payment calls,
 * so the tx-grade path is unreachable through MPP — but it is reachable on a bare TIP-20 rail, and a
 * verifier that graded from the event alone could not tell the two apart.
 */
import type { WeldGrade } from "@integraledger/lcp-binding-core";
import {
  TRANSFER_FROM_WITH_MEMO_SELECTOR,
  TRANSFER_WITH_MEMO_SELECTOR,
} from "./constants.js";
import { stripHexPrefix, toWord } from "./hex.js";
import { requireMemo } from "./memo.js";

// The prefix is optional AND case-insensitive, matching what `stripHexPrefix` strips — a validator that
// accepted less than the normalizer strips would reject values the rest of the module handles fine.
const ADDRESS_RE = /^(0[xX])?[0-9a-fA-F]{40}$/;
const UINT256_MAX = 2n ** 256n - 1n;

/** The arguments of one TIP-20 `transferWithMemo` call. */
export interface TransferWithMemoCall {
  readonly to: string;
  /** Token base units. */
  readonly amount: bigint;
  /** The 32-byte memo — the atrHash on this binding. */
  readonly memo: string;
}

/** ABI-encode `transferWithMemo(to, amount, memo)`. Throws on any malformed argument (fail-fast). */
export function encodeTransferWithMemoCall(
  call: TransferWithMemoCall,
): `0x${string}` {
  if (!ADDRESS_RE.test(call.to))
    throw new Error(
      `encodeTransferWithMemoCall: to must be a 20-byte address, got "${call.to}"`,
    );
  if (call.amount < 0n || call.amount > UINT256_MAX)
    throw new Error(
      `encodeTransferWithMemoCall: amount must fit uint256, got ${call.amount}`,
    );
  const memo = requireMemo(call.memo, "encodeTransferWithMemoCall");
  const to = toWord(stripHexPrefix(call.to).toLowerCase());
  const amount = toWord(call.amount.toString(16));
  return `${TRANSFER_WITH_MEMO_SELECTOR}${to}${amount}${stripHexPrefix(memo)}` as `0x${string}`;
}

/**
 * The 4-byte selector of `calldata`, lower-cased; `null` when there is not one to read. Short input needs
 * no length guard: a slice shorter than 8 chars fails the fixed-width pattern, so one check does both jobs.
 */
export function selectorOf(calldata: string): `0x${string}` | null {
  const selector = stripHexPrefix(calldata).slice(0, 8);
  if (!/^[0-9a-fA-F]{8}$/.test(selector)) return null;
  return `0x${selector.toLowerCase()}`;
}

/**
 * The weld grade a memo-bearing call earns, or `null` when the call carries no memo at all. The two
 * non-null results are exactly the two keys of the manifest's `weldGrades`.
 */
export function weldGradeForCall(calldata: string): WeldGrade | null {
  const selector = selectorOf(calldata);
  if (selector === TRANSFER_WITH_MEMO_SELECTOR) return "signature";
  if (selector === TRANSFER_FROM_WITH_MEMO_SELECTOR) return "tx";
  return null;
}
