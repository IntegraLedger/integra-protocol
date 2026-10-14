/**
 * Stacks addresses in c32check, written as a Stacks node writes them. stacks-core 4.0.5 (stacks-network/stacks-core
 * d736ba0) writes an address with `c32_address` (stacks-common/src/address/c32.rs:372-375), the function a
 * `StacksAddress` is displayed with (stacks-common/src/types/mod.rs:1150-1157); `c32Address` gives the same characters.
 * `../mpp-usdc.ts` writes the `usdc` Stacks pairing's contract and origin addresses with it. No entry point exports
 * these names.
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
