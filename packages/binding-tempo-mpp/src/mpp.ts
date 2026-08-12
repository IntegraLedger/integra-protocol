/**
 * The MPP-specific half of the Tempo binding: what the seller advertises, and the guard that stops MPP's
 * own use of the memo slot being mistaken for an LCP reference. Everything else in this package is
 * chain-level and reusable by a bare-TIP-20 binding.
 *
 * **The seller's advertisement.** MPP's Tempo charge method defines `methodDetails.memo` — a hex string,
 * `0x` optional, required to decode to exactly 32 bytes. It rides inside the `request` body, which is
 * **slot 3** of the core scheme's seven-slot HMAC canonicalization, so the seller's own MAC commits them to
 * the value before payment. (Slot 3, not 4: the core draft's table is 0-based, and
 * `draft-ryan-httpauth-payment-01` on the IETF datatracker — the mirror of the core scheme that
 * paymentauth.org publishes as `draft-httpauth-payment-00`, both recorded by LCP v1.38 §C.1 — carries the
 * identical 0-based table. `placement-mpp` has always said 3.) When it is present the server verifies
 * "`Transfer` **and/or** `TransferWithMemo`" logs, so the advertised value must equal the on-chain memo or
 * the payment does not verify. The and/or matters and is not a quibble: a memo transfer emits BOTH events,
 * so a verifier matching on `Transfer` alone wrongly concludes there was no memo — LCP v1.38 §C.1 records
 * exactly this. That is the whole binding: one field, MAC-protected off-chain and topic-indexed on-chain.
 *
 * **THE CARRIER IS CONTESTED, and LCP v1.38 §C.1 now records it.** When a seller supplies NO
 * `methodDetails.memo`, MPP does not leave the memo empty: it
 * generates an *attribution memo* filling all 32 bytes —
 *
 *     TAG(4) = keccak256("mpp")[0..3] = 0xef1ed712 ‖ version(1) = 0x01
 *       ‖ serverId fingerprint(10) ‖ clientId fingerprint(10, zero when anonymous) ‖ challengeId nonce(7)
 *
 * — and the server then REQUIRES a memo bound to its realm and challenge id. So the two uses are mutually
 * exclusive per transfer: advertising `memo = atrHash` forfeits MPP's on-chain attribution, and not
 * advertising one forfeits the LCP weld. Sampling live Tempo mainnet on 2026-07-30, every
 * `TransferWithMemo` observed carried an attribution memo (45/45 and 73/73 in two windows), so this is
 * production behaviour and not a theoretical clash.
 *
 * Hence `isMppAttributionMemo`: a 32-byte attribution value is shape-identical to an atrHash, and returning
 * one as a recovered reference would manufacture a weld no seller ever made. The discriminator is the
 * host's, not ours — an atrHash whose first five bytes happened to be `ef1ed712 01` (one in 2^40) would be
 * refused rather than silently mis-read, which is the correct direction for the error to fall.
 */
import { isMppAttributionValue } from "@integraledger/lcp-binding-core";
import { decodeTip20Memo, encodeTip20Memo } from "./memo.js";

export {
  MPP_ATTRIBUTION_TAG,
  MPP_ATTRIBUTION_VERSION,
} from "@integraledger/lcp-binding-core";

/**
 * True iff `memo` is one of MPP's own attribution memos rather than a reference a seller advertised.
 *
 * The tag and version live on the seam (`binding-core/src/mpp-attribution.ts`) because `binding-hedera`
 * meets the identical collision — `draft-hedera-charge-00` says its layout "is identical to the attribution
 * memo used by the Tempo payment method". What stays here is the DECODE: Tempo accepts a bare or
 * `0x`-prefixed memo because that is its host's grammar, and the shared predicate takes the canonical form.
 */
export function isMppAttributionMemo(memo: string): boolean {
  const decoded = decodeTip20Memo(memo);
  return decoded !== null && isMppAttributionValue(decoded);
}

/** The `methodDetails` fragment a Tempo-charge seller merges into its MPP challenge request body. */
export function mppMethodDetailsMemo(atrHash: string): {
  readonly memo: `0x${string}`;
} {
  return { memo: encodeTip20Memo(atrHash) };
}
