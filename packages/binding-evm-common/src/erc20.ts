/**
 * The one piece of ERC-20 knowledge the EVM welds share: did this transaction move a given token at all?
 *
 * It lives here because two rails need the same answer for the same reason, and the reason is not
 * MPP-specific or x402-specific. Every EVM weld reads its binding out of an event the settlement emits. When
 * that event is absent, the absence has TWO meanings and they are not the same report:
 *
 * - the token did not move ⇒ this transaction settled none of that asset. A true, useful answer.
 * - the token DID move ⇒ the transaction settled, through a path this binding cannot read the weld from.
 *   Reporting that as an absence is a silent wrong answer at a verification boundary.
 *
 * The rails differ in WHICH unreadable path they are looking at — MPP's three non-`authorization` credential
 * types, x402's Permit2 fallback — so each states its own refusal in its own vocabulary. What they share is
 * this predicate, and duplicating it once per rail is how the two drift.
 *
 * Topic-0 identity only, deliberately: this module classifies, it never decodes amounts or recipients.
 * Matching a transfer against an offer's terms is the settle path's job (`executedTransferCoversOffer`), and
 * doing it here would be a second, weaker copy of a check that already has an owner.
 */
import type { Log } from "viem";

/**
 * `keccak256("Transfer(address,address,uint256)")` — ERC-20's `Transfer` event topic0.
 *
 * Derived by two independent keccak-256 oracles that agree byte-for-byte, neither of them viem:
 * `cast keccak 'Transfer(address,address,uint256)'` and pycryptodome `keccak(digest_bits=256)`.
 */
export const ERC20_TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Did this transaction move the configured token at all?
 *
 * Topic-0 identity only — no `decodeEventLog`, because the question is "did this asset move", not "how much,
 * to whom". An indexed-parameter count is not checked either: any log the token emitted under ERC-20's
 * `Transfer` signature settles the question this predicate is asked.
 */
export function assetWasTransferred(
  logs: readonly Log[],
  asset: string,
): boolean {
  const want = asset.toLowerCase();
  return logs.some(
    (log) =>
      log.address.toLowerCase() === want &&
      log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC0,
  );
}
