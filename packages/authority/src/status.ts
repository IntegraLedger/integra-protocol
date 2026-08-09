/**
 * Lifecycle validity as-of settlement (IDN-5, ATA-4's "unexpired"). Two independent gates, both evaluated
 * against the settlement's chain-anchored time:
 *
 * 1. **Expiry** — the grant's and every link's VC 2.0 `validFrom`/`validUntil`. Expired-at-settlement fails
 *    exactly like revoked-at-settlement; lifecycle is expiry too, not revocation alone.
 * 2. **Revocation** — W3C Bitstring Status List v1.0. The list has NO historical query (a live dereference
 *    yields *today's* list), so "as of settlement" means checking the **hash-pinned snapshot captured at
 *    settlement**, never a live dereference presented as historical truth. `decodeStatusList` + `statusBit`
 *    read the snapshot; whether the live list was *also* consulted is stated separately by the caller.
 */

/** Is a grant temporally active at `asOf`? `validFrom` ≤ asOf < `validUntil` (RFC 3339). Missing bound = open. */
export function isActiveAsOf(
  validFrom: string | undefined,
  validUntil: string | undefined,
  asOf: string,
): boolean {
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return false;
  if (validFrom !== undefined) {
    const from = Date.parse(validFrom);
    if (Number.isNaN(from) || t < from) return false;
  }
  if (validUntil !== undefined) {
    const until = Date.parse(validUntil);
    if (Number.isNaN(until) || t >= until) return false;
  }
  return true;
}

/**
 * The decompressed ceiling — 1 MiB, i.e. 8,388,608 status entries, against the spec's 16 KiB minimum
 * list size. Mirrors `evidence`'s raw-block ceiling so the two size gates in this codebase read alike.
 */
export const STATUS_LIST_MAX_BYTES = 1_048_576;

/**
 * The ENCODED ceiling. gzip of incompressible bytes is slightly larger than its input and base64 adds a
 * third again, so 2× the decompressed ceiling admits every legitimate list while refusing a multi-megabyte
 * string before `atob` allocates it. Bounding only the output would still let the input exhaust memory first.
 */
const ENCODED_MAX_CHARS = STATUS_LIST_MAX_BYTES * 2;

/**
 * Decode a Bitstring Status List v1.0 `encodedList` (multibase base64url-'u' of GZIP-compressed bytes).
 *
 * BOUNDED IN BOTH DIRECTIONS, because this is a decompressor pointed at a counterparty's bytes: the list
 * is the grant ISSUER's, hash-pinning fixes WHICH bytes it is but never HOW MANY it becomes, and gzip's
 * ratio is unbounded — a few hundred kilobytes reach hundreds of megabytes at ratios this format admits.
 * An OOM is not a refusal any caller can catch, so the ceiling is enforced WHILE STREAMING rather than
 * measured after the buffer already exists.
 */
export async function decodeStatusList(
  encodedList: string,
): Promise<Uint8Array> {
  if (!encodedList.startsWith("u"))
    throw new Error(
      `encodedList must be multibase base64url ('u' prefix): ${encodedList.slice(0, 8)}…`,
    );
  if (encodedList.length > ENCODED_MAX_CHARS)
    throw new Error(
      `encodedList is ${encodedList.length} chars, over the ${ENCODED_MAX_CHARS} ceiling — refused before decoding`,
    );
  // `atob` is WHATWG forgiving-base64 decode: it pads internally and rejects only the one remainder
  // (length % 4 === 1) that no padding can rescue, so re-padding here would change nothing.
  const binary = atob(
    encodedList.slice(1).replace(/-/g, "+").replace(/_/g, "/"),
  );
  const gz = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) gz[i] = binary.charCodeAt(i);
  const reader = new Blob([gz as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > STATUS_LIST_MAX_BYTES) {
      await reader.cancel();
      throw new Error(
        `status list decompresses past the ${STATUS_LIST_MAX_BYTES}B ceiling — refused (decompression bomb)`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Read the status bit at `index` from a decoded bitstring (big-endian within each byte, per the spec).
 *
 * The range gate PRECEDES the indexed read and is the ONLY thing here that refuses. `index >> 3` is a
 * 32-bit SIGNED operation, so `ToInt32(2**32)` is `0` and an index of 2**32 addresses byte 0: a bounds
 * check that relies on the read coming back `undefined` is not a bounds check at all — the same class as
 * a varint wrapping past 32 bits. `Number.isSafeInteger` closes the wrap and refuses `NaN`, `Infinity`
 * and fractions in the same breath, none of which name a bit either.
 *
 * An explicit throw rather than a guarded read, so each clause is the SOLE cause of its own refusal.
 * Routing the refusal through an `undefined` check would make every clause unfalsifiable — a negative or
 * oversized index reads `undefined` from the typed array regardless, and the gate would merely agree with
 * the read beneath it instead of deciding anything.
 */
export function statusBit(bitstring: Uint8Array, index: number): boolean {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= bitstring.length * 8
  )
    throw new Error(`status index ${index} out of range for the bitstring`);
  // In range by the gate above, so the read is total — `noUncheckedIndexedAccess` cannot see that.
  const byte = bitstring[index >> 3] as number;
  return ((byte >> (7 - (index % 8))) & 1) === 1;
}

/** Is the entry at `index` revoked (bit set) in the snapshotted status list? Decodes then reads the bit. */
export async function revokedAsOf(
  encodedList: string,
  index: number,
): Promise<boolean> {
  return statusBit(await decodeStatusList(encodedList), index);
}
