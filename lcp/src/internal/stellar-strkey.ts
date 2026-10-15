/**
 * Stellar strkeys read and written without @stellar/stellar-sdk, as SEP-23 defines them: RFC 4648 base32, without
 * padding, of a version byte, the payload, and the CRC16-XModem of those two, little-endian. An account (`G…`, version
 * byte `6 << 3`) is a 32-byte Ed25519 key, a contract (`C…`, version byte `2 << 3`) a 32-byte contract id, and a muxed
 * account (`M…`, version byte `12 << 3`) a 32-byte Ed25519 key and an 8-byte id, big-endian. Each strkey has one
 * length: 56 characters for an account or a contract, 69 for a muxed account. No entry point exports any name here.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ACCOUNT = 6 << 3;
const CONTRACT = 2 << 3;
const MUXED = 12 << 3;

/** CRC16-XModem: polynomial 0x1021, initial value 0, no reflection. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * A copy of the payload of a strkey of `version` whose payload is `size` bytes, or null: a value that is not a string,
 * a length other than that payload's, a character outside the base32 alphabet (padding included), a bit set past the
 * last byte, another version byte, or a checksum that does not match.
 */
function decode(s: unknown, version: number, size: number): Uint8Array | null {
  const n = size + 3;
  if (typeof s !== "string" || s.length !== Math.ceil((n * 8) / 5)) return null;
  const out = new Uint8Array(n);
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ALPHABET.indexOf(s[i]!);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0 || out[0] !== version) return null;
  const crc = crc16(out.subarray(0, n - 2));
  if (out[n - 2] !== (crc & 0xff) || out[n - 1] !== crc >> 8) return null;
  return out.slice(1, n - 2);
}

/** The strkey of `version` and `payload`. */
function encode(version: number, payload: Uint8Array): string {
  const bytes = new Uint8Array(payload.length + 3);
  bytes[0] = version;
  bytes.set(payload, 1);
  const crc = crc16(bytes.subarray(0, payload.length + 1));
  bytes[payload.length + 1] = crc & 0xff;
  bytes[payload.length + 2] = crc >> 8;
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return bits > 0 ? out + ALPHABET[(acc << (5 - bits)) & 31] : out;
}

/** The 32-byte key of a `G…` strkey, or null for any other value, a malformed `G…` strkey included. */
export function accountKey(s: unknown): Uint8Array | null {
  return decode(s, ACCOUNT, 32);
}

/** The 32-byte id of a `C…` strkey, or null for any other value, a malformed `C…` strkey included. */
export function contractId(s: unknown): Uint8Array | null {
  return decode(s, CONTRACT, 32);
}

/** True for a well-formed `G…` strkey. */
export function isAccount(s: unknown): s is string {
  return accountKey(s) !== null;
}

/** True for a well-formed `C…` strkey. */
export function isContract(s: unknown): s is string {
  return contractId(s) !== null;
}

/** The `M…` strkey of a `G…` strkey and an id below 2^64, or null when `base` is not a well-formed `G…` strkey. */
export function muxedOf(base: unknown, id: bigint): string | null {
  const key = accountKey(base);
  if (key === null) return null;
  const raw = new Uint8Array(40);
  raw.set(key, 0);
  new DataView(raw.buffer).setBigUint64(32, id, false);
  return encode(MUXED, raw);
}

/**
 * The `G…` base and the id of an `M…` strkey, or null for any other value, a malformed `M…` strkey included. It needs
 * no peer, so each caller gives one answer to an address with @stellar/stellar-sdk and without it.
 */
export function unmux(m: unknown): { base: string; id: bigint } | null {
  const raw = decode(m, MUXED, 40);
  if (raw === null) return null;
  return {
    base: encode(ACCOUNT, raw.subarray(0, 32)),
    id: new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getBigUint64(32, false),
  };
}
