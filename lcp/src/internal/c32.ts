/**
 * Stacks addresses in c32check, written as a Stacks node writes them. stacks-core 4.0.5 (stacks-network/stacks-core
 * d736ba0) writes an address with `c32_address` (stacks-common/src/address/c32.rs:372-375), the function a
 * `StacksAddress` is displayed with (stacks-common/src/types/mod.rs:1150-1157); `c32Address` gives the same characters.
 * `../mpp-usdc.ts` writes the `usdc` Stacks pairing's contract and origin addresses with it; `isCanonicalPrincipal`
 * holds a challenge's recipient and a reference's payee to that spelling. No entry point exports these names.
 */
import { sha256 } from "@noble/hashes/sha2.js";

/** Crockford's base32 digits as Stacks spells them, each at its value (c32.rs:21). */
const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The c32 text of `bytes` read as one big-endian number (c32.rs:180-227): five bits to a digit from the last byte up
 * (:188-206), the digits above the number's highest set bit dropped (:208-214), then one `0` for each zero byte that
 * leads `bytes` (:216-223).
 */
function c32Encode(bytes: Uint8Array): string {
  const digits: string[] = [];
  let carry = 0;
  let carryBits = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    const b = bytes[i]!;
    digits.push(C32[((b & ((1 << (5 - carryBits)) - 1)) << carryBits) + carry]!);
    carryBits += 3;
    carry = b >> (8 - carryBits);
    if (carryBits >= 5) {
      digits.push(C32[carry & 31]!);
      carryBits -= 5;
      carry >>= 5;
    }
  }
  if (carryBits > 0) digits.push(C32[carry]!);
  while (digits.length > 0 && digits[digits.length - 1] === "0") digits.pop();
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) digits.push("0");
  return digits.reverse().join("");
}

/**
 * The address of `version` and `hash160`: `S`, the version's digit, then the c32 text of the hash160 followed by the
 * first four bytes of SHA-256 applied twice to the version byte and the hash160 (c32.rs:297-320, :372-375). Throws
 * TypeError when `version` is not an integer from 0 to 31 (a version c32check cannot write, c32.rs:303-305) or
 * `hash160` is not 20 bytes.
 */
export function c32Address(version: number, hash160: Uint8Array): string {
  if (!Number.isInteger(version) || version < 0 || version > 31) throw new TypeError("version is not 0 to 31");
  if (!(hash160 instanceof Uint8Array) || hash160.length !== 20) throw new TypeError("hash160 is not 20 bytes");
  const checked = new Uint8Array(21);
  checked[0] = version;
  checked.set(hash160, 1);
  const data = new Uint8Array(24);
  data.set(hash160);
  data.set(sha256(sha256(checked)).subarray(0, 4), 20);
  return `S${C32[version]}${c32Encode(data)}`;
}

/** A Clarity contract name, as `stacks.ts` and the `usdc` Stacks profile read one: at most 128 characters. */
const CONTRACT_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

/**
 * Whether `s` is a principal exactly as a Stacks node writes it: a standard principal as `c32Address` writes one (`S`,
 * the version's digit, and the c32 text of a hash160 followed by its checksum), or such a principal, `.` and a Clarity
 * contract name. A principal in lowercase, with a digit c32 decoding reads as an alias (`O`, `I`, `L`), with a leading
 * `0` the encoding does not write, or with a checksum that does not hold is not one: c32 decoding takes the first three
 * for the canonical principal (c32.rs:229-295), so they name the account the node writes canonically, and only that
 * spelling is what the API names.
 */
export function isCanonicalPrincipal(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const dot = s.indexOf(".");
  const address = dot < 0 ? s : s.slice(0, dot);
  if (dot >= 0 && !CONTRACT_NAME.test(s.slice(dot + 1))) return false;
  if (address.length < 3 || address.length > 41 || address[0] !== "S") return false;
  const version = C32.indexOf(address[1]!);
  if (version < 0) return false;
  let n = 0n;
  for (const ch of address.slice(2)) {
    const d = C32.indexOf(ch);
    if (d < 0) return false;
    n = n * 32n + BigInt(d);
  }
  if (n >= 1n << 192n) return false;
  const data = new Uint8Array(24);
  for (let i = 23; i >= 0; i--) {
    data[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return c32Address(version, data.subarray(0, 20)) === address;
}
