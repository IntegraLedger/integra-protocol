/**
 * The Stacks forms that carry the ATR hash and the digest of what a transaction's origin signed. `../mpp-usdc.ts` checks
 * a signed `transfer` against them, and `../stacks.ts` reads a mined one against them; no entry point exports these
 * names.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import type { AtrHash } from "../core.js";
import { bytesOf, hexOf, type Hex } from "../evm-abi.js";
import { normalHash } from "../fields.js";
import { c32Address } from "./c32.js";
import { readStacksTransaction } from "./stacks-transaction.js";

/** The Clarity serialization of `(some <32-byte buffer>)` before its bytes: `0x0a`, `0x02`, then the length 32. */
export const MEMO_PREFIX = "0x0a0200000020";

/** The Clarity serialization of a 32-byte buffer before its bytes: `0x02`, then the length 32. */
const BUFFER_PREFIX = "0x0200000020";

/** The memo argument's serialization for `h`: `(some h)` as a 32-byte buffer, lowercase. */
export function memoArgument(h: AtrHash): Hex | undefined {
  const n = normalHash(h);
  return n === null ? undefined : (`${MEMO_PREFIX}${n.slice(2)}` as Hex);
}

/** A token transfer's 34-byte memo field carrying `h`: its 32 bytes, then two zero bytes, lowercase. */
export function transferMemo(h: AtrHash): Hex | undefined {
  const n = normalHash(h);
  return n === null ? undefined : (`${n}0000` as Hex);
}

/** `h` as a bare 32-byte Clarity buffer's serialization, lowercase: a form that carries H outside the pairing's own. */
export function bufferArgument(h: AtrHash): Hex | undefined {
  const n = normalHash(h);
  return n === null ? undefined : (`${BUFFER_PREFIX}${n.slice(2)}` as Hex);
}

/**
 * The digest of what a transaction's origin signed, `0x` and lowercase hex, or undefined for bytes a Stacks node does
 * not read. The origin's first signature commits to SHA-512/256 over the initial signature hash (the SHA-512/256 of the
 * transaction in the form its origin signs it, `StacksTransaction.originForm`), the standard authorization flag 0x04,
 * and the origin's fee and nonce, 8 bytes each, big-endian (`@stacks/transactions` 7.6.0 `dist/esm/authorization.js`,
 * `sigHashPreSign`, :178-188, and `dist/esm/transaction.js`, `signBegin` and `signNextOrigin`, :30-34, :43-51). Copies
 * of one payment signed by other quorums, or sponsored by another sponsor, give the same digest.
 */
export function originSigned(wire: Uint8Array): Hex | undefined {
  const tx = readStacksTransaction(wire);
  if (tx === undefined) return undefined;
  const pre = new Uint8Array(32 + 1 + 8 + 8);
  pre.set(sha512_256(tx.originForm), 0);
  pre[32] = 0x04;
  const view = new DataView(pre.buffer);
  view.setBigUint64(33, tx.origin.fee);
  view.setBigUint64(41, tx.origin.nonce);
  return hexOf(sha512_256(pre));
}

/**
 * The principal a Clarity argument's consensus serialization names, as a Stacks node writes it, or undefined for any
 * other value: a standard principal, `0x05`, its version and hash160; or a contract principal, `0x06`, the same, then
 * its name's length in one byte and the name (clarity-types/src/types/serialization.rs, `TypePrefix::PrincipalStandard`
 * and `PrincipalContract`).
 */
export function principalArgument(arg: string): string | undefined {
  const b = bytesOf(arg);
  if (b === undefined || b.length < 22 || b[1]! > 31) return undefined;
  const address = c32Address(b[1]!, b.subarray(2, 22));
  if (b[0] === 0x05) return b.length === 22 ? address : undefined;
  if (b[0] !== 0x06 || b.length < 23 || b.length !== 23 + b[22]!) return undefined;
  const name = String.fromCharCode(...b.subarray(23));
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(name) ? `${address}.${name}` : undefined;
}
