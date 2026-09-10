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

/**
 * A JSON-RPC quantity (`"0x3"`) or plain integer as a number; `null` when the value is not one.
 *
 * ⛔⛔ **IT READ A DECIMAL STRING AS HEX, AND `"16"` CAME BACK AS 22.** The body was
 * `Number.parseInt(stripHexPrefix(value), 16)`, and stripping a prefix that is not there leaves the
 * string exactly as it was — so every unprefixed decimal was parsed in base 16 and silently became a
 * DIFFERENT NUMBER. `settlementRefOf` is the caller, so the wrong number became a `logIndex`: the ref
 * pinned log 22 of a transaction whose weld sat at log 16, and `recover` on that ref then answers about
 * another leg of the settlement or refuses `log-index-not-found` for a settlement that welded correctly.
 *
 * ⛔ The prefix is REQUIRED because that is what a JSON-RPC quantity IS (EIP-1474: `0x`-prefixed hex), and
 * because no reading of a bare `"16"` is safe — as hex it is 22 and as decimal it is 16, and nothing in
 * the value says which was meant. Refusing is the only answer that is not a guess.
 *
 * ⛔ And the pattern is anchored rather than left to `parseInt`, which stops at the first character it
 * cannot use: `parseInt("1g", 16)` is `1`, so a truncated or corrupted quantity used to come back as a
 * plausible smaller number instead of as nothing. That is the same silent-truncation failure {@link toWord}
 * throws over, one type down.
 *
 * ⭐ `undefined` is NOT accepted here, and that is the point rather than tidiness: this function used to
 * answer `null` for a value that was absent and for one that was junk, which made the two indistinguishable
 * to every caller. Absence is a legitimate state a log may be in; junk is a broken transport. The caller
 * separates them — see {@link "./log.js".settlementRefOf} — and it can only do that if the two do not
 * arrive here as one.
 */
export function quantityToNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (!/^0x[0-9a-f]+$/i.test(value)) return null;
  // `parseInt` with radix 16 strips an optional `0x` itself, so the prefix is left on rather than sliced:
  // one fewer place for the two spellings of "where the digits start" to disagree.
  const parsed = Number.parseInt(value, 16);
  // A quantity past 2^53 does not survive a `number`: `parseInt` returns the nearest representable value
  // and says nothing, which is the same silent-wrong-number failure this function exists to stop.
  return Number.isSafeInteger(parsed) ? parsed : null;
}
