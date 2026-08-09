/**
 * MPP's Attribution-memo discriminator — one host fact, shared by the two rails that meet it.
 *
 * **THE COLLISION.** MPP's charge drafts require an Attribution memo on charge transactions, and fix its
 * layout: TAG(4) = `keccak256("mpp")[0..3]` = `0xef1ed712`, then VERSION(1) = `0x01`, then fingerprints of
 * the server, the client and the challenge id. Exactly 32 bytes, written on Hedera as a `0x`-prefixed
 * 66-character hex string — which is byte-for-byte the shape of an atrHash. A memo codec that accepts any
 * 32-byte value therefore reads MPP's own attribution fingerprint as a terms reference, and a settlement
 * scan returns every MPP charge on the account as an LCP weld the seller never made.
 *
 * **WHY IT IS SHARED.** `draft-hedera-charge-00` states that its attribution memo layout "is identical to
 * the attribution memo used by the Tempo payment method". Two rails, one host constant — so it lives on the
 * seam both already depend on rather than being copied into each, or imported cross-rail, which would make
 * one rail's release depend on another's.
 *
 * The two rails reached it from opposite directions and that difference is worth keeping in view.
 * `binding-tempo-mpp` guarded it on EMPIRICAL grounds: sampling Tempo mainnet on 2026-07-30, every
 * `TransferWithMemo` observed carried an attribution memo (45/45 and 73/73 in two windows). On Hedera it is
 * NORMATIVE — LCP v1.38 §C.1 states that a reader MUST discriminate before treating memo bytes as a terms
 * reference.
 *
 * **THE DISCRIMINATOR IS THE HOST'S, NOT OURS.** The tag is four bytes of a keccak digest, so an atrHash
 * colliding with it is a 2^-40 event on a value nobody chooses. When it happens the value is refused rather
 * than silently mis-read, which is the correct direction for the error to fall: a false negative here
 * fabricates a weld, a false positive merely discards one that can be re-derived.
 */

/** `keccak256("mpp")[0..3]` — the tag MPP writes at the head of an auto-generated attribution memo. */
export const MPP_ATTRIBUTION_TAG = "0xef1ed712";

/** The attribution memo layout version MPP currently writes. */
export const MPP_ATTRIBUTION_VERSION = 1;

/**
 * True iff a CANONICAL 32-byte value is one of MPP's attribution memos rather than a terms reference.
 *
 * Takes the canonical `0x`-prefixed lowercase form, because that is the one shape both rails already have
 * by the time they ask: Tempo's `decodeAtrMemo` normalizes a bare or prefixed memo to it, and Hedera's
 * codec validates with `isAtrHash` first. Sharing the predicate rather than only the constants is what
 * keeps the two rails from drifting on the version comparison — the tag is a string and the version is a
 * number, and reading the second as hex is the easy half to get wrong twice.
 */
export function isMppAttributionValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.slice(0, 10) !== MPP_ATTRIBUTION_TAG) return false;
  return Number.parseInt(lower.slice(10, 12), 16) === MPP_ATTRIBUTION_VERSION;
}
