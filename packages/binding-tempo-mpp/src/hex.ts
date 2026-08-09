/**
 * Hex primitives for reading raw JSON-RPC values. INTERNAL — deliberately not re-exported from the
 * barrel: they are how this package reads a log, not part of its contract.
 *
 * They exist because Tempo needs no ABI decoder. The memo IS topic 3, the parties ARE topics 1 and 2, and
 * the amount is the single word of `data` — so pulling in an EVM library (which `dependency-cruiser`'s
 * `viem-isolated` rule forbids here anyway) would buy nothing but a dependency.
 */

/** Strip a leading `0x`/`0X`. Both spellings occur: MPP's own memo parser strips an optional prefix. */
export function stripHexPrefix(value: string): string {
  return /^0x/i.test(value) ? value.slice(2) : value;
}

/** True iff `value` is exactly `byteLength` bytes of hex, with or without the `0x` prefix. */
export function isHexBytes(value: string, byteLength: number): boolean {
  const bare = stripHexPrefix(value);
  return bare.length === byteLength * 2 && /^[0-9a-fA-F]*$/.test(bare);
}

/** Left-pad bare hex into one 32-byte EVM word. Throws when it does not fit (never silently truncates). */
export function toWord(bareHex: string): string {
  if (bareHex.length > 64)
    throw new Error(
      `toWord: ${bareHex.length} hex chars exceed one 32-byte word`,
    );
  return bareHex.padStart(64, "0");
}

/** The address in a 32-byte topic word (its last 20 bytes), lower-cased; `null` if not a word. */
export function addressFromTopic(topic: string): `0x${string}` | null {
  if (!isHexBytes(topic, 32)) return null;
  return `0x${stripHexPrefix(topic).slice(24).toLowerCase()}`;
}

/** The single uint256 in a log's `data`, or `null` when `data` is too short to hold one. */
export function uint256FromData(data: string): bigint | null {
  // No length guard: a slice shorter than one word fails the fixed-width pattern, so one check does both.
  const word = stripHexPrefix(data).slice(0, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null;
  return BigInt(`0x${word}`);
}

/** A JSON-RPC quantity (`"0x3"`) or plain number as a number; `null` when absent or malformed. */
export function quantityToNumber(
  value: string | number | undefined,
): number | null {
  if (value === undefined) return null;
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  const parsed = Number.parseInt(stripHexPrefix(value), 16);
  return Number.isNaN(parsed) ? null : parsed;
}
