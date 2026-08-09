/**
 * The Canton transfer-memo atrHash codec — PURE, no Daml SDK, no HTTP.
 *
 * **THE CARRIER.** x402's `exact` scheme for Canton defines `PaymentRequirements.extra.memo`:
 *
 * > `extra.memo` (optional): Seller-defined UTF-8 string, max 256 bytes. When present, the client MUST
 * > include it in the transfer's metadata.
 *
 * and makes it facilitator-enforced (scheme §Safety Checks, rule 12):
 *
 * > **Memo.** If `paymentRequirements.extra.memo` is set, the transfer metadata MUST carry the identical
 * > value under `x402.memo`. Reject with `invalid_exact_canton_memo_mismatch`.
 *
 * So the SELLER names the value, the PAYER must echo it into the transfer that moves the money, and a
 * THIRD PARTY refuses to relay the payment if they disagree. That is a §8.3.1 Native Field with an
 * unusually strong commitment story, and it rides the same transaction as the value — which is what the
 * overlay it replaces could never do.
 *
 * **WHY THIS CARRIER AND NOT AN OVERLAY CONTRACT.** Canton's other binding,
 * `@integraledger/lcp-binding-canton`, welds through a custom `LcpAnchor` Daml template. Where this scheme
 * applies, the memo is stronger on every axis: it rides the SAME transaction as the payment rather than a
 * separate contract create, the facilitator checks it before relaying, and the transfer's own fields name
 * the asset. LCP §8.3's ordering puts Overlay Contract below Native Field for exactly these reasons. The
 * overlay covers what this scheme cannot reach — it settles Canton Coin only.
 *
 * **THE 256-BYTE CEILING NEEDS NO RUNTIME CHECK.** A canonical atrHash is exactly 66 UTF-8 bytes and the
 * host allows 256, so a length guard here could never fire — it would be an unreachable branch asserting
 * a fact the type of the input already settles. `CANTON_X402_MEMO_MAX_BYTES` records the host's limit and
 * `constants.test.ts` proves an atrHash fits inside it; that is where a fact about the host belongs.
 *
 * `encodeTransferMemo` fails LOUD on a malformed atrHash (never advertise a memo we could not later
 * verify); `decodeTransferMemo` returns `null` for anything that is not one, so a scan over a party's
 * transfers can skip foreign memos without treating them as errors.
 */
import { canonicalAtrHash, isAtrHash } from "@integraledger/lcp-kernel";
import { CANTON_X402_MEMO_KEY } from "./constants.js";

/**
 * The `extra` fragment a Canton seller merges into its x402 `PaymentRequirements`.
 *
 * Returned as an object rather than a bare string so the call site reads as what it is — the seller
 * ADVERTISING a value it is committing to — and so a future scheme field can join it without changing
 * every caller. Mirrors `binding-tempo-mpp`'s `mppMethodDetailsMemo`.
 */
export function x402MemoRequirement(atrHash: string): {
  readonly memo: string;
} {
  return { memo: encodeTransferMemo(atrHash) };
}

/**
 * The memo string carrying `atrHash`: the canonical `0x`-prefixed lowercase form, verbatim.
 *
 * No bare-hex variant is emitted or accepted. The host calls this a "seller-defined UTF-8 string" and
 * compares it byte-for-byte against the transfer metadata, so any second spelling would be a second wire
 * value that a facilitator would reject against the first.
 */
export function encodeTransferMemo(atrHash: string): string {
  return canonicalAtrHash(atrHash, "encodeTransferMemo");
}

/** Decode a memo string back to an atrHash, or `null` if it is not a well-formed one. */
export function decodeTransferMemo(memo: string): `0x${string}` | null {
  return isAtrHash(memo) ? canonicalAtrHash(memo, "decodeTransferMemo") : null;
}

/**
 * Read the atrHash out of a transfer's on-ledger metadata map, or `null` if it carries none.
 *
 * The key is the host's — `x402.memo`, quoted in rule 12 above — and it is read EXACTLY. A metadata map
 * carrying our value under some other key is a transfer that no facilitator checked, so treating it as a
 * weld would assert a commitment nobody made.
 */
export function readTransferMemoAtrHash(
  meta: Readonly<Record<string, string>> | undefined,
): `0x${string}` | null {
  // `?? ""` rather than an `undefined` branch: an absent key and a foreign memo are the same answer, and
  // "" is not a well-formed atrHash, so the decoder already gives it.
  return decodeTransferMemo(meta?.[CANTON_X402_MEMO_KEY] ?? "");
}
